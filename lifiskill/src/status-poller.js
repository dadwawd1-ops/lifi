import { ErrorCode } from './error-mapping.js'

const DEFAULT_POLLING = {
  initialIntervalMs: 2000,
  maxIntervalMs: 30000,
  timeoutMs: 20 * 60 * 1000,
  backoffFactor: 1.8,
  maxFetchErrors: 3,
}

function now() {
  return Date.now()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toUpperCase()
}

export function mapExternalStatusToLifecycle(status) {
  const s = normalizeStatus(status)
  if (s === 'DONE' || s === 'COMPLETED' || s === 'SUCCESS') {
    return 'completed'
  }
  if (s === 'FAILED' || s === 'ERROR') {
    return 'failed'
  }
  return 'polling'
}

export async function pollUntilTerminal(params) {
  const {
    fetchStatus,
    input,
    onTick,
    config = {},
  } = params

  const cfg = { ...DEFAULT_POLLING, ...config }
  const started = now()
  let interval = cfg.initialIntervalMs
  let lastPayload = null
  let attempts = 0
  let fetchErrors = 0

  while (true) {
    attempts += 1
    try {
      lastPayload = await fetchStatus(input)
      fetchErrors = 0
    } catch (error) {
      fetchErrors += 1
      if (fetchErrors > cfg.maxFetchErrors) {
        const err = new Error(`Status fetch failed after ${fetchErrors} attempts`)
        err.code = ErrorCode.STATUS_FETCH_FAILED
        err.meta = {
          attempts,
          fetchErrors,
          cause: error?.message ?? String(error),
        }
        throw err
      }

      if (typeof onTick === 'function') {
        onTick({
          attempts,
          elapsedMs: now() - started,
          externalStatus: 'FETCH_ERROR',
          lifecycleStatus: 'polling',
          fetchErrors,
        })
      }

      if (now() - started >= cfg.timeoutMs) {
        const err = new Error('Status polling timed out')
        err.code = ErrorCode.STATUS_TIMEOUT
        err.meta = {
          attempts,
          elapsedMs: now() - started,
          fetchErrors,
          lastPayload,
        }
        throw err
      }

      await sleep(interval)
      interval = Math.min(
        cfg.maxIntervalMs,
        Math.floor(interval * cfg.backoffFactor),
      )
      continue
    }
    const external = lastPayload?.status ?? 'UNKNOWN'
    const lifecycle = mapExternalStatusToLifecycle(external)

    if (typeof onTick === 'function') {
      onTick({
        attempts,
        elapsedMs: now() - started,
        externalStatus: external,
        lifecycleStatus: lifecycle,
        fetchErrors,
      })
    }

    if (lifecycle === 'completed' || lifecycle === 'failed') {
      return {
        lifecycleState: lifecycle,
        externalStatus: external,
        attempts,
        elapsedMs: now() - started,
        payload: lastPayload,
      }
    }

    if (now() - started >= cfg.timeoutMs) {
      const err = new Error('Status polling timed out')
      err.code = ErrorCode.STATUS_TIMEOUT
      err.meta = {
        attempts,
        elapsedMs: now() - started,
        lastPayload,
      }
      throw err
    }

    await sleep(interval)
    interval = Math.min(
      cfg.maxIntervalMs,
      Math.floor(interval * cfg.backoffFactor),
    )
  }
}
