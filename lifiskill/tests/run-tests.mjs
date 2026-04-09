import assert from 'node:assert/strict'
import {
  validateSkillDefinition,
  summarizeQuote,
  formatQuoteSummary,
  LiFiQuoteTool,
  LiFiStatusTool,
  LiFiExecuteTool,
  evaluatePolicy,
  normalizePolicyConfig,
  ensureApproval,
  runBridgeAssetsWorkflow,
  runSwapThenBridgeWorkflow,
  runSafeLargeTransferReviewWorkflow,
  LifecycleState,
  Decision,
  classifyError,
  ErrorCode,
  resolveFeatureFlags,
  isSkillDisabled,
  pollUntilTerminal,
  mapExternalStatusToLifecycle,
  evaluateReleaseGate,
  assertReleaseGate,
  createOperationRegistry,
  deriveGrayReleaseFlags,
  createGrayReleaseConfig,
  isActorInGrayRelease,
  promoteGrayRelease,
  createRolloutManager,
  createInMemoryRolloutStateStore,
  createWorkflowRuntime,
  createRuntimeServer,
} from '../src/index.js'
import bridgeSkill from '../skills/bridge-assets.json' with { type: 'json' }
import swapBridgeSkill from '../skills/swap-then-bridge.json' with { type: 'json' }
import safeReviewSkill from '../skills/safe-large-transfer-review.json' with { type: 'json' }

const tests = []

function addTest(name, fn) {
  tests.push({ name, fn })
}

addTest('skill definition should be valid', () => {
  const result = validateSkillDefinition(bridgeSkill)
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
})

addTest('swap-then-bridge skill definition should be valid', () => {
  const result = validateSkillDefinition(swapBridgeSkill)
  assert.equal(result.ok, true)
})

addTest('safe-large-transfer-review skill definition should be valid', () => {
  const result = validateSkillDefinition(safeReviewSkill)
  assert.equal(result.ok, true)
})

addTest('skill definition validator should reject bad action', () => {
  const invalid = {
    ...bridgeSkill,
    allowed_actions: ['lifi.quote', 'unknown.action'],
  }
  const result = validateSkillDefinition(invalid)
  assert.equal(result.ok, false)
  assert.equal(
    result.errors.includes('`allowed_actions` contains unknown action'),
    true,
  )
})

addTest('quote summary should contain key fields', () => {
  const mockQuote = {
    id: 'route_123',
    tool: 'lifi',
    action: {
      fromChainId: 42161,
      toChainId: 8453,
      fromAmount: '1000000',
      fromToken: { symbol: 'USDC', decimals: 6 },
      toToken: { symbol: 'USDC', decimals: 6 },
    },
    estimate: {
      toAmount: '998000',
      toAmountMin: '995000',
      gasCosts: [{ amountUSD: '1.23' }],
      feeCosts: [{ amountUSD: '0.45' }],
    },
    includedSteps: [
      {
        type: 'cross',
        tool: 'bridge-x',
        action: { fromChainId: 42161, toChainId: 8453 },
      },
    ],
  }

  const summary = summarizeQuote(mockQuote)
  const text = formatQuoteSummary(summary)
  assert.equal(summary.routeId, 'route_123')
  assert.equal(summary.from.chainId, 42161)
  assert.equal(summary.to.chainId, 8453)
  assert.match(text, /LI\.FI Route Summary/)
  assert.match(text, /route_123/)
})

addTest('LiFiQuoteTool should call client and return summary text', async () => {
  const tool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'r1',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000000000000000',
            fromToken: { symbol: 'ETH', decimals: 18 },
            toToken: { symbol: 'ETH', decimals: 18 },
          },
          estimate: {
            toAmount: '990000000000000000',
            toAmountMin: '980000000000000000',
            gasCosts: [],
            feeCosts: [],
          },
          includedSteps: [],
        }
      },
    },
  })

  const result = await tool.run({
    fromChain: 1,
    toChain: 10,
    fromToken: 'ETH',
    toToken: 'ETH',
    fromAmount: '1000000000000000000',
    fromAddress: '0x1111111111111111111111111111111111111111',
  })
  assert.equal(result.summary.routeId, 'r1')
  assert.match(result.text, /Route: r1/)
})

addTest('LiFiStatusTool should proxy status call', async () => {
  const tool = new LiFiStatusTool({
    client: {
      async getStatus(input) {
        return { ok: true, input }
      },
    },
  })

  const result = await tool.run({ txHash: '0xabc' })
  assert.equal(result.ok, true)
  assert.equal(result.input.txHash, '0xabc')
})

addTest('LiFiExecuteTool should call execute capability', async () => {
  const tool = new LiFiExecuteTool({
    client: {
      async execute(input) {
        return { txHash: '0xexec', input }
      },
    },
  })

  const result = await tool.run({
    quote: { id: 'q1' },
  })
  assert.equal(result.txHash, '0xexec')
})

