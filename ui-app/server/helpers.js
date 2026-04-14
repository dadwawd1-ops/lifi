import { randomUUID } from 'node:crypto'
import { normalizeTokenLike } from '../../lifi-feature/src/yield-execution-plan.js'
import { normalizeVaultCandidate } from '../../lifi-feature/src/earn-vault-selector.js'

export const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:8787'

function asText(value) {
  if (value === undefined || value === null) {
    return null
  }
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function asPositiveInt(value, fallback = null) {
  const num = Number(value)
  if (!Number.isInteger(num) || num <= 0) {
    return fallback
  }
  return num
}

function asFiniteNumber(value, fallback = null) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return num
}

function extractCollection(payload, keys) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key]
    }
  }

  return []
}

function normalizeChain(raw) {
  const chainId =
    asPositiveInt(raw?.id) ??
    asPositiveInt(raw?.chainId) ??
    asPositiveInt(raw?.chain_id) ??
    null

  return {
    chainId,
    key:
      asText(raw?.key) ??
      asText(raw?.slug) ??
      asText(raw?.name) ??
      (chainId ? String(chainId) : null),
    name:
      asText(raw?.name) ??
      asText(raw?.label) ??
      asText(raw?.slug) ??
      (chainId ? `Chain ${chainId}` : 'Unknown chain'),
    raw,
  }
}

function normalizeProtocol(raw) {
  const name =
    asText(raw?.name) ??
    asText(raw?.slug) ??
    asText(raw?.id) ??
    asText(raw)

  return {
    id:
      asText(raw?.id) ??
      asText(raw?.slug) ??
      name ??
      'unknown',
    name: name ?? 'Unknown protocol',
    raw,
  }
}

function compareMaybeDesc(a, b) {
  const left = Number.isFinite(a) ? a : -Infinity
  const right = Number.isFinite(b) ? b : -Infinity
  return right - left
}

function compareVaults(sortBy) {
  return (left, right) => {
    if (sortBy === 'tvl') {
      const byTvl = compareMaybeDesc(left.tvl, right.tvl)
      if (byTvl !== 0) {
        return byTvl
      }
      return compareMaybeDesc(left.apy, right.apy)
    }

    const byApy = compareMaybeDesc(left.apy, right.apy)
    if (byApy !== 0) {
      return byApy
    }
    return compareMaybeDesc(left.tvl, right.tvl)
  }
}

export function normalizeChainsResponse(payload) {
  return extractCollection(payload, ['data', 'chains', 'items'])
    .map(normalizeChain)
    .filter(item => item.chainId)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function normalizeProtocolsResponse(payload) {
  return extractCollection(payload, ['data', 'protocols', 'items'])
    .map(normalizeProtocol)
    .filter(item => item.name)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function normalizeVaultsResponse(payload, options = {}) {
  const sortBy = String(options.sortBy ?? 'apy').toLowerCase() === 'tvl'
    ? 'tvl'
    : 'apy'
  const chainId = asPositiveInt(options.chainId)
  const protocol = asText(options.protocol)?.toLowerCase() ?? null
  const vaultAddress = normalizeTokenLike(options.vaultAddress)
  const limit = asPositiveInt(options.limit)

  let items = extractCollection(payload?.items ?? payload, ['data', 'vaults', 'items'])
    .map(normalizeVaultCandidate)
    .filter(vault => vault.isTransactional === true && Boolean(vault.address))

  if (chainId) {
    items = items.filter(vault => vault.chainId === chainId)
  }

  if (protocol) {
    items = items.filter(vault => String(vault.protocol ?? '').toLowerCase() === protocol)
  }

  if (vaultAddress) {
    items = items.filter(vault => normalizeTokenLike(vault.address) === vaultAddress)
  }

  items = items.sort(compareVaults(sortBy))

  if (limit) {
    items = items.slice(0, limit)
  }

  return items.map(vault => ({
    ...vault,
    sortBy,
  }))
}

export function inferSkillType(sourceToken, destinationVault) {
  const source = normalizeTokenLike(sourceToken)
  const candidates = [
    destinationVault?.depositToken?.address,
    destinationVault?.depositToken?.symbol,
    destinationVault?.asset?.symbol,
  ]
    .map(normalizeTokenLike)
    .filter(Boolean)

  return source && candidates.includes(source)
    ? 'bridge-assets'
    : 'swap-then-bridge'
}

export function translateTaskToRuntimeRequest({
  batchId,
  destinationVault,
  runtime,
  task,
}) {
  if (!destinationVault?.chainId) {
    throw new Error('destinationVault.chainId is required')
  }

  const fromChain = asPositiveInt(task?.fromChain)
  if (!fromChain) {
    throw new Error('task.fromChain must be a positive integer')
  }

  const sourceToken = asText(task?.sourceToken)
  if (!sourceToken) {
    throw new Error('task.sourceToken is required')
  }

  const amount = asText(task?.amount)
  if (!amount) {
    throw new Error('task.amount is required')
  }

  const fromAddress = asText(task?.fromAddress) ?? asText(runtime?.walletAddress)
  if (!fromAddress) {
    throw new Error('runtime.walletAddress or task.fromAddress is required')
  }

  const skillId = inferSkillType(sourceToken, destinationVault)
  const operationTaskId = asText(task?.id) ?? randomUUID()
  const input = {
    fromChain,
    toChain: destinationVault.chainId,
    amount,
    fromAddress,
    receiver: fromAddress,
    selectedVault: destinationVault,
    enableDeposit: runtime?.mode === 'execute',
    autoConfirm: true,
    confirmed: true,
    operationId: `ui-batch-${batchId}-${operationTaskId}`,
  }

  const slippage = asFiniteNumber(task?.slippage)
  if (slippage !== null) {
    input.slippage = slippage
  }

  if (skillId === 'bridge-assets') {
    input.token = sourceToken
  } else {
    input.fromToken = sourceToken
    input.toToken = destinationVault?.depositToken?.address
  }

  return {
    taskId: operationTaskId,
    skillId,
    input,
  }
}

export function buildRuntimeHeaders(runtimeConfig = {}) {
  const headers = {
    'Content-Type': 'application/json',
  }

  const token = asText(runtimeConfig.token)
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

export function getRuntimeBaseUrl(runtimeConfig = {}) {
  return (asText(runtimeConfig.baseUrl) ?? DEFAULT_RUNTIME_URL).replace(/\/$/, '')
}

export function summarizeBatchResults(results, startedAt) {
  const total = results.length
  let completed = 0
  let failed = 0
  let nonTerminal = 0

  for (const item of results) {
    const state =
      item.runtimeResponse?.state ??
      item.runtimeResponse?.result?.state ??
      item.error?.state ??
      'unknown'

    if (state === 'completed') {
      completed += 1
    } else if (state === 'failed' || item.error) {
      failed += 1
    } else {
      nonTerminal += 1
    }
  }

  return {
    total,
    completed,
    failed,
    nonTerminal,
    elapsedMs: Date.now() - startedAt,
  }
}
