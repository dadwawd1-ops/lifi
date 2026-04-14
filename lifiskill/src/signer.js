import { setTimeout as delay } from 'node:timers/promises'
import { JsonRpcProvider, Transaction, Wallet } from 'ethers'

const DEFAULT_CHAIN_ID = 1
const RPC_BY_CHAIN = {
  1: [
    process.env.RPC_URL,
    'https://eth.llamarpc.com',
    'https://ethereum.publicnode.com',
    'https://rpc.ankr.com/eth',
  ],
  137: [
    process.env.RPC_URL_137,
    'https://polygon.llamarpc.com',
    'https://polygon-bor-rpc.publicnode.com',
    'https://rpc.ankr.com/polygon',
  ],
}

const NONCE_RETRY_ATTEMPTS = 5
const READ_RETRY_ATTEMPTS = 3
const POPULATE_RETRY_ATTEMPTS = 3
const SEND_RETRY_ATTEMPTS = 3
const RECEIPT_RETRY_ATTEMPTS = 3
const RATE_LIMIT_RETRY_DELAY_MS = 2_000
const BROADCAST_VISIBILITY_DELAY_MS = 3_000
const RECEIPT_WAIT_TIMEOUT_MS = 120_000

const providerContextsPromises = new Map()

function toChainId(value, fallback = DEFAULT_CHAIN_ID) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function getRpcList(chainId) {
  const list = RPC_BY_CHAIN[toChainId(chainId, DEFAULT_CHAIN_ID)] ?? []
  return list.filter(Boolean)
}

function getErrorMessage(error) {
  return error?.shortMessage ?? error?.message ?? String(error)
}

function writeLog(logger, level, ...args) {
  const target =
    logger && typeof logger[level] === 'function'
      ? logger[level].bind(logger)
      : logger && typeof logger.log === 'function'
        ? logger.log.bind(logger)
        : console.log.bind(console)

  target(...args)
}

function isRateLimitError(error) {
  const message = getErrorMessage(error)
  return (
    error?.code === 'UNKNOWN_ERROR' ||
    error?.status === 429 ||
    error?.error?.code === 429 ||
    /429|rate limit|too many requests/i.test(message)
  )
}

function isRetriableRpcError(error) {
  const message = getErrorMessage(error)
  return (
    isRateLimitError(error) ||
    /timeout|timed out|socket hang up|temporarily unavailable|503|502|504|network error|econnreset|econnrefused|ehostunreach|enotfound/i.test(
      message,
    )
  )
}

function isAlreadyKnownError(error) {
  return /already known|known transaction|transaction already imported|nonce too low|nonce has already been used/i.test(
    getErrorMessage(error),
  )
}

function reorderProviderContexts(providerContexts, preferredUrls = []) {
  const preferred = preferredUrls.filter(Boolean)
  if (preferred.length === 0) {
    return providerContexts
  }

  const used = new Set()
  const ordered = []

  for (const preferredUrl of preferred) {
    const match = providerContexts.find(context => context.url === preferredUrl)
    if (match && !used.has(match.url)) {
      ordered.push(match)
      used.add(match.url)
    }
  }

  for (const context of providerContexts) {
    if (!used.has(context.url)) {
      ordered.push(context)
    }
  }

  return ordered
}

function findProviderContext(providerContexts, url) {
  if (!url) {
    return null
  }

  return providerContexts.find(context => context.url === url) ?? null
}

function normalizeProvidedProviderContexts(providerContexts, chainId) {
  return providerContexts.map((entry, index) => ({
    provider: entry?.provider ?? entry,
    url: entry?.url ?? `injected-rpc-${index + 1}`,
    chainId: toChainId(entry?.chainId, chainId),
  }))
}

async function createProviderContext(url, expectedChainId, logger = console) {
  const provider = new JsonRpcProvider(url)
  const network = await provider.getNetwork()
  writeLog(logger, 'log', 'NETWORK:', network)

  if (network.chainId !== BigInt(expectedChainId)) {
    throw new Error(
      `Unsupported network chainId: ${network.chainId} (expected ${expectedChainId})`,
    )
  }

  return {
    provider,
    url,
    network,
    chainId: expectedChainId,
  }
}

