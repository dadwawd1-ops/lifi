import { SkillAction } from './types.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isArrayOfStrings(value) {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function hasOnlyKnownActions(actions) {
  const known = new Set(Object.values(SkillAction))
  return actions.every(action => known.has(action))
}

export function validateSkillDefinition(skill) {
  const errors = []

  if (!skill || typeof skill !== 'object') {
    return { ok: false, errors: ['Skill must be an object'] }
  }

  if (!isNonEmptyString(skill.id)) {
    errors.push('`id` must be a non-empty string')
  }

  if (!isNonEmptyString(skill.description)) {
    errors.push('`description` must be a non-empty string')
  }

  if (!isArrayOfStrings(skill.when_to_use)) {
    errors.push('`when_to_use` must be an array of non-empty strings')
  }

  if (!isArrayOfStrings(skill.inputs)) {
    errors.push('`inputs` must be an array of non-empty strings')
  }

  if (!isArrayOfStrings(skill.allowed_actions)) {
    errors.push('`allowed_actions` must be an array of non-empty strings')
  } else if (!hasOnlyKnownActions(skill.allowed_actions)) {
    errors.push('`allowed_actions` contains unknown action')
  }

  if (!Array.isArray(skill.checkpoints)) {
    errors.push('`checkpoints` must be an array')
  }

  if (!Array.isArray(skill.steps) || skill.steps.length === 0) {
    errors.push('`steps` must be a non-empty array')
  }

  if (!Array.isArray(skill.fallbacks)) {
    errors.push('`fallbacks` must be an array')
  }

  if (skill.constraints && typeof skill.constraints !== 'object') {
    errors.push('`constraints` must be an object when provided')
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}

export function assertSkillDefinition(skill) {
  const result = validateSkillDefinition(skill)
  if (!result.ok) {
    throw new Error(`Invalid skill definition: ${result.errors.join('; ')}`)
  }
}
