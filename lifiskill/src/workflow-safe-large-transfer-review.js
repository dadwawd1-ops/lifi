import { Decision, LifecycleState } from './types.js'
import { evaluatePolicy } from './policy-engine.js'
import { summarizeQuote } from './route-summary.js'
import { createAudit, pushAuditEvent, finalizeAudit } from './audit.js'
import { resolveFeatureFlags, assertSkillEnabled } from './feature-flags.js'
import { classifyError, ErrorCode } from './error-mapping.js'
import {
  normalizeWorkflowConfig,
  validateWorkflowInput,
  withRequoteLoop,
} from './workflow-helpers.js'

export async function runSafeLargeTransferReviewWorkflow(params) {
  try {
    const {
      skill,
      input,
      quoteTool,
      riskChecker,
      addressScreener,
      policyConfig,
      featureFlags,
      quotePolicy,
    } = params

    const validationErrors = validateWorkflowInput(
      skill?.id ?? 'safe-large-transfer-review',
      input,
    )
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
    assertSkillEnabled(skill?.id ?? 'safe-large-transfer-review', flags)

    const audit = createAudit({
      skillId: skill?.id ?? 'safe-large-transfer-review',
      operationId: input.operationId ?? null,
      traceId: input.traceId ?? null,
      walletAddress: input.fromAddress ?? null,
      receiver: input.receiver ?? null,
    })

    let state = LifecycleState.PLANNED
    pushAuditEvent(audit, state, 'review workflow started')

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
    audit.routeFingerprint = `${quoteSummary.from.chainId}:${quoteSummary.to.chainId}:${input.token}:${input.amount}`
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
    pushAuditEvent(audit, state, `policy decision: ${policyDecision.decision}`)

    const riskResult = riskChecker
      ? await riskChecker({
          quote: quoteResult.quote,
          quoteSummary,
          input,
        })
      : {
          level: 'unknown',
          reasons: [],
        }
    pushAuditEvent(audit, state, 'risk checked')

    const addressResult = addressScreener
      ? await addressScreener({
          receiver: input.receiver,
          input,
        })
      : {
          allowed: true,
          flags: [],
        }
    pushAuditEvent(audit, state, 'address screened')

    state = LifecycleState.AWAITING_CONFIRM
    pushAuditEvent(audit, state, 'review produced; waiting for user decision')

    const report = {
      policyDecision,
      riskResult,
      addressResult,
      degradedToPlanOnly,
      requoteReasons,
      recommendedAction:
        degradedToPlanOnly
          ? 'manual_confirm_required'
          : policyDecision.decision === Decision.DENY || addressResult.allowed === false
          ? 'do_not_execute'
          : policyDecision.decision === Decision.REQUIRE_CONFIRM
            ? 'manual_confirm_required'
            : 'can_execute_with_confirmation',
    }

    finalizeAudit(audit, state)
    return {
      state,
      quote: quoteResult.quote,
      quoteSummary,
      report,
      audit,
    }
  } catch (error) {
    const mapped = classifyError(error)
    const failedState = LifecycleState.FAILED
    const fallbackAudit = createAudit({
      skillId: params?.skill?.id ?? 'safe-large-transfer-review',
      operationId: params?.input?.operationId ?? null,
      traceId: params?.input?.traceId ?? null,
      walletAddress: params?.input?.fromAddress ?? null,
      receiver: params?.input?.receiver ?? null,
    })
    pushAuditEvent(fallbackAudit, failedState, mapped.message)
    finalizeAudit(fallbackAudit, failedState, {
      code: mapped.code ?? ErrorCode.WORKFLOW_ERROR,
      message: mapped.message,
    })
    return {
      state: failedState,
      error: mapped,
      audit: fallbackAudit,
    }
  }
}
