import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { EarnClient } from '../../lifi-feature/src/earn-client.js'
import {
  buildRuntimeHeaders,
  getRuntimeBaseUrl,
  normalizeChainsResponse,
  normalizeProtocolsResponse,
  normalizeVaultsResponse,
  summarizeBatchResults,
  translateTaskToRuntimeRequest,
} from './helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

function createEarnClient(overrides = {}) {
  return new EarnClient({
    baseUrl: process.env.LI_FI_EARN_BASE_URL ?? 'https://earn.li.fi',
    apiKey: process.env.LI_FI_API_KEY,
    fetchImpl: globalThis.fetch,
    ...overrides,
  })
}

function normalizeLimit(value, fallback) {
  const num = Number(value)
  if (!Number.isInteger(num) || num <= 0) {
    return fallback
  }
  return num
}

export function createApp(options = {}) {
  const app = express()
  const earnClientFactory = options.earnClientFactory ?? (() => createEarnClient())
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const enableStatic = options.enableStatic ?? process.env.UI_APP_SERVE_STATIC === '1'

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/runtime/health', asyncHandler(async (req, res) => {
    const runtimeBaseUrl = getRuntimeBaseUrl(req.query)
    const tokenHeader =
      typeof req.headers.authorization === 'string'
        ? { Authorization: req.headers.authorization }
        : {}
    const response = await fetchImpl(`${runtimeBaseUrl}/healthz`, {
      method: 'GET',
      headers: {
        ...buildRuntimeHeaders({}),
        ...tokenHeader,
      },
    })
    const payload = await response.json()
    res.status(response.status).json(payload)
  }))

  app.get('/api/earn/chains', asyncHandler(async (req, res) => {
    const client = earnClientFactory(req)
    const payload = await client.getChains()
    res.json({
      ok: true,
      items: normalizeChainsResponse(payload),
    })
  }))

  app.get('/api/earn/protocols', asyncHandler(async (req, res) => {
    const client = earnClientFactory(req)
    const payload = await client.getProtocols()
    res.json({
      ok: true,
      items: normalizeProtocolsResponse(payload),
    })
  }))

  app.get('/api/earn/vaults', asyncHandler(async (req, res) => {
    const client = earnClientFactory(req)
    const chainId = req.query.chainId ? Number(req.query.chainId) : undefined
    const limit = normalizeLimit(req.query.limit, 50)
    const maxPages = normalizeLimit(req.query.maxPages, 3)
    const hasExactVaultAddress =
      typeof req.query.vaultAddress === 'string' &&
      req.query.vaultAddress.trim().length > 0
    const sortBy = String(req.query.sortBy ?? 'apy').toLowerCase() === 'tvl'
      ? 'tvl'
      : 'apy'
    const protocol = typeof req.query.protocol === 'string' ? req.query.protocol.trim() : undefined
    const upstreamLimit = hasExactVaultAddress ? Math.max(limit, 100) : limit
    const upstreamMaxPages = hasExactVaultAddress ? Math.max(maxPages, 10) : maxPages

    const raw = await client.getAllVaults(
      {
        chainId,
        protocol,
        sortBy,
        limit: upstreamLimit,
      },
      {
        maxPages: upstreamMaxPages,
      },
    )

    const items = normalizeVaultsResponse(raw, {
      chainId,
      protocol,
      sortBy,
      limit,
      vaultAddress: req.query.vaultAddress,
    })

    res.json({
      ok: true,
      items,
      meta: {
        sortBy,
        chainId: chainId ?? null,
        protocol: protocol ?? null,
        limit,
        maxPages: upstreamMaxPages,
        count: items.length,
        pageCount: raw.pageCount ?? null,
        hasMore: raw.hasMore ?? false,
      },
    })
  }))

  app.post('/api/runtime/run-batch', asyncHandler(async (req, res) => {
    const body = req.body ?? {}
    const tasks = Array.isArray(body.tasks) ? body.tasks : []
    if (!body.destinationVault || typeof body.destinationVault !== 'object') {
      res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_DESTINATION_VAULT',
          message: 'destinationVault is required',
        },
      })
      return
    }

    if (tasks.length === 0) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'EMPTY_TASKS',
          message: 'tasks must contain at least one item',
        },
      })
      return
    }

    const startedAt = Date.now()
    const batchId = randomUUID()
    const runtimeBaseUrl = getRuntimeBaseUrl(body.runtime)
    const headers = buildRuntimeHeaders(body.runtime)
    const results = []

    for (const [index, task] of tasks.entries()) {
      let translated
      try {
        translated = translateTaskToRuntimeRequest({
          batchId,
          destinationVault: body.destinationVault,
          runtime: body.runtime,
          task,
        })
      } catch (error) {
        results.push({
          index,
          task,
          inferredSkill: null,
          translatedRequest: null,
          runtimeResponse: null,
          error: {
            state: 'invalid_task',
            status: 400,
            code: 'INVALID_TASK',
            message: error?.message ?? 'Task validation failed',
          },
        })
        continue
      }

      try {
        const response = await fetchImpl(`${runtimeBaseUrl}/run-skill`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            skillId: translated.skillId,
            input: translated.input,
          }),
        })

        const payload = await response.json()
        const item = {
          index,
          task,
          inferredSkill: translated.skillId,
          translatedRequest: {
            skillId: translated.skillId,
            input: translated.input,
          },
          runtimeResponse: payload,
        }

        if (!response.ok || payload?.ok === false) {
          item.error = {
            state:
              payload?.state ??
              payload?.error?.code ??
              `http_${response.status}`,
            status: response.status,
            code: payload?.error?.code ?? 'RUNTIME_REQUEST_FAILED',
            message:
              payload?.error?.message ??
              `Runtime request failed with status ${response.status}`,
          }
        }

        results.push(item)
      } catch (error) {
        results.push({
          index,
          task,
          inferredSkill: translated.skillId,
          translatedRequest: {
            skillId: translated.skillId,
            input: translated.input,
          },
          runtimeResponse: null,
          error: {
            state: 'network_error',
            status: null,
            code: 'NETWORK_ERROR',
            message: error?.message ?? 'Network request failed',
          },
        })
      }
    }

    res.json({
      ok: true,
      batchId,
      destinationVault: body.destinationVault,
      summary: summarizeBatchResults(results, startedAt),
      items: results,
    })
  }))

  if (enableStatic) {
    app.use(express.static(distDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next()
        return
      }
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }

  app.use((error, req, res, next) => {
    void next
    res.status(error?.statusCode ?? 500).json({
      ok: false,
      error: {
        code: error?.code ?? 'UI_APP_SERVER_ERROR',
        message: error?.message ?? 'Unexpected server error',
      },
    })
  })

  return app
}
