import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import App from './App.jsx'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = String(input)

    if (url.includes('/api/earn/chains')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            items: [
              { chainId: 8453, name: 'Base' },
              { chainId: 42161, name: 'Arbitrum' },
            ],
          }
        },
      }
    }

    if (url.includes('/api/earn/protocols')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            items: [{ id: 'morpho', name: 'Morpho' }],
          }
        },
      }
    }

    if (url.includes('/api/earn/vaults')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            items: [
              {
                name: 'Morpho USDC Vault',
                protocol: 'Morpho',
                chainId: 8453,
                address: '0xvault',
                apy: 4.2,
                tvl: 1234567,
                isTransactional: true,
                depositToken: {
                  address: '0xusdc',
                  symbol: 'USDC',
                },
                raw: {
                  isRedeemable: true,
                },
              },
            ],
          }
        },
      }
    }

    if (url.includes('/api/runtime/health')) {
      return {
        ok: false,
        status: 500,
        async json() {
          return {
            ok: false,
            error: {
              message: 'runtime unavailable',
            },
          }
        },
      }
    }

    if (url.includes('/api/runtime/run-batch')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            summary: {
              total: 1,
              completed: 1,
              failed: 0,
              nonTerminal: 0,
              elapsedMs: 12,
            },
            items: [
              {
                task: {
                  id: 'task-1',
                  fromChain: 42161,
                  sourceToken: '0xusdc',
                },
                inferredSkill: 'bridge-assets',
                translatedRequest: {
                  skillId: 'bridge-assets',
                  input: {},
                },
                runtimeResponse: {
                  state: 'completed',
                  txHash: '0xhash',
                  depositTxHash: '0xdeposit',
                  logs: ['step 1', 'step 2'],
                },
              },
            ],
          }
        },
      }
    }

    throw new Error(`Unhandled fetch: ${url}`)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('App', () => {
  it('disables run before vault selection, updates route badge, and renders results', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Runtime Config')).toBeInTheDocument()
    })

    const runButton = screen.getByRole('button', { name: 'Run Batch' })
    expect(runButton).toBeDisabled()

    fireEvent.change(screen.getByRole('combobox', { name: 'Target Chain' }), {
      target: { value: '8453' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Search Vaults' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Morpho USDC Vault/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Morpho USDC Vault/i }))
    expect(runButton).toBeDisabled()

    const tokenInput = screen.getByPlaceholderText('USDC or 0x...')
    fireEvent.change(tokenInput, { target: { value: '0xusdc' } })
    expect(screen.getByText('Bridge')).toBeInTheDocument()

    fireEvent.change(tokenInput, { target: { value: 'ETH' } })
    expect(screen.getByText('Swap + Bridge')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('1250000'), {
      target: { value: '1000' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Source Chain' }), {
      target: { value: '42161' },
    })
    fireEvent.change(screen.getByPlaceholderText('Optional 0x...'), {
      target: { value: '0x1111111111111111111111111111111111111111' },
    })

    await waitFor(() => {
      expect(runButton).not.toBeDisabled()
    })

    fireEvent.click(runButton)

    await waitFor(() => {
      expect(screen.getByText('0xhash')).toBeInTheDocument()
    })

    expect(screen.getByText('0xhash')).toBeInTheDocument()
    expect(screen.getByText('bridge-assets')).toBeInTheDocument()
  })

  it('shows runtime health failure visibly', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ping Runtime' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Ping Runtime' }))

    await waitFor(() => {
      expect(screen.getByText('runtime unavailable')).toBeInTheDocument()
    })
  })

  it('shows task validation errors and keeps run disabled until fields are complete', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Runtime Config')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Target Chain' }), {
      target: { value: '8453' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Search Vaults' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Morpho USDC Vault/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Morpho USDC Vault/i }))

    expect(screen.getByText('Source chain is required. Source token is required. Amount must be a positive integer string. Wallet address or from-address override is required.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Batch' })).toBeDisabled()

    fireEvent.change(screen.getByRole('combobox', { name: 'Source Chain' }), {
      target: { value: '42161' },
    })
    fireEvent.change(screen.getByPlaceholderText('USDC or 0x...'), {
      target: { value: 'USDC' },
    })
    fireEvent.change(screen.getByPlaceholderText('1250000'), {
      target: { value: '1250000' },
    })
    fireEvent.change(screen.getByPlaceholderText('Optional 0x...'), {
      target: { value: '0x1111111111111111111111111111111111111111' },
    })

    await waitFor(() => {
      expect(screen.queryByText(/Source chain is required\./)).not.toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Run Batch' })).not.toBeDisabled()
    expect(screen.getByText('Bridge')).toBeInTheDocument()
  })
})