addTest('policy should deny when slippage exceeds threshold', () => {
  const decision = evaluatePolicy(
    {
      quoteSummary: {
        slippage: 0.02,
        from: { amountUsd: 100, chainId: 1, symbol: 'USDC' },
        to: { chainId: 10, symbol: 'USDC' },
        steps: [],
      },
      receiver: '0x1111111111111111111111111111111111111111',
    },
    {
      maxSlippage: 0.005,
    },
  )

  assert.equal(decision.decision, Decision.DENY)
})

addTest('policy config should accept snake_case constraints', () => {
  const normalized = normalizePolicyConfig({
    max_auto_usd: 1111,
    max_confirm_usd: 2222,
    max_slippage: 0.004,
  })
  assert.equal(normalized.maxAutoUsd, 1111)
  assert.equal(normalized.maxConfirmUsd, 2222)
  assert.equal(normalized.maxSlippage, 0.004)
})

addTest('policy should require confirmation when usd amount is unknown', () => {
  const decision = evaluatePolicy(
    {
      quoteSummary: {
        slippage: 0.001,
        from: {
          amountUsd: 0,
          amountUsdKnown: false,
          chainId: 1,
          symbol: 'USDC',
        },
        to: { chainId: 10, symbol: 'USDC' },
        steps: [],
      },
      receiver: '0x1111111111111111111111111111111111111111',
    },
    {},
  )
  assert.equal(decision.decision, Decision.REQUIRE_CONFIRM)
})

addTest('ensureApproval should use approve when permit is unavailable', async () => {
  const result = await ensureApproval({
    tokenAddress: '0xToken',
    ownerAddress: '0xOwner',
    spenderAddress: '0xSpender',
    requiredAmount: '1000',
    approvalProvider: {
      async getAllowance() {
        return '100'
      },
      async approve() {
        return { ok: true, txHash: '0xapprove' }
      },
    },
  })

  assert.equal(result.required, true)
  assert.equal(result.method, 'approve')
  assert.equal(result.txHash, '0xapprove')
})

addTest('bridge workflow should return awaiting_confirm when not confirmed', async () => {
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_confirm',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000',
            fromToken: { symbol: 'USDC', decimals: 6, address: '0xUSDC' },
            toToken: { symbol: 'USDC', decimals: 6 },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '999000',
            toAmountMin: '998000',
            gasCosts: [],
            feeCosts: [],
            approvalAddress: '0xSpender',
          },
          includedSteps: [
            {
              type: 'cross',
              tool: 'bridge-x',
              action: { fromChainId: 1, toChainId: 10 },
            },
          ],
        }
      },
    },
  })

  const result = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      autoConfirm: false,
      confirmed: false,
      operationId: 'op_1',
    },
    quoteTool,
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return { txHash: '0xnot_used' }
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
    policyConfig: {
      maxAutoUsd: 10,
      maxConfirmUsd: 100,
      maxSlippage: 0.005,
    },
  })

  assert.equal(result.state, LifecycleState.AWAITING_CONFIRM)
  assert.equal(result.requiresConfirmation, true)
})

addTest('bridge workflow should execute and complete when confirmed', async () => {
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_exec',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000',
            fromToken: {
              symbol: 'USDC',
              decimals: 6,
              address: '0xUSDC',
              priceUSD: '1',
            },
            toToken: {
              symbol: 'USDC',
              decimals: 6,
              priceUSD: '1',
            },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '999000',
            toAmountMin: '998000',
            gasCosts: [],
            feeCosts: [],
            approvalAddress: '0xSpender',
          },
          includedSteps: [],
        }
      },
    },
  })

  const executeTool = new LiFiExecuteTool({
    client: {
      async execute(input) {
        return { txHash: '0xexec_done', input }
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

  const result = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      autoConfirm: true,
      confirmed: true,
      operationId: 'op_2',
    },
    quoteTool,
    executeTool,
    statusTool,
    policyConfig: {
      maxAutoUsd: 3000,
      maxConfirmUsd: 10000,
      maxSlippage: 0.005,
    },
    approvalProvider: {
      async getAllowance() {
        return '0'
      },
      async approve() {
        return { ok: true, txHash: '0xapprove' }
      },
    },
  })

  assert.equal(result.state, LifecycleState.COMPLETED)
  assert.equal(result.audit.txHash, '0xexec_done')
  assert.equal(result.audit.approval.method, 'approve')
})

addTest('bridge workflow should degrade to plan-only when requote budget exhausted', async () => {
  let quoteCount = 0
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        quoteCount += 1
        const toAmountMin = quoteCount === 1 ? '1000000' : '800000'
        return {
          id: `route_plan_only_${quoteCount}`,
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000',
            fromToken: {
              symbol: 'USDC',
              decimals: 6,
              address: '0xUSDC',
              priceUSD: '1',
            },
            toToken: {
              symbol: 'USDC',
              decimals: 6,
              priceUSD: '1',
            },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '999000',
            toAmountMin,
            gasCosts: [],
            feeCosts: [],
          },
          includedSteps: [],
        }
      },
    },
  })

  const result = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      autoConfirm: true,
      confirmed: true,
      operationId: 'op_plan_only_1',
    },
    quoteTool,
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return { txHash: '0xshould_not_execute' }
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
    quotePolicy: {
      maxRequoteCount: 1,
      maxMinOutputDriftRate: 0.01,
      quoteTtlMs: 60000,
      maxGasUsdDriftRate: 1,
    },
  })

  assert.equal(result.planOnly, true)
  assert.equal(result.state, LifecycleState.AWAITING_CONFIRM)
  assert.equal(result.audit.errorCode, ErrorCode.QUOTE_DEGRADED_PLAN_ONLY)
})

