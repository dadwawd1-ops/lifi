import { ErrorCode } from './error-mapping.js'
import { summarizeQuote } from './route-summary.js'
import { normalizePolicyConfig } from './policy-engine.js'

const DEFAULT_QUOTE_POLICY = {
  quoteTtlMs: 60_000,
  maxRequoteCount: 2,
  maxGasUsdDriftRate: 0.2,
  maxMinOutputDriftRate: 0.01,
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toNonNegativeInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return fallback
  }
  return Math.floor(n)
}

function nowMs() {
  return Date.now()
}

function parseAmount(value) {
  try {
    return BigInt(String(value ?? '0'))
  } catch {
    return null
  }
}

function toDecimalString(rawAmount, decimals) {
  const raw = String(rawAmount ?? '0')
  const safeDecimals = Number.isInteger(decimals) ? decimals : 18

  if (!/^\d+$/.test(raw)) {
    return raw
  }
  if (safeDecimals === 0) {
    return raw
  }
  const padded = raw.padStart(safeDecimals + 1, '0')
  const splitIndex = padded.length - safeDecimals
  const integerPart = padded.slice(0, splitIndex)
  const fractionalPart = padded.slice(splitIndex).replace(/0+$/, '')
  return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart
}

function estimateGasUsd(quote) {
  const gasCosts = quote?.estimate?.gasCosts ?? []
  return gasCosts.reduce((sum, item) => sum + toNumber(item?.amountUSD, 0), 0)
}

function estimateMinOutputDecimal(quote) {
  const minOut = quote?.estimate?.toAmountMin
  const decimals = quote?.action?.toToken?.decimals ?? 18
  return toNumber(toDecimalString(minOut, decimals), 0)
}

function relativeDrift(fromValue, toValue) {
  const a = toNumber(fromValue, 0)
  const b = toNumber(toValue, 0)
  if (a <= 0) {
    return 0
  }
  return Math.abs(b - a) / a
}

export function normalizeWorkflowConfig(input = {}) {
  const policy = normalizePolicyConfig(
    input.policyConfig ?? input.skill?.constraints ?? {},
  )
  return {
    policyConfig: policy,
    quotePolicy: {
      quoteTtlMs: toNonNegativeInt(
        input.quotePolicy?.quoteTtlMs,
        DEFAULT_QUOTE_POLICY.quoteTtlMs,
      ),
      maxRequoteCount: toNonNegativeInt(
        input.quotePolicy?.maxRequoteCount,
        DEFAULT_QUOTE_POLICY.maxRequoteCount,
      ),
      maxGasUsdDriftRate: toNumber(
        input.quotePolicy?.maxGasUsdDriftRate,
        DEFAULT_QUOTE_POLICY.maxGasUsdDriftRate,
      ),
      maxMinOutputDriftRate: toNumber(
        input.quotePolicy?.maxMinOutputDriftRate,
        DEFAULT_QUOTE_POLICY.maxMinOutputDriftRate,
      ),
    },
  }
}

export function validateWorkflowInput(skillId, input) {
  const errors = []
  if (!input || typeof input !== 'object') {
    return ['input must be an object']
  }

  if (!input.fromChain && input.fromChain !== 0) {
    errors.push('`fromChain` is required')
  }
  if (!input.toChain && input.toChain !== 0) {
    errors.push('`toChain` is required')
  }

  const amount = parseAmount(input.amount)
  if (amount === null || amount <= 0n) {
    errors.push('`amount` must be a positive integer string')
  }

  if (skillId === 'bridge-assets' || skillId === 'safe-large-transfer-review') {
    if (typeof input.token !== 'string' || input.token.trim().length === 0) {
      errors.push('`token` is required')
    }
  }

  if (skillId === 'swap-then-bridge') {
    if (
      typeof input.fromToken !== 'string' ||
      input.fromToken.trim().length === 0
    ) {
      errors.push('`fromToken` is required')
    }
    if (typeof input.toToken !== 'string' || input.toToken.trim().length === 0) {
      errors.push('`toToken` is required')
    }
  }

  if (!ADDRESS_RE.test(String(input.fromAddress ?? ''))) {
    errors.push('`fromAddress` must be a valid EVM address')
  }
  if (!ADDRESS_RE.test(String(input.receiver ?? ''))) {
    errors.push('`receiver` must be a valid EVM address')
  }

  return errors
}

