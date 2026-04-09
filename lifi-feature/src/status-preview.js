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

function formatTokenAmount(amount, token) {
  if (!token) {
    return String(amount ?? '0')
  }

  return `${toDecimalString(amount, token.decimals ?? 18)} ${token.symbol ?? ''}`.trim()
}

function formatUsd(value) {
  const n = toNumber(value)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n >= 100 ? 2 : 4,
  }).format(n)
}

export function summarizeStatus(statusPayload) {
  const sending = statusPayload?.sending ?? null
  const receiving = statusPayload?.receiving ?? null
  const feeCosts = statusPayload?.feeCosts ?? []

  const feeUsd = feeCosts.reduce((sum, fee) => sum + toNumber(fee.amountUSD), 0)

  const summary = {
    transactionId: statusPayload?.transactionId ?? null,
    status: statusPayload?.status ?? 'UNKNOWN',
    substatus: statusPayload?.substatus ?? null,
    substatusMessage: statusPayload?.substatusMessage ?? '',
    tool: statusPayload?.tool ?? 'Unknown',
    fromAddress: statusPayload?.fromAddress ?? null,
    toAddress: statusPayload?.toAddress ?? null,
    sending: sending
      ? {
          chainId: sending.chainId ?? null,
          txHash: sending.txHash ?? null,
          amount: formatTokenAmount(sending.amount, sending.token),
          gasUsd: formatUsd(sending.gasAmountUSD ?? 0),
        }
      : null,
    receiving: receiving
      ? {
          chainId: receiving.chainId ?? null,
          txHash: receiving.txHash ?? null,
          amount: formatTokenAmount(receiving.amount, receiving.token),
        }
      : null,
    totalFeesUsd: formatUsd(feeUsd),
    explorerLink:
      statusPayload?.lifiExplorerLink ??
      statusPayload?.bridgeExplorerLink ??
      null,
  }

  summary.narrative = buildNarrative(summary)
  return summary
}

function buildNarrative(summary) {
  const parts = []

  parts.push(
    `Transfer status is ${summary.status}${summary.substatus ? ` / ${summary.substatus}` : ''} via ${summary.tool}.`,
  )

  if (summary.sending) {
    parts.push(
      `Source transaction sent ${summary.sending.amount} on chain ${summary.sending.chainId}.`,
    )
  }

  if (summary.receiving) {
    parts.push(
      `Destination side shows ${summary.receiving.amount} on chain ${summary.receiving.chainId}.`,
    )
  }

  if (summary.substatusMessage) {
    parts.push(summary.substatusMessage)
  }

  return parts.join(' ')
}

export function formatStatusPreview(summary) {
  const lines = []

  lines.push('=== LI.FI Transfer Status ===')
  lines.push(summary.narrative)
  lines.push('')
  lines.push(`Status: ${summary.status}`)
  if (summary.substatus) {
    lines.push(`Substatus: ${summary.substatus}`)
  }
  lines.push(`Tool: ${summary.tool}`)
  lines.push(`Fees: ${summary.totalFeesUsd}`)

  if (summary.sending) {
    lines.push('')
    lines.push('Sending:')
    lines.push(`  Chain: ${summary.sending.chainId}`)
    lines.push(`  Amount: ${summary.sending.amount}`)
    lines.push(`  Tx: ${summary.sending.txHash ?? 'N/A'}`)
    lines.push(`  Gas: ${summary.sending.gasUsd}`)
  }

  if (summary.receiving) {
    lines.push('')
    lines.push('Receiving:')
    lines.push(`  Chain: ${summary.receiving.chainId}`)
    lines.push(`  Amount: ${summary.receiving.amount}`)
    lines.push(`  Tx: ${summary.receiving.txHash ?? 'N/A'}`)
  }

  if (summary.explorerLink) {
    lines.push('')
    lines.push(`Explorer: ${summary.explorerLink}`)
  }

  return lines.join('\n')
}
