function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatUsd(value) {
  const n = toNumber(value)
  if (n === 0) {
    return '$0.00'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n >= 100 ? 2 : 4,
  }).format(n)
}

function formatTokenAmount(rawAmount, decimals, symbol) {
  const amount = toDecimalString(rawAmount, decimals)
  return `${amount} ${symbol}`.trim()
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

function sumUsd(costs) {
  return (costs ?? []).reduce((sum, item) => sum + toNumber(item.amountUSD), 0)
}

function getStepLabel(step) {
  const type = step?.type ?? 'unknown'
  const toolName = step?.toolDetails?.name ?? step?.tool ?? 'Unknown tool'
  return `${type} via ${toolName}`
}

export function buildRiskFlags(quote) {
  const flags = []
  const action = quote?.action ?? {}
  const estimate = quote?.estimate ?? {}
  const gasCosts = estimate.gasCosts ?? []
  const feeCosts = estimate.feeCosts ?? []
  const includedSteps = quote?.includedSteps ?? []

  if (action.fromChainId !== action.toChainId) {
    flags.push({
      level: 'info',
      code: 'cross_chain',
      message: 'This route crosses chains, so settlement may take longer.',
    })
  }

  if (includedSteps.length > 1) {
    flags.push({
      level: 'info',
      code: 'multi_step',
      message: `This route has ${includedSteps.length} steps, so execution complexity is higher than a simple swap.`,
    })
  }

  if (estimate.approvalAddress) {
    flags.push({
      level: 'warning',
      code: 'approval_required',
      message: 'This route likely requires token approval before execution.',
    })
  }

  const totalGasUsd = sumUsd(gasCosts)
  if (totalGasUsd >= 20) {
    flags.push({
      level: 'warning',
      code: 'high_gas',
      message: `Estimated gas cost is relatively high at ${formatUsd(totalGasUsd)}.`,
    })
  }

  const totalFeeUsd = sumUsd(feeCosts)
  if (totalFeeUsd > 0) {
    flags.push({
      level: 'info',
      code: 'fee_detected',
      message: `Route includes explicit protocol or bridge fees of about ${formatUsd(totalFeeUsd)}.`,
    })
  }

  const fromAmountUsd = toNumber(action.fromToken?.priceUSD) *
    toNumber(toDecimalString(action.fromAmount ?? '0', action.fromToken?.decimals ?? 18))
  if (fromAmountUsd >= 10000) {
    flags.push({
      level: 'warning',
      code: 'large_transfer',
      message: `This is a large transfer at roughly ${formatUsd(fromAmountUsd)}. Consider extra confirmation.`,
    })
  }

  const slippage = toNumber(action.slippage)
  if (slippage >= 0.01) {
    flags.push({
      level: 'warning',
      code: 'high_slippage',
      message: `Configured slippage is ${formatPercent(slippage)}, which is relatively high.`,
    })
  }

  if (includedSteps.some(step => step?.type === 'cross')) {
    flags.push({
      level: 'info',
      code: 'bridge_dependency',
      message: 'This route depends on a bridge completing on the destination chain.',
    })
  }

  return flags
}

function formatPercent(value) {
  return `${(toNumber(value) * 100).toFixed(2)}%`
}

export function summarizeQuote(quote) {
  const action = quote?.action ?? {}
  const estimate = quote?.estimate ?? {}
  const includedSteps = quote?.includedSteps ?? []

  const fromToken = action.fromToken ?? {}
  const toToken = action.toToken ?? {}

  const gasCosts = estimate.gasCosts ?? []
  const feeCosts = estimate.feeCosts ?? []
  const totalGasUsd = sumUsd(gasCosts)
  const totalFeeUsd = sumUsd(feeCosts)

  const summary = {
    routeId: quote?.id ?? null,
    routeType: quote?.type ?? 'unknown',
    tool: quote?.toolDetails?.name ?? quote?.tool ?? 'Unknown',
    from: {
      chainId: action.fromChainId,
      tokenSymbol: fromToken.symbol,
      tokenAddress: fromToken.address,
      amount: formatTokenAmount(
        action.fromAmount,
        fromToken.decimals ?? 18,
        fromToken.symbol ?? '',
      ),
    },
    to: {
      chainId: action.toChainId,
      tokenSymbol: toToken.symbol,
      tokenAddress: toToken.address,
      estimatedAmount: formatTokenAmount(
        estimate.toAmount,
        toToken.decimals ?? 18,
        toToken.symbol ?? '',
      ),
      minimumAmount: formatTokenAmount(
        estimate.toAmountMin,
        toToken.decimals ?? 18,
        toToken.symbol ?? '',
      ),
    },
    costs: {
      gasUsd: formatUsd(totalGasUsd),
      feeUsd: formatUsd(totalFeeUsd),
      gasLines: gasCosts.map(cost => ({
        label: `${cost.type ?? 'GAS'} in ${cost.token?.symbol ?? 'token'}`,
        amount: formatTokenAmount(
          cost.amount ?? '0',
          cost.token?.decimals ?? 18,
          cost.token?.symbol ?? '',
        ),
        amountUsd: formatUsd(cost.amountUSD),
      })),
      feeLines: feeCosts.map(cost => ({
        label: cost.name ?? cost.type ?? 'Fee',
        amount: formatTokenAmount(
          cost.amount ?? '0',
          cost.token?.decimals ?? 18,
          cost.token?.symbol ?? '',
        ),
        amountUsd: formatUsd(cost.amountUSD),
      })),
    },
    steps: includedSteps.map((step, index) => ({
      index: index + 1,
      label: getStepLabel(step),
      fromChainId: step?.action?.fromChainId,
      toChainId: step?.action?.toChainId,
      fromToken: step?.action?.fromToken?.symbol ?? null,
      toToken: step?.action?.toToken?.symbol ?? null,
    })),
    riskFlags: buildRiskFlags(quote),
  }

  summary.narrative = buildNarrative(summary)
  return summary
}

function buildNarrative(summary) {
  const parts = []

  parts.push(
    `Route ${summary.routeId ?? 'unknown'} uses ${summary.tool} to move ${summary.from.amount} on chain ${summary.from.chainId} into an estimated ${summary.to.estimatedAmount} on chain ${summary.to.chainId}.`,
  )
  parts.push(
    `The guaranteed minimum output is ${summary.to.minimumAmount}.`,
  )

  if (summary.steps.length > 0) {
    parts.push(
      `The route has ${summary.steps.length} step${summary.steps.length === 1 ? '' : 's'}: ${summary.steps.map(step => step.label).join(', ')}.`,
    )
  }

  parts.push(
    `Estimated gas cost is ${summary.costs.gasUsd}, and explicit fees total ${summary.costs.feeUsd}.`,
  )

  if (summary.riskFlags.length > 0) {
    parts.push(
      `Key flags: ${summary.riskFlags.map(flag => flag.message).join(' ')}`,
    )
  }

  return parts.join(' ')
}

export function formatQuotePreview(summary) {
  const lines = []

  lines.push('=== LI.FI Route Preview ===')
  lines.push(summary.narrative)
  lines.push('')
  lines.push(`From: ${summary.from.amount} on chain ${summary.from.chainId}`)
  lines.push(
    `To:   ${summary.to.estimatedAmount} on chain ${summary.to.chainId} (min ${summary.to.minimumAmount})`,
  )
  lines.push(`Tool: ${summary.tool}`)
  lines.push(`Gas:  ${summary.costs.gasUsd}`)
  lines.push(`Fees: ${summary.costs.feeUsd}`)

  if (summary.steps.length > 0) {
    lines.push('')
    lines.push('Steps:')
    for (const step of summary.steps) {
      lines.push(
        `  ${step.index}. ${step.label} [${step.fromChainId} -> ${step.toChainId}]`,
      )
    }
  }

  if (summary.riskFlags.length > 0) {
    lines.push('')
    lines.push('Risk Flags:')
    for (const flag of summary.riskFlags) {
      lines.push(`  - [${flag.level}] ${flag.message}`)
    }
  }

  return lines.join('\n')
}
