import { ErrorCode } from './error-mapping.js'

const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000

function normalize(value) {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim().toLowerCase()
}

function toFiniteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function isRetryableErrorCode(code) {
  return (
    code === ErrorCode.STATUS_TIMEOUT ||
    code === ErrorCode.LIFI_API_ERROR ||
    code === ErrorCode.SIGN_FAILED
  )
}

function isFresh(record, nowMs, dedupeWindowMs) {
  return nowMs - record.updatedAt <= dedupeWindowMs
}

function cloneRecord(record) {
  return {
    key: record.key,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    skillId: record.skillId,
    operationId: record.operationId,
    walletAddress: record.walletAddress,
    routeFingerprint: record.routeFingerprint,
    result: record.result ?? null,
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? null,
  }
}

export function buildOperationKey({
  operationId,
  walletAddress,
  skillId,
  routeFingerprint,
}) {
  return [
    normalize(operationId),
    normalize(walletAddress),
    normalize(skillId),
    normalize(routeFingerprint),
  ].join('|')
}

export function createOperationRegistry(options = {}) {
  const dedupeWindowMs = toFiniteNumber(
    options.dedupeWindowMs,
    DEFAULT_DEDUPE_WINDOW_MS,
  )
  const store = options.store ?? new Map()
  const now = options.now ?? (() => Date.now())

  function cleanupExpired() {
    const nowMs = now()
    for (const [key, record] of store.entries()) {
      if (!isFresh(record, nowMs, dedupeWindowMs)) {
        store.delete(key)
      }
    }
  }

  function getRecord(key) {
    cleanupExpired()
    const record = store.get(key)
    return record ? cloneRecord(record) : null
  }

  function saveRecord(key, patch) {
    const nowMs = now()
    const existing = store.get(key)
    const next = {
      key,
      createdAt: existing?.createdAt ?? nowMs,
      updatedAt: nowMs,
      state: patch.state ?? existing?.state ?? 'planned',
      skillId: patch.skillId ?? existing?.skillId ?? null,
      operationId: patch.operationId ?? existing?.operationId ?? null,
      walletAddress: patch.walletAddress ?? existing?.walletAddress ?? null,
      routeFingerprint:
        patch.routeFingerprint ?? existing?.routeFingerprint ?? null,
      result:
        patch.result !== undefined ? patch.result : existing?.result ?? null,
      errorCode:
        patch.errorCode !== undefined
          ? patch.errorCode
          : existing?.errorCode ?? null,
      errorMessage:
        patch.errorMessage !== undefined
          ? patch.errorMessage
          : existing?.errorMessage ?? null,
    }
    store.set(key, next)
    return cloneRecord(next)
  }

  function start(payload = {}) {
    const key = payload.key
    if (!key || key === '|||') {
      return {
        key: null,
        decision: 'skip',
        record: null,
      }
    }

    cleanupExpired()
    const existing = store.get(key)
    if (!existing) {
      const record = saveRecord(key, {
        state: 'planned',
        skillId: payload.skillId ?? null,
        operationId: payload.operationId ?? null,
        walletAddress: payload.walletAddress ?? null,
        routeFingerprint: payload.routeFingerprint ?? null,
      })
      return {
        key,
        decision: 'proceed',
        record,
      }
    }

    const current = cloneRecord(existing)
    if (
      current.state === 'executing' ||
      current.state === 'polling' ||
      current.state === 'planned'
    ) {
      return {
        key,
        decision: 'return_in_progress',
        record: current,
      }
    }

    if (current.state === 'awaiting_confirm') {
      const record = saveRecord(key, {
        state: 'planned',
        errorCode: null,
        errorMessage: null,
        result: null,
        skillId: payload.skillId ?? current.skillId,
        operationId: payload.operationId ?? current.operationId,
        walletAddress: payload.walletAddress ?? current.walletAddress,
        routeFingerprint: payload.routeFingerprint ?? current.routeFingerprint,
      })
      return {
        key,
        decision: 'proceed',
        record,
      }
    }

    if (current.state === 'completed') {
      return {
        key,
        decision: 'return_completed',
        record: current,
      }
    }

    if (current.state === 'failed' && !isRetryableErrorCode(current.errorCode)) {
      return {
        key,
        decision: 'return_failed',
        record: current,
      }
    }

    const record = saveRecord(key, {
      state: 'planned',
      errorCode: null,
      errorMessage: null,
      result: null,
      skillId: payload.skillId ?? current.skillId,
      operationId: payload.operationId ?? current.operationId,
      walletAddress: payload.walletAddress ?? current.walletAddress,
      routeFingerprint: payload.routeFingerprint ?? current.routeFingerprint,
    })
    return {
      key,
      decision: 'proceed',
      record,
    }
  }

  function update(payload = {}) {
    const key = payload.key
    if (!key) {
      return null
    }
    return saveRecord(key, {
      state: payload.state,
      result: payload.result,
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
    })
  }

  return {
    dedupeWindowMs,
    start,
    update,
    getRecord,
  }
}