addTest('bridge workflow should fail on invalid input', async () => {
  const result = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '0',
      fromAddress: 'invalid',
      receiver: 'invalid',
      operationId: 'op_invalid_1',
    },
    quoteTool: new LiFiQuoteTool({
      client: {
        async getQuote() {
          return {}
        },
      },
    }),
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return {}
        },
      },
    }),
    statusTool: new LiFiStatusTool({
      client: {
        async getStatus() {
          return {}
        },
      },
    }),
  })

  assert.equal(result.state, LifecycleState.FAILED)
  assert.equal(result.error.code, ErrorCode.INVALID_INPUT)
})

addTest('swap-then-bridge workflow should complete when confirmed', async () => {
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_swap_bridge',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 8453,
            fromAmount: '1000000',
            fromToken: {
              symbol: 'USDC',
              decimals: 6,
              address: '0xUSDC',
              priceUSD: '1',
            },
            toToken: {
              symbol: 'ETH',
              decimals: 18,
              priceUSD: '2000',
            },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '500000000000000',
            toAmountMin: '490000000000000',
            gasCosts: [],
            feeCosts: [],
            approvalAddress: '0xSpender',
          },
          includedSteps: [
            {
              type: 'swap',
              tool: 'dex-a',
              action: { fromChainId: 1, toChainId: 1 },
            },
            {
              type: 'cross',
              tool: 'bridge-a',
              action: { fromChainId: 1, toChainId: 8453 },
            },
          ],
        }
      },
    },
  })

  const executeTool = new LiFiExecuteTool({
    client: {
      async execute() {
        return { txHash: '0xswapbridge' }
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

  const result = await runSwapThenBridgeWorkflow({
    skill: swapBridgeSkill,
    input: {
      fromChain: 1,
      toChain: 8453,
      fromToken: 'USDC',
      toToken: 'ETH',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      autoConfirm: true,
      confirmed: true,
      operationId: 'op_swap_1',
    },
    quoteTool,
    executeTool,
    statusTool,
    policyConfig: {
      maxAutoUsd: 3000,
      maxConfirmUsd: 10000,
      maxSlippage: 0.005,
      maxComplexSteps: 3,
    },
    approvalProvider: {
      async getAllowance() {
        return '0'
      },
      async approve() {
        return { ok: true, txHash: '0xapprove_swap' }
      },
    },
  })

  assert.equal(result.state, LifecycleState.COMPLETED)
  assert.equal(result.audit.txHash, '0xswapbridge')
})

addTest('safe-large-transfer-review should produce report without execution', async () => {
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_review',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '25000000000',
            fromToken: { symbol: 'USDC', decimals: 6, priceUSD: '1' },
            toToken: { symbol: 'USDC', decimals: 6, priceUSD: '1' },
            slippage: 0.002,
          },
          estimate: {
            toAmount: '24990000000',
            toAmountMin: '24950000000',
            gasCosts: [],
            feeCosts: [],
          },
          includedSteps: [
            {
              type: 'cross',
              tool: 'bridge-x',
              action: { fromChainId: 1, toChainId: 10 },
            },
          ],
        }
      },
    },
  })

  const result = await runSafeLargeTransferReviewWorkflow({
    skill: safeReviewSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '25000000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x2222222222222222222222222222222222222222',
      operationId: 'op_review_1',
    },
    quoteTool,
    policyConfig: {
      maxAutoUsd: 3000,
      maxConfirmUsd: 10000,
      maxSlippage: 0.005,
    },
    riskChecker: async () => ({
      level: 'high',
      reasons: ['large amount'],
    }),
    addressScreener: async () => ({
      allowed: false,
      flags: ['unknown receiver'],
    }),
  })

  assert.equal(result.state, LifecycleState.AWAITING_CONFIRM)
  assert.equal(result.report.recommendedAction, 'do_not_execute')
  assert.equal(result.audit.txHash, null)
})

addTest('feature flags should merge env and input settings', () => {
  const flags = resolveFeatureFlags(
    { quoteOnly: true, disabledSkills: ['bridge-assets'] },
    { LIFISKILL_DISABLED_SKILLS: 'swap-then-bridge' },
  )
  assert.equal(flags.quoteOnly, true)
  assert.equal(isSkillDisabled('bridge-assets', flags), true)
  assert.equal(isSkillDisabled('swap-then-bridge', flags), true)
})