async function getWorkingProviders(chainId, logger = console) {
  const errors = []
  const rpcList = getRpcList(chainId)
  const contexts = []

  for (const url of rpcList) {
    try {
      contexts.push(await createProviderContext(url, chainId, logger))
    } catch (error) {
      errors.push(`${url}: ${getErrorMessage(error)}`)
    }
  }

  if (contexts.length > 0) {
    return contexts
  }

  throw new Error(
    `No working RPC found for chain ${chainId}. Attempts: ${errors.join(' | ') || 'none'}`,
  )
}

async function getProviderContexts(chainId = DEFAULT_CHAIN_ID, options = {}) {
  const normalizedChainId = toChainId(chainId, DEFAULT_CHAIN_ID)
  if (
    Array.isArray(options.providerContexts) &&
    options.providerContexts.length > 0
  ) {
    return normalizeProvidedProviderContexts(
      options.providerContexts,
      normalizedChainId,
    )
  }

  if (!providerContextsPromises.has(normalizedChainId)) {
    providerContextsPromises.set(
      normalizedChainId,
      getWorkingProviders(normalizedChainId, options.logger ?? console),
    )
  }

  return providerContextsPromises.get(normalizedChainId)
}

async function getProviderContext(chainId = DEFAULT_CHAIN_ID, options = {}) {
  const contexts = await getProviderContexts(chainId, options)
  return contexts[0]
}

export async function readWithFallback(reader, options = {}) {
  if (typeof reader !== 'function') {
    throw new Error('reader must be a function')
  }

  const logger = options.logger ?? console
  const sleep = options.sleep ?? delay
  const chainId = toChainId(options.chainId, DEFAULT_CHAIN_ID)
  const providerContexts = await getProviderContexts(chainId, {
    providerContexts: options.providerContexts,
    logger,
  })
  let lastError = null

  for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt += 1) {
    for (const providerContext of providerContexts) {
      try {
        const value = await reader(providerContext.provider, providerContext)
        return {
          value,
          provider: providerContext.provider,
          url: providerContext.url,
          chainId,
        }
      } catch (error) {
        lastError = error
        if (isRetriableRpcError(error)) {
          writeLog(
            logger,
            'log',
            `⏳ Read retry via ${providerContext.url}: ${getErrorMessage(error)}`,
          )
          continue
        }

        throw error
      }
    }

    if (attempt < READ_RETRY_ATTEMPTS) {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS)
    }
  }

  throw new Error(
    `❌ Failed to read from available RPCs on chain ${chainId}: ${getErrorMessage(lastError)}`,
  )
}

function sanitizeTxRequest(txRequest, signerAddress) {
  const sanitizedTxRequest = { ...txRequest }
  const normalizedSignerAddress = String(signerAddress).toLowerCase()

  if (
    sanitizedTxRequest.from &&
    String(sanitizedTxRequest.from).toLowerCase() !== normalizedSignerAddress
  ) {
    console.warn('⚠️ Removing mismatched from field')
    delete sanitizedTxRequest.from
  }

  delete sanitizedTxRequest.from
  return sanitizedTxRequest
}

function hasFeeFields(txRequest) {
  return (
    txRequest.gasPrice !== undefined ||
    (txRequest.maxFeePerGas !== undefined &&
      txRequest.maxPriorityFeePerGas !== undefined)
  )
}

function isReadyToSign(txRequest) {
  return (
    txRequest.chainId !== undefined &&
    txRequest.nonce !== undefined &&
    txRequest.gasLimit !== undefined &&
    hasFeeFields(txRequest)
  )
}

function buildTxHandle(provider, txHash) {
  return {
    hash: txHash,
    wait: (confirms = 1, timeout = RECEIPT_WAIT_TIMEOUT_MS) =>
      provider.waitForTransaction(txHash, confirms, timeout),
  }
}

