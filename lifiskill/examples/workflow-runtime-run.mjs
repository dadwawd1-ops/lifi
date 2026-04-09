import {
  LiFiExecuteTool,
  LiFiQuoteTool,
  LiFiStatusTool,
  createJsonFileRolloutStateStore,
  createRolloutManager,
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

function mockMetricsProvider() {
  return {
    tests: { total: 37, failed: 0 },
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

function makeMockQuote(input) {
  return {
    id: `route_${String(input.fromChain)}_${String(input.toChain)}`,
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

async function main() {
  const stateStore = createJsonFileRolloutStateStore({
    filePath: statePath,
    initialConfig: {
      phases: [0, 5, 10, 25, 50, 100],
      salt: 'lifiskill-runtime',
      skills: {
        'bridge-assets': { phaseIndex: 2 },
        'swap-then-bridge': { phaseIndex: 1 },
        'safe-large-transfer-review': { phaseIndex: 2 },
      },
    },
  })

  const rolloutManager = createRolloutManager({
    stateStore,
    metricsProvider: async () => mockMetricsProvider(),
    autoPromote: true,
    strictGate: false,
  })

  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote(input) {
        return makeMockQuote(input)
      },
    },
  })
  const executeTool = new LiFiExecuteTool({
    client: {
      async execute() {
        return { txHash: '0xruntime_exec' }
      },
    },
  })
  const statusTool = new LiFiStatusTool({
    client: {
      async getStatus() {
        return { status: 'DONE' }
      },
    },
  })

  const runtime = createWorkflowRuntime({
    rolloutManager,
    skills: [bridgeSkill, swapBridgeSkill, safeReviewSkill],
    quoteTool,
    executeTool,
    statusTool,
  })

  const rollout = await runtime.evaluateRollout()
  console.log('Gate:', rollout.gate.summary)
  console.log('Traffic:', rollout.traffic)

  const result = await runtime.runSkill({
    skillId: 'bridge-assets',
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      autoConfirm: true,
      confirmed: true,
      operationId: 'runtime_demo_1',
    },
    approvalProvider: {
      async getAllowance() {
        return '1000000'
      },
    },
    quotePolicy: {
      maxRequoteCount: 0,
    },
  })

  console.log('\nWorkflow result')
  console.log('state:', result.state)
  console.log('disabledSkills:', result.runtime.featureFlags.disabledSkills.join(','))
  console.log('txHash:', result.audit.txHash)
}

main().catch(error => {
  console.error('Workflow runtime demo failed.')
  console.error(error)
  process.exitCode = 1
})
