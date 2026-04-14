import {
  LiFiClient,
  LiFiExecuteTool,
  LiFiQuoteTool,
  LiFiStatusTool,
  createJsonFileRolloutStateStore,
  createRolloutManager,
  createRuntimeServer,
  createWorkflowRuntime,
} from '../src/index.js'
import bridgeSkill from '../skills/bridge-assets.json' with { type: 'json' }
import swapBridgeSkill from '../skills/swap-then-bridge.json' with { type: 'json' }
import safeReviewSkill from '../skills/safe-large-transfer-review.json' with { type: 'json' }
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const statePath = join(__dirname, '..', '.runtime', 'rollout-state.json')

function buildMockQuote(input) {
  return {
    id: `route_${String(input.fromChain)}_${String(input.toChain)}_${Date.now()}`,
    tool: 'lifi',
    action: {
      fromChainId: input.fromChain,
      toChainId: input.toChain,
      fromAmount: input.fromAmount,
      fromToken: {
        symbol: input.fromToken,
        decimals: 6,
        address: '0xUSDC',
        priceUSD: '1',
      },
      toToken: {
        symbol: input.toToken,
        decimals: 6,
        priceUSD: '1',
      },
      slippage: input.slippage ?? 0.001,
    },
    estimate: {
      toAmount: input.fromAmount,
      toAmountMin: input.fromAmount,
      gasCosts: [{ amountUSD: '0.8' }],
      feeCosts: [{ amountUSD: '0.2' }],
      approvalAddress: '0xSpender',
    },
    includedSteps: [],
  }
}

function metricsProvider() {
  return {
    tests: { total: 38, failed: 0 },
    quality: {
      p0Count: 0,
      p1Count: 0,
      confirmationCoverage: 1,
      auditCoverage: 1,
      fallbackCoverage: 1,
    },
    skills: {
      bridgeAssetsE2E: true,
      swapThenBridgeE2E: true,
      safeLargeTransferReviewE2E: true,
    },
    slos: {
      successRate7d: 0.985,
      statusTimeoutRate7d: 0.004,
      p95CompletionMinutes7d: 6.2,
    },
  }
}

function parseBooleanEnv(value, fallback = false) {
  if (typeof value !== 'string') {
    return fallback
  }
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function parseCsvEnv(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return []
  }
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseLogFormatEnv(value) {
  if (typeof value !== 'string') {
    return 'json'
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'pretty') {
    return 'pretty'
  }
  return 'json'
}

function createLogWriter({ enabled, format }) {
  if (!enabled) {
    return () => {}
  }
  if (format === 'pretty') {
    return entry => {
      const summary =
        `[${entry.ts}] ${entry.method} ${entry.path} -> ${entry.statusCode} ` +
        `(${entry.durationMs}ms) rid=${entry.requestId} ip=${entry.ip || 'unknown'}`
      console.log(summary)
      if (entry.errorCode) {
        console.log(`  error=${entry.errorCode}`)
      }
      if (entry.skillId) {
        console.log(`  skill=${entry.skillId}`)
      }
    }
  }
  return entry => {
    console.log(JSON.stringify(entry))
  }
}

function createTools({
  useRealLiFiApi,
  useRealLiFiExecute,
  lifiClientOptions,
}) {
  if (!useRealLiFiApi) {
    return {
      mode: 'mock',
      quoteTool: new LiFiQuoteTool({
        client: {
          async getQuote(input) {
            return buildMockQuote(input)
          },
        },
      }),
      executeTool: new LiFiExecuteTool({
        client: {
          async execute() {
            return { txHash: '0xruntime_http_tx' }
          },
        },
      }),
      statusTool: new LiFiStatusTool({
        client: {
          async getStatus() {
            return { status: 'DONE' }
          },
        },
      }),
    }
  }

  const client = new LiFiClient(lifiClientOptions)
  const quoteTool = new LiFiQuoteTool({ client })

  if (useRealLiFiExecute) {
    return {
      mode: 'lifi_quote_status_execute',
      quoteTool,
      executeTool: new LiFiExecuteTool({ client }),
      statusTool: new LiFiStatusTool({ client }),
    }
  }

  // Safe default for initial integration:
  // quote from LI.FI API, but keep execution/status mocked for stable demos.
  return {
    mode: 'lifi_quote_only',
    quoteTool,
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return { txHash: '0xruntime_http_tx' }
        },
      },
    }),
    statusTool: new LiFiStatusTool({
      client: {
        async getStatus() {
          return { status: 'DONE' }
        },
      },
    }),
  }
}