async function getNonceFromProviders(
  providerContexts,
  address,
  chainId,
  options = {},
) {
  const logger = options.logger ?? console
  const sleep = options.sleep ?? delay
  let lastError = null

  for (let attempt = 1; attempt <= NONCE_RETRY_ATTEMPTS; attempt += 1) {
    for (const { provider, url } of providerContexts) {
      try {
        writeLog(
          logger,
          'log',
          `🔍 Fetching nonce via ${url} (${attempt}/${NONCE_RETRY_ATTEMPTS})...`,
        )
        const nonce = await provider.getTransactionCount(address, 'pending')
        writeLog(logger, 'log', `✅ Nonce: ${nonce} via ${url}`)
        return {
          nonce,
          url,
          provider,
        }
      } catch (error) {
        lastError = error
        if (isRetriableRpcError(error)) {
          writeLog(
            logger,
            'log',
            `⏳ Nonce fetch retry via ${url}: ${getErrorMessage(error)}`,
          )
          continue
        }

        throw error
      }
    }

    if (attempt < NONCE_RETRY_ATTEMPTS) {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS)
    }
  }

  throw new Error(
    `❌ Failed to fetch pending nonce for chain ${chainId}: ${getErrorMessage(lastError)}`,
  )
}

async function populateTransactionWithRetry(
  providerContexts,
  privateKey,
  txRequest,
  chainId,
  options = {},
) {
  const logger = options.logger ?? console
  const sleep = options.sleep ?? delay
  let lastError = null

  for (let attempt = 1; attempt <= POPULATE_RETRY_ATTEMPTS; attempt += 1) {
    for (const { provider, url } of providerContexts) {
      try {
        const wallet = new Wallet(privateKey, provider)
        writeLog(
          logger,
          'log',
          `🧾 Populating transaction via ${url} (${attempt}/${POPULATE_RETRY_ATTEMPTS})...`,
        )
        const populatedTx = await wallet.populateTransaction({
          ...txRequest,
          chainId,
        })
        return {
          populatedTx,
          url,
          provider,
        }
      } catch (error) {
        lastError = error
        if (isRetriableRpcError(error)) {
          writeLog(
            logger,
            'log',
            `⏳ Populate retry via ${url}: ${getErrorMessage(error)}`,
          )
          continue
        }

        throw error
      }
    }

    if (attempt < POPULATE_RETRY_ATTEMPTS) {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS)
    }
  }

  throw new Error(
    `❌ Failed to populate transaction for chain ${chainId}: ${getErrorMessage(lastError)}`,
  )
}

async function sendSignedTxWithRetry(
  providerContext,
  signedTx,
  txHash,
  options = {},
) {
  const logger = options.logger ?? console
  const sleep = options.sleep ?? delay
  const { provider, url } = providerContext
  let lastError = null

  for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt += 1) {
    try {
      writeLog(
        logger,
        'log',
        `🚀 Broadcasting via ${url} (${attempt}/${SEND_RETRY_ATTEMPTS})...`,
      )
      const tx = await provider.broadcastTransaction(signedTx)
      writeLog(logger, 'log', '📤 TX SENT:', tx.hash)
      return {
        accepted: true,
        tx,
        url,
      }
    } catch (error) {
      lastError = error

      if (isAlreadyKnownError(error)) {
        writeLog(logger, 'log', `ℹ️ RPC already knows tx: ${url}`)
        return {
          accepted: true,
          tx: buildTxHandle(provider, txHash),
          url,
          alreadyKnown: true,
        }
      }

      if (isRetriableRpcError(error)) {
        writeLog(
          logger,
          'log',
          `⏳ Broadcast retry via ${url}: ${getErrorMessage(error)}`,
        )
        if (attempt < SEND_RETRY_ATTEMPTS) {
          await sleep(RATE_LIMIT_RETRY_DELAY_MS)
          continue
        }
      }

      throw error
    }
  }

  throw lastError ?? new Error(`Broadcast failed via ${url}`)
}

