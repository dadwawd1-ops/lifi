import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  EarnClient,
  LiFiClient,
  summarizeQuote,
  formatQuotePreview,
} from '../src/index.js'

const DEFAULT_FROM_CHAIN = 1
const DEFAULT_FROM_TOKEN = 'USDC'
const DEFAULT_FROM_AMOUNT = '1000000'
const DEFAULT_FROM_ADDRESS = '0x1111111111111111111111111111111111111111'
const DEFAULT_SLIPPAGE = 0.003
const DEFAULT_MAX_PAGES = 3
const DEFAULT_PAGE_LIMIT = 100
const DEFAULT_SORT_BY = 'apy'
const DEFAULT_TOP_N = 10
const DEFAULT_RANK = 1

function toPrettyJson(value) {
  return JSON.stringify(value, null, 2)
}

function writeOutputFile(filePath, content) {
  const resolvedPath = resolve(filePath)
  const parent = dirname(resolvedPath)
  mkdirSync(parent, { recursive: true })
  const text = content.endsWith('\n') ? content : `${content}\n`
  writeFileSync(resolvedPath, text, 'utf8')
}

function createLogger(common) {
  const lines = []
  const log = (line = '') => {
    const text = String(line)
    lines.push(text)
    if (!common.quiet) {
      console.log(text)
    }
  }
  return { lines, log }
}

function finalizeOutput(common, textLines, jsonPayload = null) {
  if (common.json && jsonPayload !== null) {
    const jsonText = toPrettyJson(jsonPayload)
    console.log(jsonText)
    if (common.outPath) {
      writeOutputFile(common.outPath, jsonText)
    }
    return
  }

  if (common.outPath) {
    writeOutputFile(common.outPath, textLines.join('\n'))
  }
}

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
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toBoolean(value, fallback = null) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false
  }

  return fallback
}

function formatUsd(value) {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 2 : 4,
  }).format(value)
}

function formatPercentMaybeFraction(value) {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  const normalized = value <= 1 ? value * 100 : value
  return `${normalized.toFixed(2)}%`
}

function parseArgVector(argv) {
  const result = {
    positionals: [],
    flags: new Set(),
    values: {},
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      result.positionals.push(token)
      continue
    }

    const raw = token.slice(2)
    if (!raw) {
      continue
    }

    if (raw.includes('=')) {
      const [name, ...rest] = raw.split('=')
      result.values[name] = rest.join('=')
      continue
    }

    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      result.flags.add(raw)
      continue
    }

    result.values[raw] = next
    i += 1
  }

  return result
}