async function main() {
  const stateStore = createJsonFileRolloutStateStore({
    filePath: statePath,
    initialConfig: {
      phases: [0, 5, 10, 25, 50, 100],
      salt: 'lifiskill-http',
      skills: {
        'bridge-assets': { phaseIndex: 2 },
        'swap-then-bridge': { phaseIndex: 1 },
        'safe-large-transfer-review': { phaseIndex: 2 },
      },
    },
  })

  const rolloutManager = createRolloutManager({
    stateStore,
    metricsProvider: async () => metricsProvider(),
    autoPromote: true,
    strictGate: false,
  })

  const useRealLiFiApi = parseBooleanEnv(
    process.env.LIFISKILL_USE_LIFI_API,
    false,
  )
  const useRealLiFiExecute = parseBooleanEnv(
    process.env.LIFISKILL_USE_LIFI_EXECUTE,
    false,
  )
  const toolConfig = createTools({
    useRealLiFiApi,
    useRealLiFiExecute,
    lifiClientOptions: {
      apiKey: process.env.LI_FI_API_KEY,
      integrator: process.env.LI_FI_INTEGRATOR ?? 'lifiskill-runtime',
      baseUrl: process.env.LI_FI_BASE_URL ?? 'https://li.quest/v1',
    },
  })

  const runtime = createWorkflowRuntime({
    rolloutManager,
    skills: [bridgeSkill, swapBridgeSkill, safeReviewSkill],
    ...toolConfig,
  })

  const authToken = process.env.LIFISKILL_RUNTIME_TOKEN ?? ''
  const host = process.env.LIFISKILL_RUNTIME_HOST ?? '127.0.0.1'
  const port = Number(process.env.LIFISKILL_RUNTIME_PORT ?? 8787)
  const ipAllowlist = parseCsvEnv(process.env.IP_ALLOWLIST ?? '')
  const trustedProxy = parseBooleanEnv(process.env.RUNTIME_TRUSTED_PROXY, false)
  const logEnabled = parseBooleanEnv(process.env.RUNTIME_LOG_ENABLED, true)
  const logFormat = parseLogFormatEnv(process.env.RUNTIME_LOG_FORMAT ?? 'json')
  const logWriter = createLogWriter({
    enabled: logEnabled,
    format: logFormat,
  })

  const server = createRuntimeServer({
    runtime,
    host,
    port,
    authToken: authToken.length > 0 ? authToken : null,
    ipAllowlist,
    trustedProxy,
    logWriter,
    approvalProvider: {
      async getAllowance() {
        return '1000000'
      },
      async approve({ requiredAmount }) {
        return {
          ok: true,
          txHash: '0xmock_approval_tx',
          allowanceAfter: requiredAmount ?? '0',
        }
      },
    },
  })

  const started = await server.start()
  console.log('Runtime server started:', started.url)
  console.log('Health endpoint: GET /healthz')
  console.log('Run skill endpoint: POST /run-skill')
  console.log('Rollout endpoint: POST /evaluate-rollout')
  console.log('IP allowlist:', ipAllowlist.length > 0 ? ipAllowlist.join(',') : '(disabled)')
  console.log('Trusted proxy:', trustedProxy ? 'enabled' : 'disabled')
  console.log('Access log:', logEnabled ? `enabled (${logFormat})` : 'disabled')
  if (toolConfig.mode !== 'mock') {
    console.log(
      'LI.FI mode:',
      toolConfig.mode === 'lifi_quote_status_execute'
        ? 'quote+status+execute'
        : 'quote only (execute mocked)',
    )
    console.log('LI.FI base URL:', process.env.LI_FI_BASE_URL ?? 'https://li.quest/v1')
    console.log('LI.FI integrator:', process.env.LI_FI_INTEGRATOR ?? 'lifiskill-runtime')
    if (!process.env.LI_FI_API_KEY) {
      console.log('LI.FI API key: (not set; public-rate limits may apply)')
    } else {
      console.log('LI.FI API key: configured')
    }
  } else {
    console.log('LI.FI mode: mock')
  }
  if (authToken.length > 0) {
    console.log('Auth enabled: use Authorization: Bearer <token>')
  } else {
    console.log('Auth disabled: set LIFISKILL_RUNTIME_TOKEN to enable')
  }
}

main().catch(error => {
  console.error('Failed to start runtime server.')
  console.error(error)
  process.exitCode = 1
})
