import {
  LiFiExecuteTool,
  LiFiQuoteTool,
  LiFiStatusTool,
  createRuntimeServer,
  createWorkflowRuntime,
} from '../src/index.js'
import bridgeSkill from '../skills/bridge-assets.json' with { type: 'json' }
import swapBridgeSkill from '../skills/swap-then-bridge.json' with { type: 'json' }
import safeReviewSkill from '../skills/safe-large-transfer-review.json' with { type: 'json' }

const DEFAULTS = {
  host: process.env.LIFISKILL_RUNTIME_HOST ?? '127.0.0.1',
  port: Number(process.env.LIFISKILL_RUNTIME_PORT ?? 8787),
  token: process.env.LIFISKILL_RUNTIME_TOKEN ?? 'demo-token',
}

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

function prettyJson(value) {
  return JSON.stringify(value, null, 2)
}

async function postJson(url, { token, requestId, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-request-id': requestId,
    },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} for ${url}: ${json?.error?.code ?? 'UNKNOWN'} ${json?.error?.message ?? ''}`,
    )
  }
  return json
}

async function main() {
  const host = DEFAULTS.host
  const port = DEFAULTS.port
  const token = DEFAULTS.token
  const baseUrl = `http://${host}:${port}`
  const opId = `demo-op-confirm-${Date.now()}`
  const requestId = `demo-confirm-flow-${Date.now()}`

  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote(input) {
        return buildMockQuote(input)
      },
    },
  })
  const executeTool = new LiFiExecuteTool({
    client: {
      async execute() {
        return { txHash: '0xruntime_http_tx' }
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
    skills: [bridgeSkill, swapBridgeSkill, safeReviewSkill],
    quoteTool,
    executeTool,
    statusTool,
  })

  const server = createRuntimeServer({
    runtime,
    host,
    port,
    authToken: token,
    ipAllowlist: ['127.0.0.1/32'],
    trustedProxy: false,
    approvalProvider: {
      async getAllowance() {
        return '1000000'
      },
    },
  })

  console.log('Starting runtime server for confirm-flow demo...')
  const started = await server.start()
  console.log(`Runtime server started: ${started.url}`)

  try {
    const healthResp = await fetch(`${baseUrl}/healthz`)
    const health = await healthResp.json()
    console.log('Health check ok:')
    console.log(prettyJson(health))

    const sharedInput = {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      autoConfirm: false,
      operationId: opId,
    }

    const first = await postJson(`${baseUrl}/run-skill`, {
      token,
      requestId,
      body: {
        skillId: 'bridge-assets',
        actorId: sharedInput.fromAddress,
        quotePolicy: { maxRequoteCount: 0 },
        input: {
          ...sharedInput,
          confirmed: false,
        },
      },
    })

    const second = await postJson(`${baseUrl}/run-skill`, {
      token,
      requestId,
      body: {
        skillId: 'bridge-assets',
        actorId: sharedInput.fromAddress,
        quotePolicy: { maxRequoteCount: 0 },
        input: {
          ...sharedInput,
          confirmed: true,
        },
      },
    })

    const summary = {
      operationId: opId,
      requestId,
      first: {
        state: first?.result?.state ?? null,
        requiresConfirmation: first?.result?.requiresConfirmation ?? null,
        errorCode: first?.result?.error?.code ?? null,
        errorMessage: first?.result?.error?.message ?? null,
      },
      second: {
        state: second?.result?.state ?? null,
        txHash: second?.result?.execution?.txHash ?? null,
        replayed: second?.result?.replayed ?? null,
        errorCode: second?.result?.error?.code ?? null,
        errorMessage: second?.result?.error?.message ?? null,
      },
    }

    console.log('\nConfirm-flow demo summary:')
    console.log(prettyJson(summary))
  } finally {
    await server.stop()
  }
}

main().catch(error => {
  console.error('Confirm-flow demo failed.')
  console.error(error)
  process.exitCode = 1
})