function pickFirstAddress(raw) {
  const value = asNonEmptyString(raw)
  if (value) {
    return value
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
    const keys = ['address', 'token', 'id', 'value']
    for (const key of keys) {
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
    input?.network,
    input?.fromChainId,
    input?.toChainId,
  ]
  for (const raw of candidates) {
    const n = toInt(raw)
    if (n && n > 0) {
      return n
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
  for (const raw of candidates) {
    const n = toFloat(raw)
    if (n !== null) {
      return n
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
  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const parsed = toFloat(raw.replace(/,/g, ''))
      if (parsed !== null) {
        return parsed
      }
    }
    const n = toFloat(raw)
    if (n !== null) {
      return n
    }
  }
  return null
}

function resolveUsdLike(input) {
  const candidates = [
    input?.usdValue,
    input?.usd_value,
    input?.valueUsd,
    input?.balanceUsd,
    input?.balance_usd,
    input?.marketValueUsd,
    input?.netValueUsd,
    input?.value?.usd,
    input?.stats?.usdValue,
    input?.vault?.usdValue,
  ]

  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const parsed = toFloat(raw.replace(/,/g, ''))
      if (parsed !== null) {
        return parsed
      }
    }
    const n = toFloat(raw)
    if (n !== null) {
      return n
    }
  }

  return null
}

function formatProtocol(raw) {
  if (typeof raw === 'string') {
    return raw.trim() || 'Unknown protocol'
  }
  if (Array.isArray(raw)) {
    const parts = raw.map(formatProtocol).filter(x => x && x !== 'Unknown protocol')
    return parts.length > 0 ? parts.join(', ') : 'Unknown protocol'
  }
  if (raw && typeof raw === 'object') {
    const keys = ['name', 'id', 'slug', 'protocol', 'displayName']
    for (const key of keys) {
      const found = formatProtocol(raw[key])
      if (found !== 'Unknown protocol') {
        return found
      }
    }
  }
  return 'Unknown protocol'
}

function normalizeProtocol(raw) {
  return asNonEmptyString(raw)?.toLowerCase() ?? null
}

function protocolMatches(input, requestedProtocol) {
  if (!requestedProtocol) {
    return true
  }

  const value = formatProtocol(input?.protocol ?? input?.protocolName).toLowerCase()
  return value.includes(requestedProtocol)
}

function normalizeVault(vault) {
  const chainId = resolveChainIdLike(vault)
  const address = pickFirstAddress(
    vault?.address
    ?? vault?.vaultAddress
    ?? vault?.depositAddress
    ?? vault?.contractAddress
    ?? vault?.vault
    ?? vault?.token
    ?? vault?.depositToken
    ?? vault?.underlyingToken
    ?? vault?.shareToken
    ?? vault?.asset
    ?? vault?.meta,
  )

  return {
    raw: vault,
    name: vault?.name ?? vault?.id ?? 'Unknown vault',
    protocol: formatProtocol(vault?.protocol ?? vault?.protocolName),
    chainId,
    address,
    apy: resolveApyLike(vault),
    tvl: resolveTvlLike(vault),
    isTransactional: vault?.isTransactional,
    isRedeemable: vault?.isRedeemable,
  }
}

function normalizePosition(position) {
  const vault = position?.vault ?? {}
  const asset = position?.asset ?? position?.token ?? {}
  const amount = asNonEmptyString(
    position?.formattedAmount
    ?? position?.formattedBalance
    ?? position?.amountFormatted
    ?? position?.balanceFormatted,
  ) ?? String(position?.amount ?? position?.balance ?? '')

  return {
    raw: position,
    name: position?.name ?? vault?.name ?? asset?.symbol ?? 'Unknown position',
    protocol: formatProtocol(
      position?.protocol
      ?? position?.protocolName
      ?? vault?.protocol
      ?? vault?.protocolName,
    ),
    chainId: resolveChainIdLike(position) ?? resolveChainIdLike(vault),
    vaultAddress: pickFirstAddress(
      position?.vaultAddress
      ?? vault?.address
      ?? vault?.vaultAddress
      ?? vault?.depositAddress,
    ),
    tokenSymbol: asset?.symbol ?? position?.symbol ?? null,
    amount: amount || null,
    usdValue: resolveUsdLike(position),
    apy: resolveApyLike(position) ?? resolveApyLike(vault),
    isRedeemable: position?.isRedeemable ?? vault?.isRedeemable,
  }
}

function compareMaybeNumbersDesc(a, b) {
  const ax = Number.isFinite(a) ? a : -Infinity
  const bx = Number.isFinite(b) ? b : -Infinity
  return bx - ax
}

function sortVaults(items, sortBy) {
  const sorted = [...items]
  sorted.sort((a, b) => {
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
  })
  return sorted
}

function filterVaults(vaults, options) {
  return vaults.filter(item => {
    if (!item.address || !item.chainId) {
      return false
    }
    if (options.chainId && item.chainId !== options.chainId) {
      return false
    }
    if (!protocolMatches(item.raw, options.protocol)) {
      return false
    }
    if (options.requireTransactional && item.isTransactional === false) {
      return false
    }
    if (options.requireRedeemable && item.isRedeemable === false) {
      return false
    }
    if (options.vaultAddress && item.address.toLowerCase() !== options.vaultAddress.toLowerCase()) {
      return false
    }
    return true
  })
}

function filterPositions(positions, options) {
  return positions.filter(item => {
    if (options.chainId && item.chainId !== options.chainId) {
      return false
    }
    if (options.protocol) {
      const p = (item.protocol ?? '').toLowerCase()
      if (!p.includes(options.protocol)) {
        return false
      }
    }
    return true
  })
}

function aggregateTotalsBy(items, keyGetter, valueGetter) {
  const map = new Map()
  for (const item of items) {
    const key = keyGetter(item)
    if (!key) {
      continue
    }
    const value = valueGetter(item)
    if (!Number.isFinite(value)) {
      continue
    }
    map.set(key, (map.get(key) ?? 0) + value)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function printCliHelp() {
  const lines = [
    'Usage: node ./examples/lifi-earn-cli.mjs <group> <action> [options]',
    '',
    'Groups and actions:',
    '  vaults list       List vault candidates from Earn API',
    '  vaults select     Select one vault by filters/rank',
    '  quote preview     Select vault and generate LI.FI quote preview',
    '  portfolio summary Summarize Earn portfolio positions for an address',
    '  portfolio to-quote Build quote from portfolio position -> target vault',
    '',
    'Common options:',
    '  --earn-base-url <url>      Earn base URL (default: env LI_FI_EARN_BASE_URL or https://earn.li.fi)',
    '  --quote-base-url <url>     Quote base URL (default: env LI_FI_BASE_URL or https://li.quest/v1)',
    '  --api-key <key>            LI.FI API key (or env LI_FI_API_KEY)',
    '  --integrator <name>        Integrator name (or env LI_FI_INTEGRATOR)',
    '  --max-pages <n>            Max pages for cursor pagination (default: 3)',
    '  --page-limit <n>           Page size hint (default: 100)',
    '  --out <path>               Write output to file (text mode or JSON mode)',
    '  --json                     Emit JSON output',
    '  --quiet                    Suppress text output',
    '',
    'Vault options:',
    '  --chain <id>               Chain filter (also used for quote vault selection)',
    '  --protocol <name>          Protocol filter (substring match)',
    '  --vault-address <address>  Exact vault address',
    '  --sort-by <apy|tvl>        Sort key for ranking',
    '  --top-n <n>                Number of candidates to print',
    '  --rank <n>                 Selected rank for vaults select / quote preview',
    '  --require-transactional <bool>  Require isTransactional != false',
    '  --require-redeemable <bool>     Require isRedeemable != false',
    '',
    'Quote options:',
    '  --from-chain <id>          Source chain id (alias of --chain for quote)',
    '  --from-token <symbol|addr> Source token (default: USDC)',
    '  --from-amount <raw>        Source amount in raw units',
    '  --from-address <address>   Sender wallet address',
    '  --slippage <num>           Slippage (default: 0.003)',
    '',
    'Portfolio options:',
    '  --address <wallet>         Wallet address (or env LI_FI_PORTFOLIO_ADDRESS)',
    '  --position-rank <n>        Portfolio position rank for to-quote (default: 1)',
    '  --position-vault <address> Force source position by vault address',
    '  --to-vault-address <addr>  Target vault address for portfolio to-quote',
    '  --to-vault-rank <n>        Target vault rank when not forcing address (default: 1)',
    '',
    'Examples:',
    '  npm run lifi:cli -- vaults list --chain 1 --top-n 5',
    '  npm run lifi:cli -- vaults select --chain 1 --protocol aave-v3 --rank 1 --json',
    '  npm run lifi:cli -- quote preview --from-chain 1 --from-token USDC --from-amount 1000000',
    '  npm run lifi:cli -- portfolio summary --address 0x1111111111111111111111111111111111111111 --json',
    '  npm run lifi:cli -- portfolio to-quote --address 0x1111111111111111111111111111111111111111 --to-vault-rank 1 --json',
  ]
  console.log(lines.join('\n'))
}

function printVaultRows(log, title, rows, topN) {
  const take = Math.max(1, topN)
  const items = rows.slice(0, take)
  log(`=== ${title} ===`)
  if (items.length === 0) {
    log('No results.')
    log('')
    return
  }

  items.forEach((item, idx) => {
    log(
      `${idx + 1}. ${item.name} | protocol=${item.protocol} | chain=${item.chainId} | APY=${formatPercentMaybeFraction(item.apy)} | TVL=${formatUsd(item.tvl)}`,
    )
    log(`   address=${item.address}`)
  })
  log('')
}

function printVaultDetail(log, selected, pageCount, candidateCount) {
  const txFlag = selected.isTransactional === false ? 'false' : 'true_or_unknown'
  const redeemFlag = selected.isRedeemable === false ? 'false' : 'true_or_unknown'
  log('=== Vault Selection ===')
  log(`Source pages fetched: ${pageCount}`)
  log(`Candidate count: ${candidateCount}`)
  log(`Vault name: ${selected.name}`)
  log(`Protocol: ${selected.protocol}`)
  log(`Chain: ${selected.chainId}`)
  log(`Vault address: ${selected.address}`)
  log(`APY: ${formatPercentMaybeFraction(selected.apy)}`)
  log(`TVL: ${formatUsd(selected.tvl)}`)
  log(`isTransactional: ${txFlag}`)
  log(`isRedeemable: ${redeemFlag}`)
  log('')
}

function printPortfolioSummary(log, summary) {
  log('=== Portfolio Summary ===')
  log(`Address: ${summary.address}`)
  log(`Positions (filtered): ${summary.filteredCount}`)
  log(`Positions (raw fetched): ${summary.rawCount}`)
  log(`Pages fetched: ${summary.pageCount}`)
  log(`Total USD value: ${formatUsd(summary.totalUsdValue)}`)
  log('')

  if (summary.byChain.length > 0) {
    log('By Chain:')
    for (const [chain, usd] of summary.byChain.slice(0, 8)) {
      log(`  - chain ${chain}: ${formatUsd(usd)}`)
    }
    log('')
  }

  if (summary.byProtocol.length > 0) {
    log('By Protocol:')
    for (const [protocol, usd] of summary.byProtocol.slice(0, 8)) {
      log(`  - ${protocol}: ${formatUsd(usd)}`)
    }
    log('')
  }

  if (summary.topPositions.length > 0) {
    log('Top Positions:')
    summary.topPositions.forEach((item, idx) => {
      const tokenPart = item.tokenSymbol ? ` ${item.tokenSymbol}` : ''
      const amountPart = item.amount ? ` | amount=${item.amount}${tokenPart}` : ''
      log(
        `  ${idx + 1}. ${item.name} | protocol=${item.protocol} | chain=${item.chainId ?? 'n/a'} | usd=${formatUsd(item.usdValue)}${amountPart}`,
      )
      if (item.vaultAddress) {
        log(`     vault=${item.vaultAddress}`)
      }
    })
    log('')
  }
}

function resolveCommonOptions(parsed) {
  return {
    json: parsed.flags.has('json'),
    quiet: parsed.flags.has('quiet'),
    outPath: asNonEmptyString(parsed.values.out),
    earnBaseUrl: asNonEmptyString(
      parsed.values['earn-base-url'] ?? process.env.LI_FI_EARN_BASE_URL ?? 'https://earn.li.fi',
    ) ?? 'https://earn.li.fi',
    quoteBaseUrl: asNonEmptyString(
      parsed.values['quote-base-url'] ?? process.env.LI_FI_BASE_URL ?? 'https://li.quest/v1',
    ) ?? 'https://li.quest/v1',
    apiKey: asNonEmptyString(parsed.values['api-key'] ?? process.env.LI_FI_API_KEY),
    integrator: asNonEmptyString(
      parsed.values.integrator ?? process.env.LI_FI_INTEGRATOR ?? 'lifi-feature-demo',
    ) ?? 'lifi-feature-demo',
    maxPages: Math.max(
      1,
      toInt(parsed.values['max-pages'] ?? process.env.EARN_VAULT_MAX_PAGES ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES),
    ),
    pageLimit: Math.max(
      1,
      toInt(parsed.values['page-limit'] ?? process.env.EARN_VAULT_PAGE_LIMIT ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT),
    ),
    topN: Math.max(
      1,
      toInt(parsed.values['top-n'] ?? process.env.EARN_VAULT_TOP_N ?? DEFAULT_TOP_N, DEFAULT_TOP_N),
    ),
  }
}

function resolveVaultSelectionOptions(parsed) {
  const chainId = toInt(
    parsed.values['chain']
    ?? parsed.values['from-chain']
    ?? process.env.LI_FI_FROM_CHAIN
    ?? DEFAULT_FROM_CHAIN,
    DEFAULT_FROM_CHAIN,
  )
  const sortByRaw = String(
    parsed.values['sort-by']
    ?? process.env.EARN_VAULT_SORT_BY
    ?? DEFAULT_SORT_BY,
  ).toLowerCase()

  return {
    chainId,
    protocol: normalizeProtocol(parsed.values.protocol ?? process.env.EARN_VAULT_PROTOCOL),
    vaultAddress: asNonEmptyString(
      parsed.values['vault-address'] ?? process.env.EARN_VAULT_ADDRESS,
    ),
    sortBy: sortByRaw === 'tvl' ? 'tvl' : 'apy',
    rank: Math.max(1, toInt(parsed.values.rank ?? process.env.EARN_VAULT_RANK ?? DEFAULT_RANK, DEFAULT_RANK)),
    requireTransactional: toBoolean(
      parsed.values['require-transactional'] ?? process.env.EARN_REQUIRE_TRANSACTIONAL,
      true,
    ),
    requireRedeemable: toBoolean(
      parsed.values['require-redeemable'] ?? process.env.EARN_REQUIRE_REDEEMABLE,
      false,
    ),
  }
}

function resolveQuoteOptions(parsed, vaultOptions) {
  return {
    fromChain: toInt(
      parsed.values['from-chain'] ?? vaultOptions.chainId ?? process.env.LI_FI_FROM_CHAIN ?? DEFAULT_FROM_CHAIN,
      DEFAULT_FROM_CHAIN,
    ),
    fromToken: asNonEmptyString(
      parsed.values['from-token'] ?? process.env.LI_FI_FROM_TOKEN ?? DEFAULT_FROM_TOKEN,
    ) ?? DEFAULT_FROM_TOKEN,
    fromAmount: asNonEmptyString(
      parsed.values['from-amount'] ?? process.env.LI_FI_FROM_AMOUNT ?? DEFAULT_FROM_AMOUNT,
    ) ?? DEFAULT_FROM_AMOUNT,
    fromAddress: asNonEmptyString(
      parsed.values['from-address'] ?? process.env.LI_FI_FROM_ADDRESS ?? DEFAULT_FROM_ADDRESS,
    ) ?? DEFAULT_FROM_ADDRESS,
    slippage: toFloat(
      parsed.values['slippage'] ?? process.env.LI_FI_SLIPPAGE ?? DEFAULT_SLIPPAGE,
      DEFAULT_SLIPPAGE,
    ),
  }
}

function resolvePortfolioOptions(parsed) {
  const address = asNonEmptyString(
    parsed.values.address ?? process.env.LI_FI_PORTFOLIO_ADDRESS,
  )
  if (!address) {
    throw new Error('portfolio summary requires --address or LI_FI_PORTFOLIO_ADDRESS.')
  }

  return {
    address,
    chainId: toInt(parsed.values.chain ?? process.env.LI_FI_PORTFOLIO_CHAIN, null),
    protocol: normalizeProtocol(parsed.values.protocol ?? process.env.LI_FI_PORTFOLIO_PROTOCOL),
    positionRank: Math.max(
      1,
      toInt(parsed.values['position-rank'] ?? process.env.LI_FI_POSITION_RANK ?? DEFAULT_RANK, DEFAULT_RANK),
    ),
    positionVault: asNonEmptyString(
      parsed.values['position-vault'] ?? process.env.LI_FI_POSITION_VAULT,
    ),
    toVaultAddress: asNonEmptyString(
      parsed.values['to-vault-address'] ?? process.env.LI_FI_TO_VAULT_ADDRESS,
    ),
    toVaultRank: Math.max(
      1,
      toInt(parsed.values['to-vault-rank'] ?? process.env.LI_FI_TO_VAULT_RANK ?? DEFAULT_RANK, DEFAULT_RANK),
    ),
  }
}

function pickSourcePosition(positions, portfolioOptions) {
  if (positions.length === 0) {
    return null
  }

  if (portfolioOptions.positionVault) {
    const forced = positions.find(
      item => item.vaultAddress
        && item.vaultAddress.toLowerCase() === portfolioOptions.positionVault.toLowerCase(),
    )
    return forced ?? null
  }

  const ranked = [...positions].sort((a, b) => compareMaybeNumbersDesc(a.usdValue, b.usdValue))
  const index = Math.max(1, portfolioOptions.positionRank) - 1
  return ranked[index] ?? null
}

async function fetchVaultCandidates(earn, commonOptions, vaultOptions) {
  const params = {
    limit: commonOptions.pageLimit,
  }
  if (vaultOptions.chainId) {
    params.chainIds = vaultOptions.chainId
  }

  const { items, pageCount, hasMore, nextCursor } = await earn.getAllVaults(
    params,
    { maxPages: commonOptions.maxPages },
  )

  const normalized = items.map(normalizeVault)
  const filtered = filterVaults(normalized, vaultOptions)
  const sorted = sortVaults(filtered, vaultOptions.sortBy)

  return {
    items,
    pageCount,
    hasMore,
    nextCursor,
    candidates: sorted,
  }
}

function pickRankedCandidate(candidates, rank) {
  const index = Math.max(1, rank) - 1
  if (index >= candidates.length) {
    return null
  }
  return candidates[index]
}

async function runVaultsList(parsed) {
  const common = resolveCommonOptions(parsed)
  const logger = createLogger(common)
  const { log } = logger
  const vaultOptions = resolveVaultSelectionOptions(parsed)
  const earn = new EarnClient({ baseUrl: common.earnBaseUrl })

  const fetched = await fetchVaultCandidates(earn, common, vaultOptions)

  printVaultRows(log, 'Vault Candidates', fetched.candidates, common.topN)
  log(`Fetched pages: ${fetched.pageCount}, raw vault count: ${fetched.items.length}, candidate count: ${fetched.candidates.length}`)
  log('')

  let payload = null
  if (common.json) {
    payload = {
      command: 'vaults list',
      options: {
        chainId: vaultOptions.chainId,
        protocol: vaultOptions.protocol,
        sortBy: vaultOptions.sortBy,
        requireTransactional: vaultOptions.requireTransactional,
        requireRedeemable: vaultOptions.requireRedeemable,
      },
      pagination: {
        pageCount: fetched.pageCount,
        hasMore: fetched.hasMore,
        nextCursor: fetched.nextCursor,
      },
      counts: {
        rawVaults: fetched.items.length,
        candidates: fetched.candidates.length,
      },
      candidates: fetched.candidates.slice(0, common.topN).map(item => ({
        name: item.name,
        protocol: item.protocol,
        chainId: item.chainId,
        address: item.address,
        apy: item.apy,
        tvl: item.tvl,
        isTransactional: item.isTransactional,
        isRedeemable: item.isRedeemable,
      })),
    }
  }

  finalizeOutput(common, logger.lines, payload)
}

async function runVaultsSelect(parsed) {
  const common = resolveCommonOptions(parsed)
  const logger = createLogger(common)
  const { log } = logger
  const vaultOptions = resolveVaultSelectionOptions(parsed)
  const earn = new EarnClient({ baseUrl: common.earnBaseUrl })

  const fetched = await fetchVaultCandidates(earn, common, vaultOptions)
  const selected = pickRankedCandidate(fetched.candidates, vaultOptions.rank)
  if (!selected) {
    throw new Error(`No candidate at rank ${vaultOptions.rank}. Candidate count: ${fetched.candidates.length}.`)
  }

  printVaultRows(log, 'Vault Candidates', fetched.candidates, common.topN)
  printVaultDetail(log, selected, fetched.pageCount, fetched.candidates.length)

  let payload = null
  if (common.json) {
    payload = {
      command: 'vaults select',
      rank: vaultOptions.rank,
      selected: {
        name: selected.name,
        protocol: selected.protocol,
        chainId: selected.chainId,
        address: selected.address,
        apy: selected.apy,
        tvl: selected.tvl,
        isTransactional: selected.isTransactional,
        isRedeemable: selected.isRedeemable,
      },
      pagination: {
        pageCount: fetched.pageCount,
        hasMore: fetched.hasMore,
        nextCursor: fetched.nextCursor,
      },
      candidateCount: fetched.candidates.length,
    }
  }

  finalizeOutput(common, logger.lines, payload)
}

async function runQuotePreview(parsed) {
  const common = resolveCommonOptions(parsed)
  const logger = createLogger(common)
  const { log } = logger
  const vaultOptions = resolveVaultSelectionOptions(parsed)
  const quoteOptions = resolveQuoteOptions(parsed, vaultOptions)

  const earn = new EarnClient({ baseUrl: common.earnBaseUrl })
  const quoteClient = new LiFiClient({
    baseUrl: common.quoteBaseUrl,
    apiKey: common.apiKey,
    integrator: common.integrator,
  })

  const fetched = await fetchVaultCandidates(earn, common, vaultOptions)
  const selected = pickRankedCandidate(fetched.candidates, vaultOptions.rank)
  if (!selected) {
    throw new Error(`No candidate at rank ${vaultOptions.rank}. Candidate count: ${fetched.candidates.length}.`)
  }

  printVaultRows(log, 'Vault Candidates', fetched.candidates, common.topN)
  printVaultDetail(log, selected, fetched.pageCount, fetched.candidates.length)

  const quote = await quoteClient.getQuote({
    fromChain: quoteOptions.fromChain,
    toChain: selected.chainId,
    fromToken: quoteOptions.fromToken,
    toToken: selected.address,
    fromAmount: quoteOptions.fromAmount,
    fromAddress: quoteOptions.fromAddress,
    slippage: quoteOptions.slippage,
  })
  const quoteSummary = summarizeQuote(quote)

  log(formatQuotePreview(quoteSummary))

  let payload = null
  if (common.json) {
    payload = {
      command: 'quote preview',
      quoteInput: quoteOptions,
      selectedVault: {
        name: selected.name,
        protocol: selected.protocol,
        chainId: selected.chainId,
        address: selected.address,
        apy: selected.apy,
        tvl: selected.tvl,
        isTransactional: selected.isTransactional,
        isRedeemable: selected.isRedeemable,
      },
      pagination: {
        pageCount: fetched.pageCount,
        hasMore: fetched.hasMore,
        nextCursor: fetched.nextCursor,
      },
      candidateCount: fetched.candidates.length,
      quoteSummary,
    }
  }

  finalizeOutput(common, logger.lines, payload)
}

async function runPortfolioSummary(parsed) {
  const common = resolveCommonOptions(parsed)
  const logger = createLogger(common)
  const { log } = logger
  const portfolioOptions = resolvePortfolioOptions(parsed)
  const earn = new EarnClient({ baseUrl: common.earnBaseUrl })

  const params = {
    limit: common.pageLimit,
  }
  if (portfolioOptions.chainId) {
    params.chainIds = portfolioOptions.chainId
  }

  const { items, pageCount, hasMore, nextCursor } = await earn.getAllPortfolioPositions(
    portfolioOptions.address,
    params,
    { maxPages: common.maxPages },
  )

  const normalized = items.map(normalizePosition)
  const filtered = filterPositions(normalized, portfolioOptions)
  const byUsd = [...filtered].sort((a, b) => compareMaybeNumbersDesc(a.usdValue, b.usdValue))
  const topPositions = byUsd.slice(0, common.topN)
  const totalUsdValue = filtered.reduce((sum, item) => {
    if (!Number.isFinite(item.usdValue)) {
      return sum
    }
    return sum + item.usdValue
  }, 0)

  const summary = {
    address: portfolioOptions.address,
    rawCount: normalized.length,
    filteredCount: filtered.length,
    pageCount,
    hasMore,
    nextCursor,
    totalUsdValue,
    byChain: aggregateTotalsBy(filtered, item => item.chainId, item => item.usdValue),
    byProtocol: aggregateTotalsBy(filtered, item => item.protocol, item => item.usdValue),
    topPositions,
  }

  printPortfolioSummary(log, summary)

  let payload = null
  if (common.json) {
    payload = {
      command: 'portfolio summary',
      filters: {
        address: portfolioOptions.address,
        chainId: portfolioOptions.chainId,
        protocol: portfolioOptions.protocol,
      },
      pagination: {
        pageCount,
        hasMore,
        nextCursor,
      },
      summary: {
        rawCount: summary.rawCount,
        filteredCount: summary.filteredCount,
        totalUsdValue: summary.totalUsdValue,
        byChain: summary.byChain,
        byProtocol: summary.byProtocol,
      },
      topPositions: topPositions.map(item => ({
        name: item.name,
        protocol: item.protocol,
        chainId: item.chainId,
        vaultAddress: item.vaultAddress,
        tokenSymbol: item.tokenSymbol,
        amount: item.amount,
        usdValue: item.usdValue,
        apy: item.apy,
        isRedeemable: item.isRedeemable,
      })),
    }
  }

  finalizeOutput(common, logger.lines, payload)
}

async function runPortfolioToQuote(parsed) {
  const common = resolveCommonOptions(parsed)
  const logger = createLogger(common)
  const { log } = logger
  const portfolioOptions = resolvePortfolioOptions(parsed)
  const vaultOptions = resolveVaultSelectionOptions(parsed)
  const quoteOptions = resolveQuoteOptions(parsed, vaultOptions)

  const earn = new EarnClient({ baseUrl: common.earnBaseUrl })
  const quoteClient = new LiFiClient({
    baseUrl: common.quoteBaseUrl,
    apiKey: common.apiKey,
    integrator: common.integrator,
  })

  const portfolioParams = {
    limit: common.pageLimit,
  }
  if (portfolioOptions.chainId) {
    portfolioParams.chainIds = portfolioOptions.chainId
  }

  const portfolioResp = await earn.getAllPortfolioPositions(
    portfolioOptions.address,
    portfolioParams,
    { maxPages: common.maxPages },
  )

  const normalizedPositions = portfolioResp.items.map(normalizePosition)
  const filteredPositions = filterPositions(normalizedPositions, portfolioOptions)
  const sourcePosition = pickSourcePosition(filteredPositions, portfolioOptions)
  if (!sourcePosition) {
    log('=== Portfolio To Quote ===')
    log('No source position found for portfolio to-quote.')
    log('')

    let payload = null
    if (common.json) {
      payload = {
        command: 'portfolio to-quote',
        status: 'no_source_position',
        message: 'No source position found for portfolio to-quote.',
        portfolio: {
          address: portfolioOptions.address,
          filters: {
            chainId: portfolioOptions.chainId,
            protocol: portfolioOptions.protocol,
            positionRank: portfolioOptions.positionRank,
            positionVault: portfolioOptions.positionVault,
          },
          counts: {
            rawCount: normalizedPositions.length,
            filteredCount: filteredPositions.length,
          },
          pagination: {
            pageCount: portfolioResp.pageCount,
            hasMore: portfolioResp.hasMore,
            nextCursor: portfolioResp.nextCursor,
          },
        },
      }
    }

    finalizeOutput(common, logger.lines, payload)
    return
  }

  const sourceChain = sourcePosition.chainId ?? quoteOptions.fromChain
  const sourceToken = sourcePosition.raw?.token?.address
    ?? sourcePosition.raw?.asset?.address
    ?? sourcePosition.raw?.tokenAddress
    ?? sourcePosition.raw?.underlyingToken?.address
    ?? quoteOptions.fromToken

  const sourceAmount = asNonEmptyString(
    sourcePosition.raw?.amount
    ?? sourcePosition.raw?.balance
    ?? sourcePosition.raw?.rawAmount
    ?? sourcePosition.raw?.value,
  ) ?? quoteOptions.fromAmount

  const targetVaultFilters = {
    ...vaultOptions,
    chainId: vaultOptions.chainId ?? sourceChain,
    vaultAddress: portfolioOptions.toVaultAddress ?? vaultOptions.vaultAddress,
    rank: portfolioOptions.toVaultRank ?? vaultOptions.rank,
  }

  const targetVaultFetched = await fetchVaultCandidates(earn, common, targetVaultFilters)
  const targetVault = pickRankedCandidate(targetVaultFetched.candidates, targetVaultFilters.rank)
  if (!targetVault) {
    throw new Error('No target vault candidate found for portfolio to-quote.')
  }

  printPortfolioSummary(log, {
    address: portfolioOptions.address,
    rawCount: normalizedPositions.length,
    filteredCount: filteredPositions.length,
    pageCount: portfolioResp.pageCount,
    totalUsdValue: filteredPositions.reduce((sum, item) => {
      if (!Number.isFinite(item.usdValue)) {
        return sum
      }
      return sum + item.usdValue
    }, 0),
    byChain: aggregateTotalsBy(filteredPositions, item => item.chainId, item => item.usdValue),
    byProtocol: aggregateTotalsBy(filteredPositions, item => item.protocol, item => item.usdValue),
    topPositions: [...filteredPositions]
      .sort((a, b) => compareMaybeNumbersDesc(a.usdValue, b.usdValue))
      .slice(0, common.topN),
  })

  log('=== Source Position (Selected) ===')
  log(`Name: ${sourcePosition.name}`)
  log(`Protocol: ${sourcePosition.protocol}`)
  log(`Chain: ${sourcePosition.chainId ?? 'n/a'}`)
  log(`Vault: ${sourcePosition.vaultAddress ?? 'n/a'}`)
  log(`Amount: ${sourcePosition.amount ?? 'n/a'} ${sourcePosition.tokenSymbol ?? ''}`.trim())
  log(`USD Value: ${formatUsd(sourcePosition.usdValue)}`)
  log('')

  printVaultRows(log, 'Target Vault Candidates', targetVaultFetched.candidates, common.topN)
  printVaultDetail(log, targetVault, targetVaultFetched.pageCount, targetVaultFetched.candidates.length)

  const quoteInput = {
    fromChain: sourceChain,
    toChain: targetVault.chainId,
    fromToken: sourceToken,
    toToken: targetVault.address,
    fromAmount: sourceAmount,
    fromAddress: quoteOptions.fromAddress,
    slippage: quoteOptions.slippage,
  }

  const quote = await quoteClient.getQuote(quoteInput)
  const quoteSummary = summarizeQuote(quote)
  log(formatQuotePreview(quoteSummary))

  let payload = null
  if (common.json) {
    payload = {
      command: 'portfolio to-quote',
      portfolio: {
        address: portfolioOptions.address,
        filters: {
          chainId: portfolioOptions.chainId,
          protocol: portfolioOptions.protocol,
          positionRank: portfolioOptions.positionRank,
          positionVault: portfolioOptions.positionVault,
        },
        counts: {
          rawCount: normalizedPositions.length,
          filteredCount: filteredPositions.length,
        },
        pagination: {
          pageCount: portfolioResp.pageCount,
          hasMore: portfolioResp.hasMore,
          nextCursor: portfolioResp.nextCursor,
        },
      },
      sourcePosition: {
        name: sourcePosition.name,
        protocol: sourcePosition.protocol,
        chainId: sourcePosition.chainId,
        vaultAddress: sourcePosition.vaultAddress,
        tokenSymbol: sourcePosition.tokenSymbol,
        amount: sourcePosition.amount,
        usdValue: sourcePosition.usdValue,
      },
      targetVault: {
        rank: targetVaultFilters.rank,
        name: targetVault.name,
        protocol: targetVault.protocol,
        chainId: targetVault.chainId,
        address: targetVault.address,
        apy: targetVault.apy,
        tvl: targetVault.tvl,
        isTransactional: targetVault.isTransactional,
        isRedeemable: targetVault.isRedeemable,
      },
      quoteInput,
      quoteSummary,
    }
  }

  finalizeOutput(common, logger.lines, payload)
}

function parseCommand(parsed) {
  if (parsed.flags.has('help')) {
    return { group: 'help', action: 'show' }
  }

  const [group, action] = parsed.positionals
  if (!group) {
    return { group: 'help', action: 'show' }
  }

  if (group === 'help') {
    return { group: 'help', action: 'show' }
  }

  return { group, action }
}

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgVector(argv)
  const cmd = parseCommand(parsed)

  if (cmd.group === 'help') {
    printCliHelp()
    return
  }

  if (cmd.group === 'vaults' && cmd.action === 'list') {
    await runVaultsList(parsed)
    return
  }

  if (cmd.group === 'vaults' && cmd.action === 'select') {
    await runVaultsSelect(parsed)
    return
  }

  if (cmd.group === 'quote' && cmd.action === 'preview') {
    await runQuotePreview(parsed)
    return
  }

  if (cmd.group === 'portfolio' && (cmd.action === 'summary' || cmd.action === 'positions')) {
    await runPortfolioSummary(parsed)
    return
  }

  if (cmd.group === 'portfolio' && cmd.action === 'to-quote') {
    await runPortfolioToQuote(parsed)
    return
  }

  throw new Error(
    `Unknown command "${cmd.group} ${cmd.action ?? ''}". Use --help for usage.`,
  )
}

const isDirectRun = (
  typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
)

if (isDirectRun) {
  runCli(process.argv.slice(2)).catch(error => {
    console.error('LI.FI CLI command failed.')
    console.error(error)
    process.exitCode = 1
  })
}