addTest('bridge workflow should respect quote-only mode', async () => {
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_qo',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000',
            fromToken: { symbol: 'USDC', decimals: 6, address: '0xUSDC', priceUSD: '1' },
            toToken: { symbol: 'USDC', decimals: 6, priceUSD: '1' },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '999000',
            toAmountMin: '998000',
            gasCosts: [],
            feeCosts: [],
          },
          includedSteps: [],
        }
      },
    },
  })

  const result = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      autoConfirm: true,
      confirmed: true,
      operationId: 'op_qo_1',
    },
    quoteTool,
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return { txHash: '0xshould_not_execute' }
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
    featureFlags: {
      quoteOnly: true,
    },
  })

  assert.equal(result.quoteOnly, true)
  assert.equal(result.state, LifecycleState.AWAITING_CONFIRM)
  assert.equal(result.audit.errorCode, ErrorCode.EXECUTION_BLOCKED_QUOTE_ONLY)
})

addTest('bridge workflow should fail when skill is disabled', async () => {
  const result = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: '0x1111111111111111111111111111111111111111',
      receiver: '0x1111111111111111111111111111111111111111',
      operationId: 'op_disabled_1',
    },
    quoteTool: new LiFiQuoteTool({
      client: {
        async getQuote() {
          return {}
        },
      },
    }),
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return {}
        },
      },
    }),
    statusTool: new LiFiStatusTool({
      client: {
        async getStatus() {
          return {}
        },
      },
    }),
    featureFlags: {
      disabledSkills: ['bridge-assets'],
    },
  })

  assert.equal(result.state, LifecycleState.FAILED)
  assert.equal(result.error.code, ErrorCode.SKILL_DISABLED)
})

addTest('status poller should timeout with STATUS_TIMEOUT', async () => {
  let ticks = 0
  try {
    await pollUntilTerminal({
      fetchStatus: async () => {
        ticks += 1
        return { status: 'PENDING' }
      },
      input: { txHash: '0xtimeout' },
      config: {
        initialIntervalMs: 1,
        maxIntervalMs: 2,
        timeoutMs: 6,
        backoffFactor: 1.5,
      },
    })
    assert.fail('Expected timeout error')
  } catch (error) {
    assert.equal(error.code, ErrorCode.STATUS_TIMEOUT)
    assert.equal(ticks > 0, true)
  }
})

addTest('status poller should tolerate transient fetch errors', async () => {
  let count = 0
  const result = await pollUntilTerminal({
    fetchStatus: async () => {
      count += 1
      if (count <= 2) {
        throw new Error('temporary network issue')
      }
      return { status: 'DONE' }
    },
    input: { txHash: '0xok' },
    config: {
      initialIntervalMs: 1,
      maxIntervalMs: 2,
      timeoutMs: 100,
      maxFetchErrors: 3,
      backoffFactor: 1.2,
    },
  })

  assert.equal(result.lifecycleState, 'completed')
  assert.equal(count, 3)
})

addTest('status poller should fail after fetch error budget exhausted', async () => {
  try {
    await pollUntilTerminal({
      fetchStatus: async () => {
        throw new Error('always fail')
      },
      input: { txHash: '0xfail' },
      config: {
        initialIntervalMs: 1,
        maxIntervalMs: 2,
        timeoutMs: 100,
        maxFetchErrors: 1,
        backoffFactor: 1.2,
      },
    })
    assert.fail('Expected fetch error budget failure')
  } catch (error) {
    assert.equal(error.code, ErrorCode.STATUS_FETCH_FAILED)
  }
})

addTest('status mapping should map DONE/FAILED/PENDING', () => {
  assert.equal(mapExternalStatusToLifecycle('DONE'), 'completed')
  assert.equal(mapExternalStatusToLifecycle('FAILED'), 'failed')
  assert.equal(mapExternalStatusToLifecycle('PENDING'), 'polling')
})

addTest('error classifier should classify timeout', () => {
  const mapped = classifyError(new Error('request timeout'))
  assert.equal(mapped.code, ErrorCode.STATUS_TIMEOUT)
})

addTest('release gate should pass with healthy metrics', () => {
  const result = evaluateReleaseGate({
    tests: {
      total: 20,
      failed: 0,
    },
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
      successRate7d: 0.98,
      statusTimeoutRate7d: 0.005,
      p95CompletionMinutes7d: 6,
    },
  })

  assert.equal(result.pass, true)
  assert.equal(result.failedChecks.length, 0)
})

addTest('release gate should fail with weak metrics and throw in assert mode', () => {
  const result = evaluateReleaseGate({
    tests: {
      total: 20,
      failed: 2,
    },
    quality: {
      p0Count: 1,
      p1Count: 0,
      confirmationCoverage: 0.9,
      auditCoverage: 0.95,
      fallbackCoverage: 0.8,
    },
    skills: {
      bridgeAssetsE2E: true,
      swapThenBridgeE2E: false,
      safeLargeTransferReviewE2E: true,
    },
    slos: {
      successRate7d: 0.9,
      statusTimeoutRate7d: 0.03,
      p95CompletionMinutes7d: 10,
    },
  })

  assert.equal(result.pass, false)
  assert.equal(result.failedChecks.length > 0, true)

  assert.throws(() => {
    assertReleaseGate({
      tests: {
        total: 1,
        failed: 1,
      },
      quality: {
        p0Count: 1,
      },
      skills: {},
      slos: {},
    })
  }, /Release gate failed/)
})

