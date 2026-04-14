import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import 'dotenv/config'
import {
  LiFiExecuteTool,
  LiFiQuoteTool,
  LiFiStatusTool,
  createWorkflowRuntime,
  runBatch,
} from './lifiskill/src/index.js'
import { LiFiClient } from './lifi-feature/src/lifi-client.js'
import {
  prepareYieldWorkflowTask,
  resolveDefaultWalletAddress,
} from './lifi-feature/src/yield-execution-plan.js'
import {
  formatQuotePreview,
  summarizeQuote,
} from './lifi-feature/src/route-preview.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SUPPORTED_SKILLS = new Set(['bridge-assets', 'swap-then-bridge'])
const SUPPORTED_COMMANDS = new Set(['batch-run', ...SUPPORTED_SKILLS])

function formatUsdMaybe(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return 'n/a'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n >= 100 ? 2 : 4,
  }).format(n)
}

function formatPercentMaybeFraction(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return 'n/a'
  }

  const normalized = n <= 1 ? n * 100 : n
  return `${normalized.toFixed(2)}%`
}

function describeVaultAsset(vault) {
  return (
    vault?.depositToken?.symbol ??
    vault?.depositToken?.address ??
    vault?.asset?.symbol ??
    vault?.asset?.address ??
    'unknown'
  )
}