function shouldRequote({
  firstQuote,
  nextQuote,
  firstQuotedAt,
  quotePolicy,
  now = nowMs,
}) {
  const ageMs = now() - firstQuotedAt
  if (ageMs > quotePolicy.quoteTtlMs) {
    return {
      required: true,
      reason: `quote_ttl_exceeded_${ageMs}ms`,
    }
  }

  const firstGas = estimateGasUsd(firstQuote)
  const nextGas = estimateGasUsd(nextQuote)
  const gasDrift = relativeDrift(firstGas, nextGas)
  if (gasDrift > quotePolicy.maxGasUsdDriftRate) {
    return {
      required: true,
      reason: `gas_drift_${gasDrift.toFixed(4)}`,
    }
  }

  const firstMinOut = estimateMinOutputDecimal(firstQuote)
  const nextMinOut = estimateMinOutputDecimal(nextQuote)
  if (firstMinOut > 0) {
    const minOutDropRate = Math.max(0, (firstMinOut - nextMinOut) / firstMinOut)
    if (minOutDropRate > quotePolicy.maxMinOutputDriftRate) {
      return {
        required: true,
        reason: `min_output_drop_${minOutDropRate.toFixed(4)}`,
      }
    }
  }

  return {
    required: false,
    reason: 'quote_still_valid',
  }
}

export async function withRequoteLoop(params) {
  const {
    quoteTool,
    quoteInput,
    quotePolicy,
    onAuditEvent,
    now = nowMs,
  } = params

  const maxRequoteCount = quotePolicy.maxRequoteCount
  let firstQuoteResult = await quoteTool.run(quoteInput)
  let firstQuotedAt = now()
  let finalQuoteResult = firstQuoteResult
  let finalSummary = finalQuoteResult.summary ?? summarizeQuote(finalQuoteResult.quote)
  const requoteReasons = []

  if (maxRequoteCount <= 0) {
    return {
      quoteResult: finalQuoteResult,
      quoteSummary: finalSummary,
      requoteCount: 0,
      requoteReasons,
      degradedToPlanOnly: false,
    }
  }

  for (let attempt = 1; attempt <= maxRequoteCount; attempt += 1) {
    const nextQuoteResult = await quoteTool.run(quoteInput)
    const decision = shouldRequote({
      firstQuote: firstQuoteResult.quote,
      nextQuote: nextQuoteResult.quote,
      firstQuotedAt,
      quotePolicy,
      now,
    })

    if (!decision.required) {
      finalQuoteResult = nextQuoteResult
      finalSummary = nextQuoteResult.summary ?? summarizeQuote(nextQuoteResult.quote)
      if (typeof onAuditEvent === 'function') {
        onAuditEvent(`requote check passed at attempt ${attempt}`)
      }
      return {
        quoteResult: finalQuoteResult,
        quoteSummary: finalSummary,
        requoteCount: attempt,
        requoteReasons,
        degradedToPlanOnly: false,
      }
    }

    requoteReasons.push(decision.reason)
    if (typeof onAuditEvent === 'function') {
      onAuditEvent(`requote required: ${decision.reason}`)
    }

    firstQuoteResult = nextQuoteResult
    firstQuotedAt = now()
    finalQuoteResult = nextQuoteResult
    finalSummary = nextQuoteResult.summary ?? summarizeQuote(nextQuoteResult.quote)
  }

  return {
    quoteResult: finalQuoteResult,
    quoteSummary: finalSummary,
    requoteCount: maxRequoteCount,
    requoteReasons,
    degradedToPlanOnly: true,
    degradeReason: ErrorCode.QUOTE_DEGRADED_PLAN_ONLY ?? 'QUOTE_DEGRADED_PLAN_ONLY',
  }
}