addTest('bridge workflow should replay completed result for same idempotency key', async () => {
  const registry = createOperationRegistry()
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_idem_complete',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000',
            fromToken: {
              symbol: 'USDC',
              decimals: 6,
              address: '0xUSDC',
              priceUSD: '1',
            },
            toToken: {
              symbol: 'USDC',
              decimals: 6,
              priceUSD: '1',
            },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '999000',
            toAmountMin: '998000',
            gasCosts: [],
            feeCosts: [],
            approvalAddress: '0xSpender',
          },
          includedSteps: [],
        }
      },
    },
  })

  let executeCount = 0
  const executeTool = new LiFiExecuteTool({
    client: {
      async execute() {
        executeCount += 1
        return { txHash: '0xidem_done' }
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

  const baseInput = {
    fromChain: 1,
    toChain: 10,
    token: 'USDC',
    amount: '1000000',
    fromAddress: '0x1111111111111111111111111111111111111111',
    receiver: '0x1111111111111111111111111111111111111111',
    autoConfirm: true,
    confirmed: true,
    operationId: 'op_idem_1',
  }

  const first = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: baseInput,
    quoteTool,
    executeTool,
    statusTool,
    policyConfig: {
      maxAutoUsd: 3000,
      maxConfirmUsd: 10000,
      maxSlippage: 0.005,
    },
    operationRegistry: registry,
  })

  const second = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: baseInput,
    quoteTool,
    executeTool,
    statusTool,
    policyConfig: {
      maxAutoUsd: 3000,
      maxConfirmUsd: 10000,
      maxSlippage: 0.005,
    },
    operationRegistry: registry,
  })

  assert.equal(first.state, LifecycleState.COMPLETED)
  assert.equal(second.state, LifecycleState.COMPLETED)
  assert.equal(second.replayed, true)
  assert.equal(executeCount, 1)
})

addTest('bridge workflow should return in progress for duplicate operation while running', async () => {
  const registry = createOperationRegistry()
  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_idem_inprogress',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000',
            fromToken: { symbol: 'USDC', decimals: 6, address: '0xUSDC', priceUSD: '1' },
            toToken: { symbol: 'USDC', decimals: 6, priceUSD: '1' },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '999000',
            toAmountMin: '998000',
            gasCosts: [],
            feeCosts: [],
          },
          includedSteps: [],
        }
      },
    },
  })

  const operationId = 'op_idem_2'
  const wallet = '0x1111111111111111111111111111111111111111'
  const routeFingerprint = '1:10:usdc:usdc:1000000'
  const key = [
    operationId.toLowerCase(),
    wallet.toLowerCase(),
    'bridge-assets',
    routeFingerprint,
  ].join('|')

  registry.start({
    key,
    operationId,
    walletAddress: wallet,
    skillId: 'bridge-assets',
    routeFingerprint,
  })
  registry.update({
    key,
    state: LifecycleState.EXECUTING,
  })

  const result = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      fromChain: 1,
      toChain: 10,
      token: 'USDC',
      amount: '1000000',
      fromAddress: wallet,
      receiver: wallet,
      autoConfirm: true,
      confirmed: true,
      operationId,
    },
    quoteTool,
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return { txHash: '0xshould_not_happen' }
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
    operationRegistry: registry,
  })

  assert.equal(result.replayed, true)
  assert.equal(result.inProgress, true)
  assert.equal(result.state, LifecycleState.POLLING)
})

