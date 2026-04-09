import { evaluateReleaseGate } from './release-gate.js'
import {
  createGrayReleaseConfig,
  deriveGrayReleaseFlags,
  getSkillTrafficPercent,
  promoteGrayRelease,
} from './gray-release.js'
import { createOperationRegistry } from './idempotency.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_SKILLS = [
  'bridge-assets',
  'swap-then-bridge',
  'safe-large-transfer-review',
]

function normalizeSkillId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function uniqueSkillIds(list) {
  if (!Array.isArray(list)) {
    return [...DEFAULT_SKILLS]
  }
  const out = [...new Set(list.map(normalizeSkillId).filter(Boolean))]
  return out.length > 0 ? out : [...DEFAULT_SKILLS]
}

function toFiniteInteger(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.floor(n)
}

function deepClone(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

function normalizeSnapshot(input = {}, knownSkills = DEFAULT_SKILLS) {
  const config = createGrayReleaseConfig({
    ...(input?.config ?? {}),
    knownSkills,
  })
  return {
    config,
    lastGate: input?.lastGate ?? null,
    lastMetrics: input?.lastMetrics ?? null,
    lastPromotion: input?.lastPromotion ?? null,
    updatedAt: input?.updatedAt ?? null,
  }
}

function describeTraffic(config, knownSkills = DEFAULT_SKILLS) {
  const out = {}
  for (const skillId of knownSkills) {
    out[skillId] = getSkillTrafficPercent(skillId, config)
  }
  return out
}

export function createInMemoryRolloutStateStore(options = {}) {
  const knownSkills = uniqueSkillIds(options.knownSkills)
  let snapshot = normalizeSnapshot(
    {
      config: options.initialConfig ?? {},
      ...options.initialState,
      updatedAt: options.initialState?.updatedAt ?? new Date().toISOString(),
    },
    knownSkills,
  )

  return {
    async getState() {
      return deepClone(snapshot)
    },
    async setState(nextState) {
      snapshot = normalizeSnapshot(
        {
          ...nextState,
          updatedAt: nextState?.updatedAt ?? new Date().toISOString(),
        },
        knownSkills,
      )
      return deepClone(snapshot)
    },
  }
}

export function createJsonFileRolloutStateStore(options = {}) {
  if (typeof options.filePath !== 'string' || options.filePath.trim() === '') {
    throw new Error('createJsonFileRolloutStateStore requires `filePath`')
  }

  const filePath = options.filePath
  const knownSkills = uniqueSkillIds(options.knownSkills)
  const fallback = normalizeSnapshot(
    {
      config: options.initialConfig ?? {},
      ...options.initialState,
    },
    knownSkills,
  )

  async function readSnapshot() {
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      return normalizeSnapshot(parsed, knownSkills)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return deepClone(fallback)
      }
      throw error
    }
  }

  async function writeSnapshot(snapshot) {
    await mkdir(dirname(filePath), { recursive: true })
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`
    await writeFile(filePath, payload, 'utf8')
    return deepClone(snapshot)
  }

  return {
    async getState() {
      return readSnapshot()
    },
    async setState(nextState) {
      const snapshot = normalizeSnapshot(
        {
          ...nextState,
          updatedAt: nextState?.updatedAt ?? new Date().toISOString(),
        },
        knownSkills,
      )
      return writeSnapshot(snapshot)
    },
  }
}

export function createRolloutManager(options = {}) {
  const knownSkills = uniqueSkillIds(options.knownSkills)
  const baseFlags = options.baseFlags ?? {}
  const defaultThresholds = options.thresholds ?? {}
  const defaultPromotionStep = Math.max(1, toFiniteInteger(options.step, 1))
  const autoPromote = options.autoPromote !== false
  const strictGate = options.strictGate === true
  const operationRegistry =
    options.operationRegistry ?? createOperationRegistry(options.idempotency ?? {})
  const metricsProvider =
    typeof options.metricsProvider === 'function' ? options.metricsProvider : null

  const stateStore =
    options.stateStore ??
    createInMemoryRolloutStateStore({
      initialConfig: options.initialConfig ?? {},
      knownSkills,
    })

  async function getSnapshot() {
    const raw = await stateStore.getState()
    return normalizeSnapshot(raw, knownSkills)
  }

  async function evaluateAndPromote(params = {}) {
    const snapshot = await getSnapshot()
    const currentConfig = createGrayReleaseConfig({
      ...snapshot.config,
      knownSkills,
    })

    const metrics =
      params.metrics ??
      (metricsProvider ? await metricsProvider(params.context ?? null) : null)
    if (!metrics) {
      throw new Error(
        'Rollout manager requires `metrics` or a configured `metricsProvider`',
      )
    }

    const thresholds = params.thresholds ?? defaultThresholds
    const gate = evaluateReleaseGate(metrics, thresholds)
    const promotionSkills = uniqueSkillIds(params.skills ?? knownSkills)
    const promotionStep =
      params.step !== undefined
        ? Math.max(1, toFiniteInteger(params.step, 1))
        : defaultPromotionStep
    const shouldStrictGate =
      params.strictGate !== undefined ? Boolean(params.strictGate) : strictGate

    let nextConfig = currentConfig
    let promoted = false
    let promotedSkills = []
    let blocked = false
    let errorCode = null

    if (autoPromote && gate.pass) {
      const promotion = promoteGrayRelease(currentConfig, {
        metrics,
        thresholds,
        skills: promotionSkills,
        step: promotionStep,
        strict: false,
      })
      nextConfig = promotion.config
      promoted = promotion.promoted
      promotedSkills = promotion.promotedSkills
    } else if (autoPromote && !gate.pass) {
      blocked = true
      errorCode = 'GRAY_RELEASE_GATE_BLOCKED'
    }

    const updatedAt = new Date().toISOString()
    const nextSnapshot = {
      ...snapshot,
      config: nextConfig,
      lastGate: gate,
      lastMetrics: metrics,
      lastPromotion: {
        attempted: autoPromote,
        promoted,
        promotedSkills,
        blocked,
        step: promotionStep,
      },
      updatedAt,
    }
    await stateStore.setState(nextSnapshot)

    if (blocked && shouldStrictGate) {
      const err = new Error('Rollout manager blocked by release gate')
      err.code = errorCode
      err.gate = gate
      err.snapshot = nextSnapshot
      throw err
    }

    return {
      gate,
      metrics,
      previousConfig: currentConfig,
      config: nextConfig,
      promoted,
      promotedSkills,
      blocked,
      errorCode,
      traffic: describeTraffic(nextConfig, knownSkills),
      updatedAt,
    }
  }

  async function getFlagsForActor(actorId, params = {}) {
    const snapshot = await getSnapshot()
    return deriveGrayReleaseFlags({
      actorId,
      baseFlags: {
        ...baseFlags,
        ...(params.baseFlags ?? {}),
      },
      config: snapshot.config,
      knownSkills: params.knownSkills ?? knownSkills,
    })
  }

  async function getFlagsForActors(actorIds = [], params = {}) {
    const out = {}
    for (const actorId of actorIds) {
      out[actorId] = await getFlagsForActor(actorId, params)
    }
    return out
  }

  async function getState() {
    const snapshot = await getSnapshot()
    return {
      ...snapshot,
      traffic: describeTraffic(snapshot.config, knownSkills),
    }
  }

  return {
    evaluateAndPromote,
    getFlagsForActor,
    getFlagsForActors,
    getState,
    operationRegistry,
    stateStore,
  }
}
