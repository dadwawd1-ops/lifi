function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
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

function formatUsd(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(toNumber(value))
}

function sumUsd(costs) {
  return (costs ?? []).reduce((sum, item) => sum + toNumber(item.amountUSD), 0)
}

function isFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n)
}

function getStepLabel(step) {
  const type = step?.type ?? 'unknown'
  const toolName = step?.toolDetails?.name ?? step?.tool ?? 'Unknown tool'
  return `${type} via ${toolName}`
}

export function summarizeQuote(quote) {
  const action = quote?.action ?? {}
  const estimate = quote?.estimate ?? {}
  const steps = quote?.includedSteps ?? []

  const fromToken = action.fromToken ?? {}
  const toToken = action.toToken ?? {}

  const fromAmountDecimal = toNumber(
    toDecimalString(action.fromAmount, fromToken.decimals ?? 18),
  )
  const toAmountDecimal = toNumber(
    toDecimalString(estimate.toAmount, toToken.decimals ?? 18),
  )
  const fromPriceKnown = isFiniteNumber(fromToken.priceUSD)
  const toPriceKnown = isFiniteNumber(toToken.priceUSD)
  const fromAmountUsd = fromAmountDecimal * toNumber(fromToken.priceUSD)
  const toAmountUsd = toAmountDecimal * toNumber(toToken.priceUSD)

  const summary = {
    routeId: quote?.id ?? null,
    tool: quote?.toolDetails?.name ?? quote?.tool ?? 'Unknown',
    slippage: toNumber(action.slippage),
    from: {
      chainId: action.fromChainId,
      symbol: fromToken.symbol ?? null,
      amount: `${toDecimalString(action.fromAmount, fromToken.decimals ?? 18)} ${fromToken.symbol ?? ''}`.trim(),
      amountUsd: fromAmountUsd,
      amountUsdKnown: fromPriceKnown,
    },
    to: {
      chainId: action.toChainId,
      symbol: toToken.symbol ?? null,
      estimated: `${toDecimalString(estimate.toAmount, toToken.decimals ?? 18)} ${toToken.symbol ?? ''}`.trim(),
      minimum: `${toDecimalString(estimate.toAmountMin, toToken.decimals ?? 18)} ${toToken.symbol ?? ''}`.trim(),
      estimatedUsd: toAmountUsd,
      estimatedUsdKnown: toPriceKnown,
    },
    costs: {
      gasUsd: formatUsd(sumUsd(estimate.gasCosts ?? [])),
      feeUsd: formatUsd(sumUsd(estimate.feeCosts ?? [])),
    },
    steps: steps.map((step, index) => ({
      index: index + 1,
      label: getStepLabel(step),
      fromChainId: step?.action?.fromChainId ?? null,
      toChainId: step?.action?.toChainId ?? null,
    })),
  }

  return summary
}

export function formatQuoteSummary(summary) {
  const lines = []
  lines.push('=== LI.FI Route Summary ===')
  lines.push(`Route: ${summary.routeId ?? 'N/A'} via ${summary.tool}`)
  lines.push(`From: ${summary.from.amount} on chain ${summary.from.chainId}`)
  lines.push(
    `To:   ${summary.to.estimated} on chain ${summary.to.chainId} (min ${summary.to.minimum})`,
  )
  lines.push(`Gas:  ${summary.costs.gasUsd}`)
  lines.push(`Fees: ${summary.costs.feeUsd}`)
  lines.push(`Slippage: ${(summary.slippage * 100).toFixed(2)}%`)
  if (summary.steps.length > 0) {
    lines.push('Steps:')
    for (const step of summary.steps) {
      lines.push(
        `  ${step.index}. ${step.label} [${step.fromChainId} -> ${step.toChainId}]`,
      )
    }
  }
  return lines.join('\n')
}