async function confirmVisibility(providerContext, txHash, options = {}) {
  const logger = options.logger ?? console
  const sleep = options.sleep ?? delay
  const { provider, url } = providerContext

  await sleep(BROADCAST_VISIBILITY_DELAY_MS)

  try {
    const tx = await provider.getTransaction(txHash)
    if (tx) {
      writeLog(logger, 'log', `✅ TX visible via ${url}`)
      return true
    }

    writeLog(logger, 'log', `⚠️ TX not yet visible via ${url}`)
    return false
  } catch (error) {
    writeLog(
      logger,
      'log',
      `⚠️ Visibility check failed via ${url}: ${getErrorMessage(error)}`,
    )
    return false
  }
}

async function findVisibleTransaction(providerContexts, txHash, options = {}) {
  const logger = options.logger ?? console

  for (const { provider, url } of providerContexts) {
    try {
      const tx = await provider.getTransaction(txHash)
      if (tx) {
        writeLog(logger, 'log', `✅ TX visible via ${url}`)
        return {
          tx,
          url,
          provider,
        }
      }
    } catch (error) {
      if (isRetriableRpcError(error)) {
        writeLog(
          logger,
          'log',
          `⏳ Visibility retry via ${url}: ${getErrorMessage(error)}`,
        )
        continue
      }
    }
  }

  return null
}

async function findReceiptOnProviders(providerContexts, txHash, options = {}) {
  const logger = options.logger ?? console

  for (const { provider, url } of providerContexts) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash)
      if (receipt) {
        writeLog(logger, 'log', `✅ Receipt confirmed via: ${url}`)
        return {
          receipt,
          provider,
          url,
        }
      }
    } catch (error) {
      if (isRetriableRpcError(error)) {
        writeLog(
          logger,
          'log',
          `⏳ Receipt retry via ${url}: ${getErrorMessage(error)}`,
        )
        continue
      }
    }
  }

  return null
}

async function waitForReceiptOnProvider(providerContext, txHash, options = {}) {
  const logger = options.logger ?? console
  const sleep = options.sleep ?? delay
  let lastError = null

  for (let attempt = 1; attempt <= RECEIPT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const receipt = await providerContext.provider.waitForTransaction(
        txHash,
        1,
        RECEIPT_WAIT_TIMEOUT_MS,
      )
      if (receipt) {
        writeLog(logger, 'log', `✅ Receipt confirmed via: ${providerContext.url}`)
        return {
          receipt,
          provider: providerContext.provider,
          url: providerContext.url,
        }
      }

      lastError = new Error(
        `Transaction ${txHash} was not mined via ${providerContext.url}`,
      )
    } catch (error) {
      lastError = error
      if (isRetriableRpcError(error)) {
        writeLog(
          logger,
          'log',
          `⏳ Receipt retry via ${providerContext.url}: ${getErrorMessage(error)}`,
        )
        if (attempt < RECEIPT_RETRY_ATTEMPTS) {
          await sleep(RATE_LIMIT_RETRY_DELAY_MS)
          continue
        }
      } else {
        throw error
      }
    }
  }

  throw new Error(
    `Transaction ${txHash} was not mined via ${providerContext.url} within ${RECEIPT_WAIT_TIMEOUT_MS}ms${lastError ? `: ${getErrorMessage(lastError)}` : ''}`,
  )
}