addTest('bridge workflow should proceed after awaiting_confirm when user confirms later', async () => {
  const registry = createOperationRegistry()
  let executeCount = 0

  const quoteTool = new LiFiQuoteTool({
    client: {
      async getQuote() {
        return {
          id: 'route_confirm_resume',
          tool: 'lifi',
          action: {
            fromChainId: 1,
            toChainId: 10,
            fromAmount: '1000000',
            fromToken: {
              symbol: 'USDC',
              decimals: 6,
              address: '0xUSDC',
              priceUSD: '1',
            },
            toToken: {
              symbol: 'USDC',
              decimals: 6,
              priceUSD: '1',
            },
            slippage: 0.001,
          },
          estimate: {
            toAmount: '999000',
            toAmountMin: '998000',
            gasCosts: [],
            feeCosts: [],
            approvalAddress: '0xSpender',
          },
          includedSteps: [],
        }
      },
    },
  })

  const executeTool = new LiFiExecuteTool({
    client: {
      async execute() {
        executeCount += 1
        return { txHash: '0xresume_tx' }
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

  const operationId = 'op_confirm_resume_1'
  const wallet = '0x1111111111111111111111111111111111111111'
  const baseInput = {
    fromChain: 1,
    toChain: 10,
    token: 'USDC',
    amount: '1000000',
    fromAddress: wallet,
    receiver: wallet,
    autoConfirm: false,
    operationId,
  }

  const first = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      ...baseInput,
      confirmed: false,
    },
    quoteTool,
    executeTool,
    statusTool,
    operationRegistry: registry,
  })

  const second = await runBridgeAssetsWorkflow({
    skill: bridgeSkill,
    input: {
      ...baseInput,
      confirmed: true,
    },
    quoteTool,
    executeTool,
    statusTool,
    operationRegistry: registry,
    quotePolicy: {
      maxRequoteCount: 0,
    },
  })

  assert.equal(first.state, LifecycleState.AWAITING_CONFIRM)
  assert.equal(first.requiresConfirmation, true)
  assert.equal(second.state, LifecycleState.COMPLETED)
  assert.equal(second.replayed, undefined)
  assert.equal(executeCount, 1)
})

addTest('gray release should produce stable actor gating decisions', () => {
  const config = createGrayReleaseConfig({
    phases: [0, 50, 100],
    salt: 'seed-a',
    skills: {
      'bridge-assets': { phaseIndex: 1 },
      'swap-then-bridge': { phaseIndex: 0 },
      'safe-large-transfer-review': { phaseIndex: 2 },
    },
  })

  const actor = '0x1111111111111111111111111111111111111111'
  const first = isActorInGrayRelease('bridge-assets', actor, config)
  const second = isActorInGrayRelease('bridge-assets', actor, config)
  assert.equal(first, second)
  assert.equal(isActorInGrayRelease('swap-then-bridge', actor, config), false)
  assert.equal(isActorInGrayRelease('safe-large-transfer-review', actor, config), true)
})

addTest('gray release should map disabled skills into feature flags', () => {
  const flags = deriveGrayReleaseFlags({
    actorId: 'wallet-a',
    baseFlags: {
      quoteOnly: false,
      disabledSkills: ['custom-skill'],
    },
    config: {
      phases: [0, 100],
      skills: {
        'bridge-assets': { phaseIndex: 1 },
        'swap-then-bridge': { phaseIndex: 0 },
        'safe-large-transfer-review': { phaseIndex: 1 },
      },
    },
    knownSkills: [
      'bridge-assets',
      'swap-then-bridge',
      'safe-large-transfer-review',
    ],
  })

  assert.equal(flags.disabledSkills.includes('custom-skill'), true)
  assert.equal(flags.disabledSkills.includes('swap-then-bridge'), true)
  assert.equal(flags.disabledSkills.includes('bridge-assets'), false)
})

addTest('gray release promotion should be blocked when release gate fails', () => {
  assert.throws(() => {
    promoteGrayRelease(
      {
        phases: [0, 5, 100],
        skills: {
          'bridge-assets': { phaseIndex: 0 },
        },
      },
      {
        metrics: {
          tests: { total: 10, failed: 1 },
          quality: { p0Count: 1 },
          skills: {
            bridgeAssetsE2E: true,
            swapThenBridgeE2E: false,
            safeLargeTransferReviewE2E: false,
          },
          slos: {
            successRate7d: 0.8,
            statusTimeoutRate7d: 0.05,
            p95CompletionMinutes7d: 15,
          },
        },
      },
    )
  }, /Gray release promotion blocked/)
})

addTest('gray release promotion should advance skill phase when release gate passes', () => {
  const result = promoteGrayRelease(
    {
      phases: [0, 5, 10, 100],
      skills: {
        'bridge-assets': { phaseIndex: 1 },
      },
    },
    {
      metrics: {
        tests: { total: 24, failed: 0 },
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
          successRate7d: 0.99,
          statusTimeoutRate7d: 0.003,
          p95CompletionMinutes7d: 5,
        },
      },
      skills: ['bridge-assets'],
      step: 1,
    },
  )

  assert.equal(result.promoted, true)
  assert.equal(result.config.skills['bridge-assets'].phaseIndex, 2)
  assert.equal(result.gate.pass, true)
})

addTest('rollout manager should promote config and return actor flags', async () => {
  const manager = createRolloutManager({
    stateStore: createInMemoryRolloutStateStore({
      initialConfig: {
        phases: [0, 5, 10, 100],
        skills: {
          'bridge-assets': { phaseIndex: 1 },
          'swap-then-bridge': { phaseIndex: 0 },
          'safe-large-transfer-review': { phaseIndex: 1 },
        },
      },
    }),
    metricsProvider: async () => ({
      tests: { total: 28, failed: 0 },
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
        successRate7d: 0.99,
        statusTimeoutRate7d: 0.003,
        p95CompletionMinutes7d: 5.5,
      },
    }),
    autoPromote: true,
    strictGate: true,
  })

  const rollout = await manager.evaluateAndPromote()
  assert.equal(rollout.gate.pass, true)
  assert.equal(rollout.promoted, true)
  assert.equal(rollout.traffic['bridge-assets'] >= 10, true)

  const flags = await manager.getFlagsForActor('wallet-a')
  assert.equal(Array.isArray(flags.disabledSkills), true)

  const state = await manager.getState()
  assert.equal(state.lastGate.pass, true)
  assert.equal(typeof state.updatedAt, 'string')
})

