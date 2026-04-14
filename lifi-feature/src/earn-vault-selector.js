import { EarnClient } from './earn-client.js'

function asNonEmptyString(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toInt(value, fallback = null) {
  const n = Number(value)
  return Number.isInteger(n) ? n : fallback
}

function toFloat(value, fallback = null) {
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '')
    const n = Number(normalized)
    return Number.isFinite(n) ? n : fallback
  }

  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function pickFirstAddress(raw) {
  const direct = asNonEmptyString(raw)
  if (direct) {
    return direct
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = pickFirstAddress(item)
      if (found) {
        return found
      }
    }
  }

  if (raw && typeof raw === 'object') {
    for (const key of ['address', 'token', 'id', 'value', 'contractAddress']) {
      const found = pickFirstAddress(raw[key])
      if (found) {
        return found
      }
    }
  }

  return null
}

function resolveChainIdLike(input) {
  const candidates = [
    input?.chainId,
    input?.chain_id,
    input?.chain?.id,
    input?.networkId,
    input?.network?.id,
  ]

  for (const candidate of candidates) {
    const chainId = toInt(candidate)
    if (chainId && chainId > 0) {
      return chainId
    }
  }

  return null
}

function resolveApyLike(input) {
  const candidates = [
    input?.apy,
    input?.apr,
    input?.metrics?.apy,
    input?.stats?.apy,
    input?.yield?.apy,
    input?.vault?.apy,
  ]

  for (const candidate of candidates) {
    const apy = toFloat(candidate)
    if (apy !== null) {
      return apy
    }
  }

  return null
}

function resolveTvlLike(input) {
  const candidates = [
    input?.tvl,
    input?.tvlUsd,
    input?.tvl_usd,
    input?.metrics?.tvl,
    input?.metrics?.tvlUsd,
    input?.stats?.tvl,
    input?.vault?.tvlUsd,
  ]

  for (const candidate of candidates) {
    const tvl = toFloat(candidate)
    if (tvl !== null) {
      return tvl
    }
  }

  return null
}

function formatProtocol(raw) {
  const direct = asNonEmptyString(raw)
  if (direct) {
    return direct
  }

  if (Array.isArray(raw)) {
    const values = raw.map(formatProtocol).filter(Boolean)
    return values[0] ?? 'Unknown protocol'
  }

  if (raw && typeof raw === 'object') {
    for (const key of ['name', 'id', 'slug', 'displayName', 'protocol']) {
      const found = formatProtocol(raw[key])
      if (found && found !== 'Unknown protocol') {
        return found
      }
    }
  }

  return 'Unknown protocol'
}

function resolveVaultAsset(vault) {
  const asset =
    vault?.asset ??
    vault?.underlyingToken ??
    vault?.depositToken ??
    vault?.inputToken ??
    vault?.token ??
    vault?.underlying ??
    vault?.meta?.asset ??
    null

  return {
    address: pickFirstAddress(asset),
    symbol:
      asNonEmptyString(asset?.symbol) ??
      asNonEmptyString(asset?.ticker) ??
      asNonEmptyString(asset?.name),
    raw: asset,
  }
}

export function extractDepositToken(vault) {
  if (vault?.raw?.underlyingTokens?.length > 0) {
    const token = vault.raw.underlyingTokens[0]
    if (token?.address) {
      return {
        address: token.address,
        symbol: token.symbol ?? null,
        decimals: token.decimals ?? null,
      }
    }
  }

  if (vault?.raw?.depositPacks?.length > 0) {
    const pack = vault.raw.depositPacks[0]
    if (pack?.inputToken?.address) {
      return {
        address: pack.inputToken.address,
        symbol: pack.inputToken.symbol ?? null,
        decimals: pack.inputToken.decimals ?? null,
      }
    }
  }

  return null
}

export function normalizeVaultCandidate(vault) {
  const normalized = {
    raw: vault,
    name: vault?.name ?? vault?.id ?? 'Unknown vault',
    protocol: formatProtocol(vault?.protocol ?? vault?.protocolName),
    chainId: resolveChainIdLike(vault),
    address: pickFirstAddress(
      vault?.address ??
      vault?.vaultAddress ??
      vault?.depositAddress ??
      vault?.contractAddress ??
      vault?.vault,
    ),
    apy: resolveApyLike(vault),
    tvl: resolveTvlLike(vault),
    isTransactional: vault?.isTransactional === true,
    asset: resolveVaultAsset(vault),
  }

  return {
    ...normalized,
    depositToken: extractDepositToken(normalized),
  }
}

function compareMaybeNumbersDesc(a, b) {
  const ax = Number.isFinite(a) ? a : -Infinity
  const bx = Number.isFinite(b) ? b : -Infinity
  return bx - ax
}

function compareVaultCandidates(sortBy) {
  return (a, b) => {
    if (sortBy === 'tvl') {
      const byTvl = compareMaybeNumbersDesc(a.tvl, b.tvl)
      if (byTvl !== 0) {
        return byTvl
      }
      return compareMaybeNumbersDesc(a.apy, b.apy)
    }

    const byApy = compareMaybeNumbersDesc(a.apy, b.apy)
    if (byApy !== 0) {
      return byApy
    }
    return compareMaybeNumbersDesc(a.tvl, b.tvl)
  }
}

function extractVaultItems(payload) {
  if (Array.isArray(payload?.items)) {
    return payload.items
  }
  if (Array.isArray(payload?.data)) {
    return payload.data
  }
  if (Array.isArray(payload?.vaults)) {
    return payload.vaults
  }
  if (Array.isArray(payload)) {
    return payload
  }
  return []
}

export async function selectBestVault(targetChain, options = {}) {
  const chainId = toInt(targetChain)
  if (!chainId || chainId <= 0) {
    throw new Error('selectBestVault requires a positive targetChain integer')
  }

  const sortBy = String(options.sortBy ?? 'apy').toLowerCase() === 'tvl'
    ? 'tvl'
    : 'apy'

  const client = options.client ?? new EarnClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  })

  const limit = Math.max(1, toInt(options.limit, 100) ?? 100)
  const maxPages = Math.max(1, toInt(options.maxPages, 3) ?? 3)
  const payload = typeof client.getAllVaults === 'function'
    ? await client.getAllVaults(
        {
          chainId,
          limit,
          sortBy,
        },
        { maxPages },
      )
    : await client.getVaults({
        chainId,
        limit,
        sortBy,
      })

  const candidates = extractVaultItems(payload)
    .map(normalizeVaultCandidate)
    .filter(vault =>
      vault.chainId === chainId &&
      vault.isTransactional === true &&
      Boolean(vault.address),
    )
    .sort(compareVaultCandidates(sortBy))

  if (candidates.length === 0) {
    throw new Error(
      `No transactional Earn vaults found for chain ${chainId}.`,
    )
  }

  const vault = candidates[0]
  const depositToken = extractDepositToken(vault)

  return {
    ...vault,
    depositToken,
    candidateCount: candidates.length,
    pageCount: payload?.pageCount ?? 1,
    sortBy,
  }
}
