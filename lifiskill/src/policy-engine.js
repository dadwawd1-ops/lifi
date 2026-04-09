import { Decision } from './types.js'

const DEFAULT_POLICY = {
  maxAutoUsd: 3000,
  maxConfirmUsd: 10000,
  maxSlippage: 0.005,
  maxComplexSteps: 2,
  allowedChains: [],
  blockedTokens: [],
  receiverWhitelist: [],
  requirePriceForAuto: true,
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toNumberOrDefault(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function isListConfigured(list) {
  return Array.isArray(list) && list.length > 0
}

function normalizeList(list) {
  return Array.isArray(list) ? list : []
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

export function normalizePolicyConfig(policy = {}) {
  const src = policy ?? {}
  return {
    maxAutoUsd: toNumberOrDefault(
      firstDefined(src.maxAutoUsd, src.max_auto_usd),
      DEFAULT_POLICY.maxAutoUsd,
    ),
    maxConfirmUsd: toNumberOrDefault(
      firstDefined(src.maxConfirmUsd, src.max_confirm_usd),
      DEFAULT_POLICY.maxConfirmUsd,
    ),
    maxSlippage: toNumberOrDefault(
      firstDefined(src.maxSlippage, src.max_slippage),
      DEFAULT_POLICY.maxSlippage,
    ),
    maxComplexSteps: toNumberOrDefault(
      firstDefined(src.maxComplexSteps, src.max_complex_steps),
      DEFAULT_POLICY.maxComplexSteps,
    ),
    allowedChains: normalizeList(
      firstDefined(src.allowedChains, src.allowed_chains),
    ),
    blockedTokens: normalizeList(
      firstDefined(src.blockedTokens, src.blocked_tokens),
    ),
    receiverWhitelist: normalizeList(
      firstDefined(src.receiverWhitelist, src.receiver_whitelist),
    ),
    requirePriceForAuto: firstDefined(
      src.requirePriceForAuto,
      src.require_price_for_auto,
      DEFAULT_POLICY.requirePriceForAuto,
    ) !== false,
  }
}

export function mergePolicy(policy = {}) {
  return {
    ...DEFAULT_POLICY,
    ...normalizePolicyConfig(policy),
  }
}

export function evaluatePolicy(context, policy = {}) {
  const cfg = mergePolicy(policy)

  const fromChainId = context?.quoteSummary?.from?.chainId
  const toChainId = context?.quoteSummary?.to?.chainId
  const fromSymbol = context?.quoteSummary?.from?.symbol
  const toSymbol = context?.quoteSummary?.to?.symbol
  const fromUsd = toNumber(context?.quoteSummary?.from?.amountUsd)
  const amountUsdKnown = context?.quoteSummary?.from?.amountUsdKnown !== false
  const slippage = toNumber(context?.quoteSummary?.slippage)
  const steps = context?.quoteSummary?.steps?.length ?? 0
  const receiver = normalizeAddress(context?.receiver)

  const reasons = []

  if (isListConfigured(cfg.allowedChains)) {
    if (!cfg.allowedChains.includes(fromChainId)) {
      return {
        decision: Decision.DENY,
        reason: `from_chain ${fromChainId} is not in allowedChains`,
      }
    }
    if (!cfg.allowedChains.includes(toChainId)) {
      return {
        decision: Decision.DENY,
        reason: `to_chain ${toChainId} is not in allowedChains`,
      }
    }
  }

  if (isListConfigured(cfg.blockedTokens)) {
    if (cfg.blockedTokens.includes(fromSymbol) || cfg.blockedTokens.includes(toSymbol)) {
      return {
        decision: Decision.DENY,
        reason: `token ${fromSymbol ?? toSymbol} is blocked`,
      }
    }
  }

  if (isListConfigured(cfg.receiverWhitelist) && receiver) {
    const normalizedWhitelist = cfg.receiverWhitelist.map(normalizeAddress)
    if (!normalizedWhitelist.includes(receiver)) {
      return {
        decision: Decision.DENY,
        reason: 'receiver is not in whitelist',
      }
    }
  }

  if (cfg.requirePriceForAuto && !amountUsdKnown) {
    reasons.push('amount_usd is unavailable; manual confirmation required')
  }

  if (fromUsd >= cfg.maxConfirmUsd) {
    reasons.push(`amount_usd ${fromUsd} >= maxConfirmUsd ${cfg.maxConfirmUsd}`)
  }

  if (slippage > cfg.maxSlippage) {
    return {
      decision: Decision.DENY,
      reason: `slippage ${slippage} exceeds maxSlippage ${cfg.maxSlippage}`,
    }
  }

  if (steps > cfg.maxComplexSteps) {
    reasons.push(`steps ${steps} exceed maxComplexSteps ${cfg.maxComplexSteps}`)
  }

  if (fromUsd >= cfg.maxAutoUsd) {
    reasons.push(`amount_usd ${fromUsd} >= maxAutoUsd ${cfg.maxAutoUsd}`)
  }

  if (reasons.length > 0) {
    return {
      decision: Decision.REQUIRE_CONFIRM,
      reason: reasons.join('; '),
    }
  }

  return {
    decision: Decision.ALLOW,
    reason: 'policy checks passed',
  }
}
