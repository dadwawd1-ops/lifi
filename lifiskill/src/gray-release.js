import { evaluateReleaseGate } from './release-gate.js'

const DEFAULT_PHASES = [0, 5, 10, 25, 50, 100]
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
    return []
  }
  return [...new Set(list.map(normalizeSkillId).filter(Boolean))]
}

function toFiniteInteger(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.floor(n)
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function hashToBucket(input) {
  const text = String(input ?? '')
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return Math.abs(hash >>> 0) % 100
}

function normalizePhases(phases) {
  if (!Array.isArray(phases) || phases.length === 0) {
    return [...DEFAULT_PHASES]
  }
  const normalized = phases
    .map(value => clamp(toFiniteInteger(value, 0), 0, 100))
    .sort((a, b) => a - b)
  const deduped = [...new Set(normalized)]
  if (!deduped.includes(0)) {
    deduped.unshift(0)
  }
  if (!deduped.includes(100)) {
    deduped.push(100)
  }
  return deduped
}

export function createGrayReleaseConfig(input = {}) {
  const phases = normalizePhases(input.phases)
  const knownSkills = uniqueSkillIds(input.knownSkills ?? DEFAULT_SKILLS)
  const salt =
    typeof input.salt === 'string' && input.salt.trim().length > 0
      ? input.salt.trim()
      : 'lifiskill'

  const defaultPhaseIndex = clamp(
    toFiniteInteger(input.defaultPhaseIndex, 0),
    0,
    phases.length - 1,
  )

  const perSkill = {}
  for (const skillId of knownSkills) {
    const source = input.skills?.[skillId] ?? {}
    perSkill[skillId] = {
      phaseIndex: clamp(
        toFiniteInteger(source.phaseIndex, defaultPhaseIndex),
        0,
        phases.length - 1,
      ),
      forced: Boolean(source.forced),
    }
  }

  return {
    phases,
    knownSkills,
    salt,
    skills: perSkill,
  }
}

export function getSkillTrafficPercent(skillId, config) {
  const cfg = createGrayReleaseConfig(config)
  const normalizedSkill = normalizeSkillId(skillId)
  const skillState = cfg.skills[normalizedSkill]
  if (!skillState) {
    return 0
  }
  return cfg.phases[skillState.phaseIndex] ?? 0
}

export function isActorInGrayRelease(skillId, actorId, config) {
  const cfg = createGrayReleaseConfig(config)
  const normalizedSkill = normalizeSkillId(skillId)
  const skillState = cfg.skills[normalizedSkill]
  if (!skillState) {
    return false
  }
  if (skillState.forced) {
    return true
  }

  const percent = getSkillTrafficPercent(normalizedSkill, cfg)
  if (percent >= 100) {
    return true
  }
  if (percent <= 0) {
    return false
  }

  const key = `${cfg.salt}:${normalizedSkill}:${String(actorId ?? '')}`
  return hashToBucket(key) < percent
}

export function deriveGrayReleaseFlags({
  actorId,
  baseFlags = {},
  config = {},
  knownSkills = DEFAULT_SKILLS,
}) {
  const cfg = createGrayReleaseConfig({
    ...config,
    knownSkills,
  })
  const baseDisabled = Array.isArray(baseFlags.disabledSkills)
    ? baseFlags.disabledSkills.map(normalizeSkillId).filter(Boolean)
    : []

  const rolloutDisabled = []
  for (const skillId of cfg.knownSkills) {
    if (!isActorInGrayRelease(skillId, actorId, cfg)) {
      rolloutDisabled.push(skillId)
    }
  }

  return {
    quoteOnly: Boolean(baseFlags.quoteOnly),
    disabledSkills: [...new Set([...baseDisabled, ...rolloutDisabled])],
  }
}

export function promoteGrayRelease(config, options = {}) {
  const cfg = createGrayReleaseConfig(config)
  const gate = evaluateReleaseGate(options.metrics ?? {}, options.thresholds ?? {})

  if (!gate.pass) {
    if (options.strict !== false) {
      const err = new Error('Gray release promotion blocked by release gate')
      err.code = 'GRAY_RELEASE_GATE_BLOCKED'
      err.gate = gate
      throw err
    }
    return {
      promoted: false,
      gate,
      config: cfg,
      promotedSkills: [],
    }
  }

  const requestedSkills = uniqueSkillIds(options.skills ?? cfg.knownSkills)
  const step = Math.max(1, toFiniteInteger(options.step, 1))
  const maxPhaseIndex = cfg.phases.length - 1

  const next = createGrayReleaseConfig(cfg)
  const promotedSkills = []
  for (const skillId of requestedSkills) {
    if (!next.skills[skillId]) {
      continue
    }
    const oldIndex = next.skills[skillId].phaseIndex
    const newIndex = clamp(oldIndex + step, 0, maxPhaseIndex)
    if (newIndex !== oldIndex) {
      next.skills[skillId].phaseIndex = newIndex
      promotedSkills.push(skillId)
    }
  }

  return {
    promoted: promotedSkills.length > 0,
    gate,
    config: next,
    promotedSkills,
  }
}
