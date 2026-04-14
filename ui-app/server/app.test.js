import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from './app.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ui-app BFF', () => {
  it('normalizes and filters vaults', async () => {
    const app = createApp({
      earnClientFactory: () => ({
        async getAllVaults() {
          return {
            items: [
              {
                name: 'Vault A',
                protocol: { name: 'Morpho' },
                chainId: 8453,
                address: '0xaaa',
                apy: 5.5,
                tvl: 1000,
                isTransactional: true,
                underlyingTokens: [{ address: '0xusdc', symbol: 'USDC' }],
              },
              {
                name: 'Vault B',
                protocol: { name: 'Morpho' },
                chainId: 8453,
                address: '0xbbb',
                apy: 3.1,
                tvl: 3000,
                isTransactional: false,
                underlyingTokens: [{ address: '0xeth', symbol: 'ETH' }],
              },
            ],
            pageCount: 1,
            hasMore: false,
          }
        },
      }),
    })

    const response = await request(app).get('/api/earn/vaults').query({
      chainId: 8453,
      protocol: 'Morpho',
      sortBy: 'apy',
      limit: 10,
    })

    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].name).toBe('Vault A')
    expect(response.body.items[0].depositToken.address).toBe('0xusdc')
  })

  it('translates bridge batch requests in plan-only mode', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, state: 'completed', logs: [] }
      },
    }))

    const app = createApp({
      fetchImpl,
    })

    const response = await request(app)
      .post('/api/runtime/run-batch')
      .send({
        runtime: {
          baseUrl: 'http://127.0.0.1:8787',
          mode: 'plan-only',
          walletAddress: '0x1111111111111111111111111111111111111111',
        },
        destinationVault: {
          chainId: 8453,
          address: '0xvault',
          asset: {
            symbol: 'USDC',
          },
          depositToken: {
            address: '0xusdc',
            symbol: 'USDC',
          },
        },
        tasks: [
          {
            id: 'task-1',
            fromChain: 42161,
            sourceToken: 'USDC',
            amount: '1250000',
          },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body.items[0].inferredSkill).toBe('bridge-assets')
    expect(response.body.items[0].translatedRequest.input.enableDeposit).toBe(false)
    expect(response.body.items[0].translatedRequest.input.token).toBe('USDC')
  })

  it('translates swap batch requests in execute mode', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, state: 'completed', txHash: '0xhash', logs: [] }
      },
    }))

    const app = createApp({
      fetchImpl,
    })

    const response = await request(app)
      .post('/api/runtime/run-batch')
      .send({
        runtime: {
          baseUrl: 'http://127.0.0.1:8787',
          mode: 'execute',
          walletAddress: '0x1111111111111111111111111111111111111111',
        },
        destinationVault: {
          chainId: 8453,
          address: '0xvault',
          depositToken: {
            address: '0xusdc',
          },
        },
        tasks: [
          {
            id: 'task-1',
            fromChain: 10,
            sourceToken: 'ETH',
            amount: '420000000000000000',
          },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body.items[0].inferredSkill).toBe('swap-then-bridge')
    expect(response.body.items[0].translatedRequest.input.enableDeposit).toBe(true)
    expect(response.body.items[0].translatedRequest.input.toToken).toBe('0xusdc')
  })

  it('returns structured runtime error envelopes for non-200 responses', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      async json() {
        return {
          ok: false,
          error: {
            code: 'UPSTREAM_ERROR',
            message: 'runtime failed',
          },
        }
      },
    }))

    const app = createApp({
      fetchImpl,
    })

    const response = await request(app)
      .post('/api/runtime/run-batch')
      .send({
        runtime: {
          mode: 'plan-only',
          walletAddress: '0x1111111111111111111111111111111111111111',
        },
        destinationVault: {
          chainId: 8453,
          address: '0xvault',
          depositToken: {
            address: '0xusdc',
          },
        },
        tasks: [
          {
            id: 'task-1',
            fromChain: 42161,
            sourceToken: '0xusdc',
            amount: '1250000',
          },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body.items[0].error.code).toBe('UPSTREAM_ERROR')
    expect(response.body.summary.failed).toBe(1)
  })

  it('returns structured per-task validation errors instead of aborting the batch', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, state: 'completed', logs: [] }
      },
    }))

    const app = createApp({
      fetchImpl,
    })

    const response = await request(app)
      .post('/api/runtime/run-batch')
      .send({
        runtime: {
          mode: 'plan-only',
          walletAddress: '0x1111111111111111111111111111111111111111',
        },
        destinationVault: {
          chainId: 8453,
          address: '0xvault',
          depositToken: {
            address: '0xusdc',
            symbol: 'USDC',
          },
        },
        tasks: [
          {
            id: 'bad-task',
            fromChain: '',
            sourceToken: '',
            amount: '',
          },
          {
            id: 'good-task',
            fromChain: 42161,
            sourceToken: 'USDC',
            amount: '1250000',
          },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body.items[0].error.code).toBe('INVALID_TASK')
    expect(response.body.items[1].translatedRequest.skillId).toBe('bridge-assets')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