addTest('rollout manager should block in non-strict mode when gate fails', async () => {
  const manager = createRolloutManager({
    stateStore: createInMemoryRolloutStateStore({
      initialConfig: {
        phases: [0, 5, 10, 100],
        skills: {
          'bridge-assets': { phaseIndex: 1 },
        },
      },
    }),
    autoPromote: true,
    strictGate: false,
  })

  const rollout = await manager.evaluateAndPromote({
    metrics: {
      tests: { total: 28, failed: 1 },
      quality: {
        p0Count: 1,
      },
      skills: {
        bridgeAssetsE2E: true,
        swapThenBridgeE2E: false,
        safeLargeTransferReviewE2E: false,
      },
      slos: {
        successRate7d: 0.8,
        statusTimeoutRate7d: 0.04,
        p95CompletionMinutes7d: 12,
      },
    },
  })

  assert.equal(rollout.gate.pass, false)
  assert.equal(rollout.blocked, true)
  assert.equal(rollout.errorCode, 'GRAY_RELEASE_GATE_BLOCKED')
})

addTest('rollout manager should throw in strict mode when gate fails', async () => {
  const manager = createRolloutManager({
    stateStore: createInMemoryRolloutStateStore({
      initialConfig: {
        phases: [0, 5, 10, 100],
        skills: {
          'bridge-assets': { phaseIndex: 1 },
        },
      },
    }),
    autoPromote: true,
    strictGate: true,
  })

  await assert.rejects(
    manager.evaluateAndPromote({
      metrics: {
        tests: { total: 28, failed: 1 },
        quality: {
          p0Count: 1,
        },
        skills: {
          bridgeAssetsE2E: true,
          swapThenBridgeE2E: false,
          safeLargeTransferReviewE2E: false,
        },
        slos: {
          successRate7d: 0.8,
          statusTimeoutRate7d: 0.04,
          p95CompletionMinutes7d: 12,
        },
      },
    }),
    /Rollout manager blocked by release gate/,
  )

  const state = await manager.getState()
  assert.equal(Boolean(state.lastGate), true)
  assert.equal(state.lastGate.pass, false)
})

addTest('workflow runtime should inject rollout flags and shared idempotency', async () => {
  const manager = createRolloutManager({
    stateStore: createInMemoryRolloutStateStore({
      initialConfig: {
        phases: [0, 100],
        skills: {
          'bridge-assets': { phaseIndex: 1 },
          'swap-then-bridge': { phaseIndex: 0 },
          'safe-large-transfer-review': { phaseIndex: 1 },
        },
      },
    }),
    autoPromote: false,
  })

  const runtime = createWorkflowRuntime({
    rolloutManager: manager,
    skills: [bridgeSkill, swapBridgeSkill, safeReviewSkill],
    quoteTool: new LiFiQuoteTool({
      client: {
        async getQuote() {
          return {
            id: 'route_runtime',
            tool: 'lifi',
            action: {
              fromChainId: 1,
              toChainId: 10,
              fromAmount: '1000000',
              fromToken: {
                symbol: 'USDC',
                decimals: 6,
                address: '0xUSDC',
                priceUSD: '1',
              },
              toToken: {
                symbol: 'USDC',
                decimals: 6,
                priceUSD: '1',
              },
              slippage: 0.001,
            },
            estimate: {
              toAmount: '999000',
              toAmountMin: '999000',
              gasCosts: [],
              feeCosts: [],
              approvalAddress: '0xSpender',
            },
            includedSteps: [],
          }
        },
      },
    }),
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return { txHash: '0xruntime_tx' }
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
  })

  const baseInput = {
    fromChain: 1,
    toChain: 10,
    token: 'USDC',
    amount: '1000000',
    fromAddress: '0x1111111111111111111111111111111111111111',
    receiver: '0x1111111111111111111111111111111111111111',
    autoConfirm: true,
    confirmed: true,
    operationId: 'runtime_1',
  }

  const first = await runtime.runSkill({
    skillId: 'bridge-assets',
    input: baseInput,
    approvalProvider: {
      async getAllowance() {
        return '1000000'
      },
    },
    quotePolicy: {
      maxRequoteCount: 0,
    },
  })

  const second = await runtime.runSkill({
    skillId: 'bridge-assets',
    input: baseInput,
    approvalProvider: {
      async getAllowance() {
        return '1000000'
      },
    },
    quotePolicy: {
      maxRequoteCount: 0,
    },
  })

  assert.equal(first.runtime.featureFlags.disabledSkills.includes('swap-then-bridge'), true)
  assert.equal(second.replayed, true)
  assert.equal(second.state, LifecycleState.COMPLETED)
})

