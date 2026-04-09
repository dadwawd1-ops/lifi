import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  LiFiClient,
  summarizeStatus,
  formatStatusPreview,
} from '../src/index.js'

function nowIso() {
  return new Date().toISOString()
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized)
}

function writeJson(filePath, payload) {
  const abs = resolve(filePath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function validateRequiredEnv() {
  const txHash = process.env.LI_FI_TX_HASH
  if (!txHash) {
    throw new Error('Missing LI_FI_TX_HASH. Provide a real executed tx hash.')
  }
  return txHash
}

function buildStatusQuery(txHash) {
  return {
    txHash,
    fromChain: process.env.LI_FI_FROM_CHAIN,
    toChain: process.env.LI_FI_TO_CHAIN,
    bridge: process.env.LI_FI_BRIDGE,
  }
}

async function main() {
  const txHash = validateRequiredEnv()
  const requireTerminal = toBoolean(process.env.LI_FI_REQUIRE_TERMINAL_STATUS)
  const outputPath =
    process.env.LI_FI_EVIDENCE_OUTPUT
    ?? 'submission/real-execution-verification.json'

  const client = new LiFiClient({
    baseUrl: process.env.LI_FI_BASE_URL ?? 'https://li.quest/v1',
    apiKey: process.env.LI_FI_API_KEY,
    integrator: process.env.LI_FI_INTEGRATOR ?? 'lifi-feature-demo',
  })

  const query = buildStatusQuery(txHash)
  const checkedAt = nowIso()

  try {
    const statusPayload = await client.getStatus(query)
    const summary = summarizeStatus(statusPayload)
    const terminalStatuses = new Set(['DONE', 'FAILED'])
    const isTerminal = terminalStatuses.has(String(summary.status).toUpperCase())

    const verification = {
      ok: requireTerminal ? isTerminal : true,
      checkedAt,
      requireTerminalStatus: requireTerminal,
      request: query,
      status: {
        topLevel: summary.status,
        substatus: summary.substatus,
        transactionId: summary.transactionId,
        explorerLink: summary.explorerLink,
        narrative: summary.narrative,
      },
      note: requireTerminal && !isTerminal
        ? 'Status is not terminal yet. Re-run later for final proof.'
        : 'Status fetched successfully.',
    }

    writeJson(outputPath, verification)

    console.log('=== Real Execution Verification ===')
    console.log(`Output: ${outputPath}`)
    console.log(`Checked At: ${checkedAt}`)
    console.log(`Verified: ${verification.ok}`)
    console.log('')
    console.log(formatStatusPreview(summary))

    if (!verification.ok) {
      process.exitCode = 2
    }
  } catch (error) {
    const failure = {
      ok: false,
      checkedAt,
      request: query,
      error: {
        name: error?.name ?? 'Error',
        message: error?.message ?? String(error),
      },
      note: 'Verification request failed.',
    }
    writeJson(outputPath, failure)

    console.error('Real execution verification failed.')
    console.error(error)
    console.error(`Wrote failure evidence to: ${outputPath}`)
    process.exitCode = 1
  }
}

main()
