import { Decision, LifecycleState } from './types.js'
import { evaluatePolicy } from './policy-engine.js'
import { ensureApproval } from './approval.js'
import { summarizeQuote } from './route-summary.js'
import { createAudit, pushAuditEvent, finalizeAudit } from './audit.js'
import {
  resolveFeatureFlags,
  assertSkillEnabled,
  isQuoteOnlyEnabled,
} from './feature-flags.js'
import { pollUntilTerminal } from './status-poller.js'
import { classifyError, ErrorCode } from './error-mapping.js'
import { buildOperationKey, createOperationRegistry } from './idempotency.js'
import {
  normalizeWorkflowConfig,
  validateWorkflowInput,
  withRequoteLoop,
} from './workflow-helpers.js'

/**
 * Minimal executable bridge workflow for Week 2:
 * quote -> policy -> optional confirm -> approval -> execute -> status
 */
export async function runBridgeAssetsWorkflow(params) {
  let operationKeyForError = null
  let registryForError = params?.operationRegistry ?? createOperationRegistry()
  try {
    const {
      skill,
      input,
      quoteTool,
      executeTool,
      statusTool,
      policyConfig,
      approvalProvider,
      featureFlags,
      pollingConfig,
      operationRegistry,
      quotePolicy,
    } = params

    const validationErrors = validateWorkflowInput(skill?.id ?? 'bridge-assets', input)
    if (validationErrors.length > 0) {
      const err = new Error(validationErrors.join('; '))
      err.code = ErrorCode.INVALID_INPUT
      throw err
    }

    const normalized = normalizeWorkflowConfig({
      policyConfig: policyConfig ?? skill?.constraints ?? {},
      quotePolicy,
      skill,
    })

    const flags = resolveFeatureFlags(featureFlags ?? {})
    assertSkillEnabled(skill?.id ?? 'bridge-assets', flags)
    const registry = operationRegistry ?? createOperationRegistry()
    registryForError = registry

    const audit = createAudit({
      skillId: skill?.id ?? 'bridge-assets',
      operationId: input.operationId ?? null,
      traceId: input.traceId ?? null,
      walletAddress: input.fromAddress ?? null,
      receiver: input.receiver ?? null,
    })
    let state = LifecycleState.PLANNED
    pushAuditEvent(audit, state, 'workflow started')

    const quoteInput = {
      fromChain: input.fromChain,
      toChain: input.toChain,
      fromToken: input.token,
      toToken: input.token,
      fromAmount: input.amount,
      fromAddress: input.fromAddress,
      toAddress: input.receiver,
      slippage: input.slippage,
    }

    const {
      quoteResult,
      quoteSummary,
      requoteCount,
      requoteReasons,
      degradedToPlanOnly,
    } = await withRequoteLoop({
      quoteTool,
      quoteInput,
      quotePolicy: normalized.quotePolicy,
      onAuditEvent: detail => pushAuditEvent(audit, state, detail),
    })

    if (requoteCount > 0) {
      pushAuditEvent(audit, state, `requote_count=${requoteCount}`)
    }
    if (requoteReasons.length > 0) {
      pushAuditEvent(audit, state, `requote_reasons=${requoteReasons.join(',')}`)
    }

    audit.routeId = quoteResult.quote?.id ?? null
    audit.quoteId = quoteResult.quote?.id ?? null
    audit.routeFingerprint = `${quoteSummary.from.chainId}:${quoteSummary.to.chainId}:${quoteSummary.from.symbol ?? ''}:${quoteSummary.to.symbol ?? ''}:${input.amount ?? ''}`
    operationKeyForError = buildOperationKey({
      operationId: input.operationId,
      walletAddress: input.fromAddress,
      skillId: skill?.id ?? 'bridge-assets',
      routeFingerprint: audit.routeFingerprint,
    })
    pushAuditEvent(audit, state, 'quote fetched')

    const policyDecision = evaluatePolicy(
      {
        quoteSummary,
        receiver: input.receiver,
      },
      normalized.policyConfig,
    )
    audit.decision = policyDecision.decision
    audit.decisionReason = policyDecision.reason

    if (policyDecision.decision === Decision.DENY) {
      state = LifecycleState.FAILED
      pushAuditEvent(audit, state, `denied: ${policyDecision.reason}`)
      finalizeAudit(audit, state, {
        code: ErrorCode.POLICY_DENY,
        message: policyDecision.reason,
      })
      return {
        state,
        quote: quoteResult.quote,
        quoteSummary,
        audit,
      }
    }

    if (degradedToPlanOnly) {
      state = LifecycleState.AWAITING_CONFIRM
      pushAuditEvent(audit, state, 'degraded to plan-only after requote limit')
      registry.update({
        key: operationKeyForError,
        state,
        errorCode: ErrorCode.QUOTE_DEGRADED_PLAN_ONLY,
        errorMessage: 'Requote limit exceeded, execution downgraded to plan-only',
      })
      finalizeAudit(audit, state, {
        code: ErrorCode.QUOTE_DEGRADED_PLAN_ONLY,
        message: 'Requote limit exceeded, execution downgraded to plan-only',
      })
      return {
        state,
        quote: quoteResult.quote,
        quoteSummary,
        planOnly: true,
        requoteReasons,
        audit,
      }
    }

    if (policyDecision.decision === Decision.REQUIRE_CONFIRM || input.autoConfirm !== true) {
      state = LifecycleState.AWAITING_CONFIRM
      pushAuditEvent(audit, state, 'awaiting user confirmation')
      if (!input.confirmed) {
        registry.update({
          key: operationKeyForError,
          state,
        })
        finalizeAudit(audit, state)
        return {
          state,
          quote: quoteResult.quote,
          quoteSummary,
          requiresConfirmation: true,
          audit,
        }
      }
    }

    const idempotency = registry.start({
      key: operationKeyForError,
      operationId: input.operationId,
      walletAddress: input.fromAddress,
      skillId: skill?.id ?? 'bridge-assets',
      routeFingerprint: audit.routeFingerprint,
    })

    if (idempotency.decision === 'return_completed') {
      pushAuditEvent(audit, LifecycleState.COMPLETED, 'idempotent replay: completed result reused')
      finalizeAudit(audit, LifecycleState.COMPLETED)
      return {
        state: LifecycleState.COMPLETED,
        quote: quoteResult.quote,
        quoteSummary,
        replayed: true,
        execution: idempotency.record?.result ?? null,
        audit,
      }
    }

    if (idempotency.decision === 'return_in_progress') {
      pushAuditEvent(audit, LifecycleState.POLLING, 'idempotent replay: operation in progress')
      finalizeAudit(audit, LifecycleState.POLLING)
      return {
        state: LifecycleState.POLLING,
        quote: quoteResult.quote,
        quoteSummary,
        replayed: true,
        inProgress: true,
        audit,
      }
    }

    if (idempotency.decision === 'return_failed') {
      pushAuditEvent(audit, LifecycleState.FAILED, 'idempotent replay: non-retryable failed result reused')
      finalizeAudit(audit, LifecycleState.FAILED, {
        code: idempotency.record?.errorCode ?? ErrorCode.WORKFLOW_ERROR,
        message: idempotency.record?.errorMessage ?? 'Previously failed operation',
      })
      return {
        state: LifecycleState.FAILED,
        quote: quoteResult.quote,
        quoteSummary,
        replayed: true,
        audit,
      }
    }

    if (isQuoteOnlyEnabled(flags)) {
      state = LifecycleState.AWAITING_CONFIRM
      pushAuditEvent(audit, state, 'quote-only mode active, execution blocked')
      registry.update({
        key: operationKeyForError,
        state,
        errorCode: ErrorCode.EXECUTION_BLOCKED_QUOTE_ONLY,
        errorMessage: 'Execution blocked by quote-only mode',
      })
      finalizeAudit(audit, state, {
        code: ErrorCode.EXECUTION_BLOCKED_QUOTE_ONLY,
        message: 'Execution blocked by quote-only mode',
      })
      return {
        state,
        quote: quoteResult.quote,
        quoteSummary,
        quoteOnly: true,
        audit,
      }
    }

    const spenderAddress =
      quoteResult.quote?.estimate?.approvalAddress ??
      quoteResult.quote?.estimate?.to ??
      null

    if (spenderAddress && approvalProvider) {
      const approval = await ensureApproval({
        tokenAddress: quoteResult.quote?.action?.fromToken?.address ?? input.tokenAddress,
        ownerAddress: input.fromAddress,
        spenderAddress,
        requiredAmount: quoteResult.quote?.action?.fromAmount ?? input.amount,
        approvalProvider,
      })
      audit.approval = approval
      pushAuditEvent(audit, state, `approval handled: ${approval.method}`)
    }

    state = LifecycleState.EXECUTING
    registry.update({
      key: operationKeyForError,
      state,
    })
    pushAuditEvent(audit, state, 'executing transaction')
    const execution = await executeTool.run({
      quote: quoteResult.quote,
      fromAddress: input.fromAddress,
      toAddress: input.receiver,
      operationId: input.operationId,
    })

    audit.txHash = execution?.txHash ?? execution?.transactionHash ?? null
    state = LifecycleState.POLLING
    registry.update({
      key: operationKeyForError,
      state,
      result: execution,
    })
    pushAuditEvent(audit, state, 'polling status')

    const pollResult = await pollUntilTerminal({
      fetchStatus: statusInput => statusTool.run(statusInput),
      input: {
        txHash: audit.txHash,
        fromChain: input.fromChain,
        toChain: input.toChain,
      },
      onTick: tick => {
        pushAuditEvent(audit, LifecycleState.POLLING, `status ${tick.externalStatus}`)
      },
      config: pollingConfig,
    })

    if (pollResult.lifecycleState === 'completed') {
      state = LifecycleState.COMPLETED
      pushAuditEvent(audit, state, String(pollResult.externalStatus))
    } else if (pollResult.lifecycleState === 'failed') {
      state = LifecycleState.FAILED
      pushAuditEvent(audit, state, String(pollResult.externalStatus))
    }

    registry.update({
      key: operationKeyForError,
      state,
      result: execution,
      errorCode: state === LifecycleState.FAILED ? ErrorCode.WORKFLOW_ERROR : null,
      errorMessage: state === LifecycleState.FAILED ? 'Execution status resolved to failed' : null,
    })
    finalizeAudit(audit, state)

    return {
      state,
      quote: quoteResult.quote,
      quoteSummary,
      execution,
      status: pollResult.payload,
      audit,
    }
  } catch (error) {
    const mapped = classifyError(error)
    const failedState = LifecycleState.FAILED
    const fallbackRouteFingerprint =
      params?.input?.operationId && params?.input?.fromAddress
        ? `${params?.input?.fromChain ?? ''}:${params?.input?.toChain ?? ''}:${params?.input?.token ?? ''}:${params?.input?.token ?? ''}:${params?.input?.amount ?? ''}`
        : ''
    const operationKey =
      operationKeyForError ??
      buildOperationKey({
        operationId: params?.input?.operationId,
        walletAddress: params?.input?.fromAddress,
        skillId: params?.skill?.id ?? 'bridge-assets',
        routeFingerprint: fallbackRouteFingerprint,
      })
    registryForError.update({
      key: operationKey,
      state: failedState,
      errorCode: mapped.code,
      errorMessage: mapped.message,
    })
    const fallbackAudit = createAudit({
      skillId: params?.skill?.id ?? 'bridge-assets',
      operationId: params?.input?.operationId ?? null,
      traceId: params?.input?.traceId ?? null,
      walletAddress: params?.input?.fromAddress ?? null,
      receiver: params?.input?.receiver ?? null,
    })
    pushAuditEvent(fallbackAudit, failedState, mapped.message)
    finalizeAudit(fallbackAudit, failedState, {
      code: mapped.code,
      message: mapped.message,
    })
    return {
      state: failedState,
      error: mapped,
      audit: fallbackAudit,
    }
  }
}