function printHelp() {
  console.log(`Usage:
  node run-skill.mjs <skill> [options]
  node run-skill.mjs batch-run <config.json> [options]

Skills:
  bridge-assets
  swap-then-bridge

Commands:
  batch-run            Run a JSON array of workflow tasks

Required options for single-task mode:
  --fromChain <id>       Source chain id
  --toChain <id>         Destination chain id
  --amount <raw>         Raw token amount

Token options:
  --token <symbol|addr>      Token for bridge-assets (default: USDC)
  --fromToken <symbol|addr>  Source token for swap-then-bridge
  --toToken <symbol|addr>    Destination token hint for swap-then-bridge

Mode options:
  --plan-only            Quote and preview only; do not execute
  --execute              Execute workflow and enable vault deposit

Optional:
  --fromAddress <addr>   Sender wallet (default: signer wallet from PRIVATE_KEY)
  --receiver <addr>      Optional receiver hint; active workflows send to the signer wallet
  --slippage <num>       Slippage, for example 0.003
  --apiKey <key>         LI.FI API key (or env LI_FI_API_KEY)
  --earnBaseUrl <url>    LI.FI Earn base URL (default: https://earn.li.fi)
  --integrator <name>    LI.FI integrator (or env LI_FI_INTEGRATOR)
  --baseUrl <url>        LI.FI Composer base URL (default: https://li.quest/v1)
  --txHash <hash>        Optional real tx hash for status polling in execute mode
  --routeOut <path>      Save raw LI.FI route/quote response JSON
  --statusOut <path>     Save LI.FI status response JSON when available
  --json                 Print final result JSON after logs
  --help                 Show this help

Examples:
  node run-skill.mjs bridge-assets --fromChain 1 --toChain 137 --amount 10000000000000000 --plan-only
  node run-skill.mjs swap-then-bridge --fromChain 1 --toChain 137 --fromToken ETH --amount 10000000000000000 --execute
  node run-skill.mjs batch-run .\\config.json --execute`)
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

function firstValue(values, ...names) {
  for (const name of names) {
    const value = values[name]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return null
}

async function writeJson(filePath, payload) {
  if (!filePath) {
    return
  }
  const abs = resolve(filePath)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function toPositiveInt(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined
  }
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return n
}

function resolveMode(parsed) {
  const planOnly = parsed.flags.has('plan-only') || parsed.flags.has('planOnly')
  const execute = parsed.flags.has('execute')
  if (planOnly && execute) {
    throw new Error('Choose only one mode: --plan-only or --execute')
  }
  return execute ? 'execute' : 'plan-only'
}

function resolveEarnOptions(parsed) {
  return {
    earnBaseUrl:
      firstValue(parsed.values, 'earnBaseUrl', 'earn-base-url') ??
      process.env.LI_FI_EARN_BASE_URL ??
      'https://earn.li.fi',
    apiKey:
      firstValue(parsed.values, 'apiKey', 'api-key') ?? process.env.LI_FI_API_KEY,
    sortBy:
      firstValue(parsed.values, 'vaultSortBy', 'vault-sort-by', 'sortBy', 'sort-by') ??
      process.env.LI_FI_EARN_SORT_BY ??
      'apy',
    maxPages:
      toPositiveInt(
        firstValue(parsed.values, 'vaultMaxPages', 'vault-max-pages'),
        '--vaultMaxPages',
      ) ?? 3,
    limit:
      toPositiveInt(
        firstValue(parsed.values, 'vaultLimit', 'vault-limit'),
        '--vaultLimit',
      ) ?? 100,
    defaultAddress: resolveDefaultWalletAddress(),
  }
}

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8')
  return JSON.parse(text)
}

async function loadSkills() {
  const skillsDir = join(__dirname, 'lifiskill', 'skills')
  const [bridgeSkill, swapBridgeSkill] = await Promise.all([
    readJson(join(skillsDir, 'bridge-assets.json')),
    readJson(join(skillsDir, 'swap-then-bridge.json')),
  ])
  return [bridgeSkill, swapBridgeSkill]
}

function createStatusTool(client, fallbackTxHash) {
  return new LiFiStatusTool({
    client: {
      async getStatus(input) {
        const txHash = input?.txHash ?? fallbackTxHash
        if (txHash && !String(txHash).startsWith('0xrun_skill_local_')) {
          return client.getStatus({
            ...input,
            txHash,
          })
        }

        return {
          status: 'DONE',
          substatus: 'LOCAL_EXECUTOR_ADAPTER',
          substatusMessage:
            'Local executor adapter completed without broadcasting a transaction.',
        }
      },
    },
  })
}

function createExecuteTool({ mode, txHash, client }) {
  if (mode === 'execute' && !txHash) {
    return new LiFiExecuteTool({ client })
  }

  return new LiFiExecuteTool({
    client: {
      async execute(input) {
        if (mode !== 'execute') {
          throw new Error('Execution attempted while CLI is in plan-only mode')
        }

        const quote = input?.quote ?? {}
        const request = quote.transactionRequest ?? null
        return {
          ok: true,
          mode: 'provided-transaction-hash',
          txHash,
          routeId: quote.id ?? null,
          operationId: input?.operationId ?? null,
          broadcasted: true,
          transactionRequest: request,
          note: 'Using user-provided transaction hash for status polling.',
        }
      },
    },
  })
}

function createApprovalProvider() {
  return {
    async getAllowance() {
      return '999999999999999999999999999999'
    },
  }
}

function printAuditLog(result) {
  const events = result?.audit?.events ?? []
  if (events.length === 0) {
    console.log('No audit events emitted.')
    return
  }

  for (const event of events) {
    console.log(`- ${event.state}: ${event.detail}`)
  }
}

function printExecutionResult(result) {
  const execution = result.execution ?? null
  const executionTxHash =
    result.swapTxHash ??
    result.audit?.txHash ??
    execution?.txHash ??
    execution?.transactionHash ??
    null
  const depositTxHash =
    result.depositTxHash ?? result.deposit?.txHash ?? result.audit?.depositTxHash ?? null
  console.log(`State: ${result.state}`)
  console.log(`Transaction hash: ${executionTxHash ?? 'N/A'}`)
  console.log(
    `Execution mode: ${execution?.mode ?? (execution?.requiresSigner ? 'signer-required' : 'N/A')}`,
  )
  console.log(`Broadcasted: ${execution?.broadcasted === true ? 'yes' : 'no'}`)
  console.log(
    `Requires signer: ${execution?.requiresSigner === true ? 'yes' : 'no'}`,
  )
  if (depositTxHash) {
    console.log(`Vault deposit tx: ${depositTxHash}`)
  }
  if (execution?.note) {
    console.log(`Note: ${execution.note}`)
  }
  if (result.status) {
    console.log(`Status: ${result.status.status ?? 'N/A'}`)
  }
}

function buildCliTask(parsed, requestedSkillId, mode) {
  return {
    skillId: requestedSkillId,
    fromChain: firstValue(parsed.values, 'fromChain', 'from-chain'),
    toChain: firstValue(parsed.values, 'toChain', 'to-chain'),
    amount: firstValue(parsed.values, 'amount'),
    fromAddress: firstValue(parsed.values, 'fromAddress', 'from-address'),
    receiver: firstValue(parsed.values, 'receiver', 'toAddress', 'to-address'),
    slippage: firstValue(parsed.values, 'slippage'),
    token: firstValue(parsed.values, 'token'),
    fromToken:
      firstValue(parsed.values, 'fromToken', 'from-token') ??
      firstValue(parsed.values, 'token'),
    toToken: firstValue(parsed.values, 'toToken', 'to-token'),
    operationId: firstValue(parsed.values, 'operationId', 'operation-id'),
    traceId: firstValue(parsed.values, 'traceId', 'trace-id'),
    enableDeposit: mode === 'execute',
  }
}

async function createRuntimeBundle(parsed, mode) {
  const txHash = firstValue(parsed.values, 'txHash', 'tx-hash')
  const client = new LiFiClient({
    baseUrl:
      firstValue(parsed.values, 'baseUrl', 'base-url') ??
      process.env.LI_FI_BASE_URL ??
      'https://li.quest/v1',
    apiKey:
      firstValue(parsed.values, 'apiKey', 'api-key') ?? process.env.LI_FI_API_KEY,
    integrator:
      firstValue(parsed.values, 'integrator') ??
      process.env.LI_FI_INTEGRATOR ??
      'run-skill-cli',
  })

  const [bridgeSkill, swapBridgeSkill] = await loadSkills()
  const quoteTool = new LiFiQuoteTool({ client })
  const executeTool = createExecuteTool({ mode, txHash, client })
  const statusTool = createStatusTool(client, txHash)
  const runtime = createWorkflowRuntime({
    skills: [bridgeSkill, swapBridgeSkill],
    quoteTool,
    executeTool,
    statusTool,
    quotePolicy: {
      maxRequoteCount: 0,
    },
  })

  return {
    client,
    runtime,
  }
}

async function executePreparedTask(preparedTask, runtime, mode) {
  return runtime.runSkill({
    skillId: preparedTask.skillId,
    input: {
      ...preparedTask.input,
      autoConfirm: true,
      confirmed: true,
    },
    actorId: preparedTask.input.fromAddress,
    featureFlags: {
      quoteOnly: mode === 'plan-only',
    },
    approvalProvider: createApprovalProvider(),
  })
}

function printPreparedTaskHeader(preparedTask, mode) {
  console.log('=== run-skill ===')
  console.log(`Requested skill: ${preparedTask.requestedSkillId}`)
  console.log(`Resolved skill: ${preparedTask.skillId}`)
  console.log(`Mode: ${mode}`)
  console.log(
    `Route: chain ${preparedTask.input.fromChain} -> chain ${preparedTask.input.toChain}`,
  )
  console.log(`Source token: ${preparedTask.sourceToken}`)
  console.log(`Destination deposit token: ${preparedTask.depositToken.address}`)
  console.log(`Destination wallet: ${preparedTask.input.receiver}`)
  console.log(`Amount: ${preparedTask.input.amount}`)
  console.log('')

  console.log('Step 1/5: Selecting target vault from LI.FI Earn API...')
  console.log(
    `Selected Vault: ${preparedTask.selectedVault.name} (${preparedTask.selectedVault.protocol})`,
  )
  console.log(`Vault: ${preparedTask.selectedVault.name}`)
  console.log(`APY: ${formatPercentMaybeFraction(preparedTask.selectedVault.apy)}`)
  console.log(`TVL: ${formatUsdMaybe(preparedTask.selectedVault.tvl)}`)
  console.log(`Vault Deposit Asset: ${describeVaultAsset(preparedTask.selectedVault)}`)
  if (preparedTask.skillId === 'swap-then-bridge') {
    console.log(
      `Routing mode switched to swap-then-bridge because ${preparedTask.sourceToken} does not match ${preparedTask.depositToken.address}.`,
    )
  } else {
    console.log(
      `Routing mode uses bridge-assets because ${preparedTask.sourceToken} matches ${preparedTask.depositToken.address}.`,
    )
  }
  console.log('')
}

async function runSingleCommand(parsed, command) {
  const mode = resolveMode(parsed)
  const task = buildCliTask(parsed, command, mode)
  const earnOptions = resolveEarnOptions(parsed)
  const preparedTask = await prepareYieldWorkflowTask(task, earnOptions)
  console.log('VAULT:', preparedTask.selectedVault.name)
  console.log('DEPOSIT TOKEN:', preparedTask.depositToken)
  console.log('TO ADDRESS:', preparedTask.input.receiver)

  const { runtime } = await createRuntimeBundle(parsed, mode)
  printPreparedTaskHeader(preparedTask, mode)

  console.log('Step 2/5: Creating lifiskill runtime...')
  console.log(`Available skills: ${runtime.listSkills().join(', ')}`)

  console.log('Step 3/5: Requesting LI.FI quote through lifi-feature LiFiClient...')
  const result = await executePreparedTask(preparedTask, runtime, mode)

  console.log('Step 4/5: Runtime audit log')
  printAuditLog(result)

  console.log('\nStep 5/5: Route preview')
  if (result.quote) {
    const quoteSummary = result.quoteSummary ?? summarizeQuote(result.quote)
    console.log(formatQuotePreview(quoteSummary))
    console.log('')
    console.log('Estimated deposit:')
    console.log(`${quoteSummary.from.amount} -> ${quoteSummary.to.estimated}`)
  } else {
    console.log('No quote returned.')
  }

  console.log('\n=== Execution Result ===')
  printExecutionResult(result)

  if (parsed.flags.has('json')) {
    console.log('\n=== JSON ===')
    console.log(JSON.stringify(result, null, 2))
  }

  const routeOut = firstValue(parsed.values, 'routeOut', 'route-out')
  const statusOut = firstValue(parsed.values, 'statusOut', 'status-out')
  if (routeOut && result.quote) {
    await writeJson(routeOut, result.quote)
    console.log(`\nSaved route response JSON: ${routeOut}`)
  }
  if (statusOut && result.status) {
    await writeJson(statusOut, result.status)
    console.log(`Saved status response JSON: ${statusOut}`)
  } else if (statusOut) {
    await writeJson(statusOut, {
      ok: false,
      reason: 'No status response was returned by the workflow.',
      state: result.state,
      txHash: result.audit?.txHash ?? null,
    })
    console.log(`Saved status placeholder JSON: ${statusOut}`)
  }

  if (result.state === 'failed') {
    process.exitCode = 1
  }
}

async function runBatchCommand(parsed) {
  const configPath = parsed.positionals[1]
  if (!configPath) {
    throw new Error('batch-run requires a path to a JSON config file')
  }

  const mode = resolveMode(parsed)
  const earnOptions = resolveEarnOptions(parsed)
  const tasks = await readJson(resolve(configPath))
  if (!Array.isArray(tasks)) {
    throw new Error('batch-run config must be a JSON array')
  }

  const { runtime } = await createRuntimeBundle(parsed, mode)
  const batchRuntime = {
    async run(task) {
      const preparedTask = await prepareYieldWorkflowTask(
        {
          ...task,
          skillId: task?.skillId ?? task?.type ?? 'bridge-assets',
          enableDeposit: task?.enableDeposit ?? mode === 'execute',
        },
        earnOptions,
      )
      const result = await executePreparedTask(preparedTask, runtime, mode)
      return {
        task: preparedTask,
        result,
        state: result.state,
        txHash:
          result.swapTxHash ??
          result.audit?.txHash ??
          result.execution?.txHash ??
          null,
        depositTxHash:
          result.depositTxHash ??
          result.deposit?.txHash ??
          result.audit?.depositTxHash ??
          null,
      }
    },
  }

  const results = await runBatch(tasks, batchRuntime)

  console.log('=== Batch Summary ===')
  results.forEach((entry, index) => {
    console.log(
      `${index + 1}. ${entry.task.skillId} | state=${entry.state} | tx=${entry.txHash ?? 'N/A'} | deposit=${entry.depositTxHash ?? 'N/A'}`,
    )
  })

  if (parsed.flags.has('json')) {
    console.log('\n=== JSON ===')
    console.log(JSON.stringify(results, null, 2))
  }
}

async function main() {
  const parsed = parseArgVector(process.argv.slice(2))
  const command = String(parsed.positionals[0] ?? '').trim().toLowerCase()

  if (parsed.flags.has('help') || !command) {
    printHelp()
    return
  }

  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error(
      `Unsupported command: ${command}. Use bridge-assets, swap-then-bridge, or batch-run.`,
    )
  }

  if (command === 'batch-run') {
    await runBatchCommand(parsed)
    return
  }

  await runSingleCommand(parsed, command)
}

main().catch(error => {
  console.error('run-skill failed.')
  console.error(error?.message ?? error)
  if (error?.payload) {
    console.error(JSON.stringify(error.payload, null, 2))
  }
  process.exitCode = 1
})
