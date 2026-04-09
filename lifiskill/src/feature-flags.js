function normalizeSkillId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(normalizeSkillId).filter(Boolean)
}

function parseEnvDisabledSkills(envValue) {
  if (typeof envValue !== 'string' || envValue.trim().length === 0) {
    return []
  }
  return envValue
    .split(',')
    .map(item => normalizeSkillId(item))
    .filter(Boolean)
}

function parseBoolEnv(value) {
  if (typeof value !== 'string') {
    return false
  }
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export function resolveFeatureFlags(inputFlags = {}, env = process.env) {
  const disabledFromInput = normalizeList(inputFlags.disabledSkills)
  const disabledFromEnv = parseEnvDisabledSkills(env.LIFISKILL_DISABLED_SKILLS)

  return {
    quoteOnly:
      Boolean(inputFlags.quoteOnly) || parseBoolEnv(env.LIFISKILL_QUOTE_ONLY),
    disabledSkills: [...new Set([...disabledFromInput, ...disabledFromEnv])],
  }
}

export function isSkillDisabled(skillId, flags = {}) {
  const normalized = normalizeSkillId(skillId)
  return normalizeList(flags.disabledSkills).includes(normalized)
}

export function assertSkillEnabled(skillId, flags = {}) {
  if (isSkillDisabled(skillId, flags)) {
    const err = new Error(`Skill is disabled by feature flag: ${skillId}`)
    err.code = 'SKILL_DISABLED'
    throw err
  }
}

export function isQuoteOnlyEnabled(flags = {}) {
  return Boolean(flags.quoteOnly)
}