addTest('runtime server should expose health, rollout and run-skill endpoints', async () => {
  const manager = createRolloutManager({
    stateStore: createInMemoryRolloutStateStore({
      initialConfig: {
        phases: [0, 100],
        skills: {
          'bridge-assets': { phaseIndex: 1 },
          'swap-then-bridge': { phaseIndex: 1 },
          'safe-large-transfer-review': { phaseIndex: 1 },
        },
      },
    }),
    metricsProvider: async () => ({
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
        successRate7d: 0.99,
        statusTimeoutRate7d: 0.003,
        p95CompletionMinutes7d: 5.5,
      },
    }),
    autoPromote: false,
  })

  const runtime = createWorkflowRuntime({
    rolloutManager: manager,
    skills: [bridgeSkill, swapBridgeSkill, safeReviewSkill],
    quoteTool: new LiFiQuoteTool({
      client: {
        async getQuote() {
          return {
            id: 'route_server',
            tool: 'lifi',
            action: {
              fromChainId: 1,
              toChainId: 10,
              fromAmount: '1000000',
              fromToken: {
                symbol: 'USDC',
                decimals: 6,
                address: '0xUSDC',
                priceUSD: '1',
              },
              toToken: {
                symbol: 'USDC',
                decimals: 6,
                priceUSD: '1',
              },
              slippage: 0.001,
            },
            estimate: {
              toAmount: '999000',
              toAmountMin: '999000',
              gasCosts: [],
              feeCosts: [],
              approvalAddress: '0xSpender',
            },
            includedSteps: [],
          }
        },
      },
    }),
    executeTool: new LiFiExecuteTool({
      client: {
        async execute() {
          return { txHash: '0xserver_tx' }
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
  })

  const server = createRuntimeServer({
    runtime,
    host: '127.0.0.1',
    port: 0,
    authToken: 'secret-token',
    approvalProvider: {
      async getAllowance() {
        return '1000000'
      },
    },
  })

  const started = await server.start()

  const health = await fetch(`${started.url}/healthz`)
  assert.equal(health.status, 200)
  const healthJson = await health.json()
  assert.equal(healthJson.ok, true)

  const unauthorized = await fetch(`${started.url}/evaluate-rollout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(unauthorized.status, 401)

  const rolloutResp = await fetch(`${started.url}/evaluate-rollout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-token',
    },
    body: JSON.stringify({ context: { source: 'test' } }),
  })
  assert.equal(rolloutResp.status, 200)
  const rolloutJson = await rolloutResp.json()
  assert.equal(rolloutJson.ok, true)
  assert.equal(rolloutJson.result.gate.pass, true)

  const runResp = await fetch(`${started.url}/run-skill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-token',
    },
    body: JSON.stringify({
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
        operationId: 'server_run_1',
      },
      quotePolicy: {
        maxRequoteCount: 0,
      },
    }),
  })
  assert.equal(runResp.status, 200)
  const runJson = await runResp.json()
  assert.equal(runJson.ok, true)
  assert.equal(runJson.result.state, LifecycleState.COMPLETED)

  const notFound = await fetch(`${started.url}/unknown`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-token',
    },
    body: JSON.stringify({}),
  })
  assert.equal(notFound.status, 404)

  await server.stop()
})

addTest('runtime server should enforce IP allowlist and emit structured logs', async () => {
  const logs = []
  const runtime = {
    async evaluateRollout() {
      return { gate: { pass: true } }
    },
    async runSkill() {
      return { state: 'completed' }
    },
  }

  const server = createRuntimeServer({
    runtime,
    host: '127.0.0.1',
    port: 0,
    authToken: null,
    trustedProxy: true,
    ipAllowlist: ['10.0.0.0/8'],
    logWriter: entry => {
      logs.push(entry)
    },
  })

  const started = await server.start()

  const blocked = await fetch(`${started.url}/evaluate-rollout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.10',
    },
    body: JSON.stringify({}),
  })
  assert.equal(blocked.status, 403)
  const blockedJson = await blocked.json()
  assert.equal(blockedJson.ok, false)
  assert.equal(blockedJson.error.code, 'FORBIDDEN_IP')
  assert.equal(typeof blockedJson.requestId, 'string')
  assert.equal(blockedJson.requestId.length > 0, true)

  const allowed = await fetch(`${started.url}/evaluate-rollout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '10.2.3.4',
      'X-Request-Id': 'req-test-1',
    },
    body: JSON.stringify({}),
  })
  assert.equal(allowed.status, 200)
  const allowedJson = await allowed.json()
  assert.equal(allowedJson.ok, true)
  assert.equal(allowedJson.requestId, 'req-test-1')

  await server.stop()

  assert.equal(logs.length >= 2, true)
  assert.equal(logs.some(item => item.errorCode === 'FORBIDDEN_IP'), true)
  assert.equal(logs.some(item => item.requestId === 'req-test-1'), true)
  assert.equal(logs.every(item => item.event === 'runtime_http_access'), true)
})

async function run() {
  let passed = 0
  let failed = 0

  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`PASS: ${t.name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL: ${t.name}`)
      console.error(error)
    }
  }

  console.log(`\nTest result: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) {
    process.exitCode = 1
  }
}

run()
