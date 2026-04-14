export function normalizeToken(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function matchesDestinationToken(sourceToken, vault) {
  const normalizedSource = normalizeToken(sourceToken)
  if (!normalizedSource) {
    return false
  }

  const candidates = [
    vault?.depositToken?.address,
    vault?.depositToken?.symbol,
    vault?.asset?.symbol,
  ]
    .map(normalizeToken)
    .filter(Boolean)

  return candidates.includes(normalizedSource)
}

export function inferSkill(task, vault) {
  return matchesDestinationToken(task?.sourceToken, vault)
    ? 'bridge-assets'
    : 'swap-then-bridge'
}

export function skillLabel(skill) {
  return skill === 'bridge-assets' ? 'Bridge' : 'Swap + Bridge'
}

export function createTask(seed = 1) {
  return {
    id: `task-${seed}`,
    fromChain: '',
    sourceToken: '',
    amount: '',
    fromAddress: '',
    slippage: '',
  }
}

export function getTaskIssues(task, runtimeWalletAddress = '') {
  const issues = []
  const fromChain = Number(task?.fromChain)
  const amount = String(task?.amount ?? '').trim()
  const slippage = String(task?.slippage ?? '').trim()
  const sourceToken = String(task?.sourceToken ?? '').trim()
  const effectiveFromAddress = String(task?.fromAddress ?? '').trim() || String(runtimeWalletAddress ?? '').trim()

  if (!Number.isInteger(fromChain) || fromChain <= 0) {
    issues.push('Source chain is required.')
  }

  if (!sourceToken) {
    issues.push('Source token is required.')
  }

  if (!/^\d+$/.test(amount) || BigInt(amount || '0') <= 0n) {
    issues.push('Amount must be a positive integer string.')
  }

  if (!effectiveFromAddress) {
    issues.push('Wallet address or from-address override is required.')
  }

  if (slippage && !Number.isFinite(Number(slippage))) {
    issues.push('Slippage must be a number when provided.')
  }

  return issues
}

export function buildBatchPayload({ runtime, destinationVault, tasks }) {
  return {
    runtime,
    destinationVault,
    tasks: tasks.map(task => ({
      id: task.id,
      fromChain: Number(task.fromChain),
      sourceToken: task.sourceToken.trim(),
      amount: task.amount.trim(),
      fromAddress: task.fromAddress.trim() || undefined,
      slippage: task.slippage === '' ? undefined : Number(task.slippage),
    })),
  }
}
