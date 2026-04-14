import { randomUUID } from 'node:crypto'
import { Wallet } from 'ethers'
import { selectBestVault } from './earn-vault-selector.js'

export const SUPPORTED_YIELD_SKILLS = new Set([
  'bridge-assets',
  'swap-then-bridge',
])

function stringOrNull(value) {
  if (value === undefined || value === null) {
    return null
  }
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function toPositiveInt(value, label) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return n
}

function toAmount(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text) || BigInt(text) <= 0n) {
    throw new Error('amount must be a positive integer string in raw units')
  }
  return text
}

function toOptionalFloat(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined
  }
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a number`)
  }
  return n
}

export function normalizeTokenLike(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function resolveRequestedSkillId(task = {}) {
  const requestedSkillId = normalizeTokenLike(task.skillId ?? task.type)
  if (!SUPPORTED_YIELD_SKILLS.has(requestedSkillId)) {
    throw new Error(
      `Unsupported skill: ${requestedSkillId || 'unknown'}. Use bridge-assets or swap-then-bridge.`,
    )
  }
  return requestedSkillId
}

export function determineYieldSkillId(sourceToken, depositTokenAddress) {
  return normalizeTokenLike(sourceToken) !== normalizeTokenLike(depositTokenAddress)
    ? 'swap-then-bridge'
    : 'bridge-assets'
}

export function resolveDefaultWalletAddress() {
  const privateKey = stringOrNull(process.env.PRIVATE_KEY)
  if (!privateKey) {
    return null
  }

  try {
    return new Wallet(privateKey).address
  } catch (error) {
    throw new Error(
      `PRIVATE_KEY is invalid and cannot be used to derive a wallet address: ${error?.message ?? error}`,
    )
  }
}

function resolveYieldWalletAddress(task = {}, options = {}) {
  return (
    stringOrNull(task.fromAddress) ??
    stringOrNull(task.actorId) ??
    stringOrNull(options.defaultAddress) ??
    resolveDefaultWalletAddress()
  )
}

export async function prepareYieldWorkflowTask(task = {}, options = {}) {
  const requestedSkillId = resolveRequestedSkillId(task)
  const fromChain = toPositiveInt(task.fromChain, 'fromChain')
  const toChain = toPositiveInt(task.toChain, 'toChain')
  const amount = toAmount(task.amount)
  const fromAddress = resolveYieldWalletAddress(task, options)
  if (!fromAddress) {
    throw new Error(
      'fromAddress is required. Pass --fromAddress (or receiver/actorId) or configure PRIVATE_KEY so the signer wallet can be used automatically.',
    )
  }
  const receiver = fromAddress
  const sourceToken =
    stringOrNull(task.fromToken) ??
    stringOrNull(task.token) ??
    options.defaultToken ??
    'USDC'
  const requestedToToken =
    stringOrNull(task.toToken) ??
    stringOrNull(task.token) ??
    null
  const slippage = toOptionalFloat(task.slippage, 'slippage')
  const selectedVault =
    task.selectedVault ??
    await selectBestVault(toChain, {
      baseUrl: options.earnBaseUrl,
      apiKey: options.apiKey,
      sortBy: options.sortBy,
      maxPages: options.maxPages,
      limit: options.limit,
      fetchImpl: options.fetchImpl,
    })

  const depositToken = selectedVault?.depositToken ?? null
  if (!depositToken?.address) {
    throw new Error('Vault deposit token not found')
  }

  const skillId = determineYieldSkillId(sourceToken, depositToken.address)
  const enableDeposit = task.enableDeposit !== false
  const input = {
    fromChain,
    toChain,
    amount,
    fromAddress,
    receiver,
    operationId:
      stringOrNull(task.operationId) ?? `yield-${skillId}-${Date.now()}`,
    traceId: stringOrNull(task.traceId) ?? randomUUID(),
    selectedVault,
    enableDeposit,
  }

  if (slippage !== undefined) {
    input.slippage = slippage
  }

  if (skillId === 'bridge-assets') {
    input.token = sourceToken
  } else {
    input.fromToken = sourceToken
    input.toToken = depositToken.address ?? requestedToToken ?? sourceToken
  }

  return {
    requestedSkillId,
    skillId,
    input,
    selectedVault,
    depositToken,
    sourceToken,
    enableDeposit,
  }
}