async function waitForReceipt(primaryProviderContext, fallbackProviderContexts, txHash, options = {}) {
  const logger = options.logger ?? console
  let lastError = null

  if (primaryProviderContext) {
    writeLog(
      logger,
      'log',
      '📡 Using broadcast RPC for receipt:',
      primaryProviderContext.url,
    )
    try {
      return await waitForReceiptOnProvider(primaryProviderContext, txHash, options)
    } catch (error) {
      lastError = error
      writeLog(
        logger,
        'log',
        `⚠️ Broadcast RPC receipt wait failed via ${primaryProviderContext.url}: ${getErrorMessage(error)}`,
      )
    }
  }

  for (const providerContext of fallbackProviderContexts) {
    if (providerContext.url === primaryProviderContext?.url) {
      continue
    }

    writeLog(
      logger,
      'log',
      `⚠️ Falling back receipt RPC: ${providerContext.url}`,
    )
    try {
      return await waitForReceiptOnProvider(providerContext, txHash, options)
    } catch (error) {
      lastError = error
      writeLog(
        logger,
        'log',
        `❌ Receipt fallback failed via ${providerContext.url}: ${getErrorMessage(error)}`,
      )
    }
  }

  throw lastError ?? new Error(`Transaction ${txHash} receipt could not be confirmed`)
}

export async function getWallet(options = {}) {
  if (!process.env.PRIVATE_KEY) {
    throw new Error(
      'PRIVATE_KEY is required to send LI.FI workflow transactions.',
    )
  }

  const chainId = toChainId(options.chainId, DEFAULT_CHAIN_ID)
  const { provider } = await getProviderContext(chainId, options)
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider)
  writeLog(options.logger ?? console, 'log', 'SIGNER ADDRESS:', wallet.address)
  return wallet
}

export async function sendWithFallback(txRequest, privateKey, options = {}) {
  if (!txRequest || typeof txRequest !== 'object') {
    throw new Error('txRequest is required to send a transaction.')
  }

  const logger = options.logger ?? console
  const sleep = options.sleep ?? delay
  const chainId = toChainId(
    options.chainId ?? txRequest.chainId,
    DEFAULT_CHAIN_ID,
  )
  const providerContexts = await getProviderContexts(chainId, {
    providerContexts: options.providerContexts,
    logger,
  })

  if (!privateKey) {
    throw new Error(
      'PRIVATE_KEY is required to send LI.FI workflow transactions.',
    )
  }

  const signer = new Wallet(privateKey)
  const signerAddress = signer.address
  const sanitizedTxRequest = sanitizeTxRequest(txRequest, signerAddress)

  writeLog(logger, 'log', 'SIGNER ADDRESS:', signerAddress)
  writeLog(logger, 'log', 'SIGNER:', signerAddress)
  writeLog(logger, 'log', 'CHAIN:', chainId)
  writeLog(logger, 'log', 'TX REQUEST:', sanitizedTxRequest)

  const nonceResult =
    sanitizedTxRequest.nonce !== undefined
      ? {
          nonce: sanitizedTxRequest.nonce,
          url: 'provided',
          provider: null,
        }
      : await getNonceFromProviders(providerContexts, signerAddress, chainId, {
          logger,
          sleep,
        })

  const signableTxBase = {
    ...sanitizedTxRequest,
    chainId,
    nonce: nonceResult.nonce,
  }
  const noncePreferredProviderContexts = reorderProviderContexts(
    providerContexts,
    [nonceResult.url],
  )

  let signableTx = signableTxBase
  let populateRpcUrl = 'provided'

  if (!isReadyToSign(signableTxBase)) {
    const populated = await populateTransactionWithRetry(
      noncePreferredProviderContexts,
      privateKey,
      signableTxBase,
      chainId,
      {
        logger,
        sleep,
      },
    )
    signableTx = populated.populatedTx
    populateRpcUrl = populated.url
  } else {
    writeLog(logger, 'log', '🧾 Transaction already includes nonce and fee fields.')
  }

  const signedTx = await signer.signTransaction(signableTx)
  const txHash = Transaction.from(signedTx).hash
  const broadcastProviderContexts = reorderProviderContexts(
    noncePreferredProviderContexts,
    [populateRpcUrl, nonceResult.url],
  )
  const broadcastAttempts = []
  let lastError = null
  let broadcastRpcUrl = null
  let broadcastProviderContext = null
  let visibleRpcUrl = null
  let preconfirmedReceipt = null
  let preconfirmedReceiptRpcUrl = null

  for (const providerContext of broadcastProviderContexts) {
    try {
      const result = await sendSignedTxWithRetry(providerContext, signedTx, txHash, {
        logger,
        sleep,
      })
      broadcastAttempts.push({
        url: providerContext.url,
        status: result.alreadyKnown ? 'already_known' : 'accepted',
      })

      if (!broadcastRpcUrl) {
        broadcastRpcUrl = providerContext.url
        broadcastProviderContext = providerContext
      }

      const visible = await confirmVisibility(providerContext, txHash, {
        logger,
        sleep,
      })
      if (visible) {
        visibleRpcUrl = providerContext.url
        break
      }
    } catch (error) {
      lastError = error
      broadcastAttempts.push({
        url: providerContext.url,
        status: 'failed',
        error: getErrorMessage(error),
      })

      if (isAlreadyKnownError(error) || isRetriableRpcError(error)) {
        const visibleResult = await findVisibleTransaction(
          broadcastProviderContexts,
          txHash,
          { logger },
        )
        if (visibleResult) {
          broadcastRpcUrl ??= visibleResult.url
          broadcastProviderContext ??=
            findProviderContext(broadcastProviderContexts, visibleResult.url)
          visibleRpcUrl = visibleResult.url
          break
        }

        const receiptResult = await findReceiptOnProviders(
          broadcastProviderContexts,
          txHash,
          { logger },
        )
        if (receiptResult) {
          broadcastRpcUrl ??= receiptResult.url
          broadcastProviderContext ??=
            findProviderContext(broadcastProviderContexts, receiptResult.url)
          visibleRpcUrl = receiptResult.url
          preconfirmedReceipt = receiptResult.receipt
          preconfirmedReceiptRpcUrl = receiptResult.url
          break
        }
      }

      writeLog(
        logger,
        'log',
        `❌ RPC FAILED: ${providerContext.url} (${getErrorMessage(error)})`,
      )
    }
  }

  if (!broadcastRpcUrl && !visibleRpcUrl && !preconfirmedReceipt) {
    throw new Error(
      `❌ All RPC failed to broadcast transaction on chain ${chainId}: ${getErrorMessage(lastError)}`,
    )
  }

  if (!visibleRpcUrl && !preconfirmedReceipt) {
    writeLog(
      logger,
      'log',
      '⚠️ TX not immediately visible; waiting for mining confirmation...',
    )
  }

  let receipt = preconfirmedReceipt
  let receiptRpcUrl = preconfirmedReceiptRpcUrl

  if (!receipt) {
    ;({ receipt, url: receiptRpcUrl } = await waitForReceipt(
      broadcastProviderContext,
      broadcastProviderContexts,
      txHash,
      { logger, sleep },
    ))
  }

  if (!receipt || receipt.status !== 1) {
    throw new Error('❌ Transaction failed or not mined')
  }

  const resultMeta = {
    chainId,
    signerAddress,
    txHash,
    nonce: nonceResult.nonce,
    nonceRpcUrl: nonceResult.url,
    populateRpcUrl,
    broadcastRpcUrl: broadcastRpcUrl ?? visibleRpcUrl ?? receiptRpcUrl,
    visibleRpcUrl,
    receiptRpcUrl,
    broadcastAttempts,
  }

  options.onResult?.(resultMeta)

  const finalTxHash = receipt.transactionHash ?? receipt.hash ?? txHash
  writeLog(logger, 'log', '🔥 TX MINED:', finalTxHash)
  return finalTxHash
}

export async function sendTransaction(txRequest, options = {}) {
  return sendWithFallback(txRequest, process.env.PRIVATE_KEY, options)
}

export const __testables = {
  toChainId,
  getRpcList,
  sanitizeTxRequest,
  isRateLimitError,
  isRetriableRpcError,
  isAlreadyKnownError,
  readWithFallback,
  getNonceFromProviders,
  populateTransactionWithRetry,
  sendSignedTxWithRetry,
  confirmVisibility,
  findVisibleTransaction,
  findReceiptOnProviders,
  waitForReceipt,
  normalizeProvidedProviderContexts,
  reorderProviderContexts,
}
