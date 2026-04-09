import { createOperationRegistry } from './idempotency.js'
import { runBridgeAssetsWorkflow } from './workflow-bridge-assets.js'
import { runSwapThenBridgeWorkflow } from './workflow-swap-then-bridge.js'
import { runSafeLargeTransferReviewWorkflow } from './workflow-safe-large-transfer-review.js'

const SUPPORTED_SKILLS = [
  'bridge-assets',
  'swap-then-bridge',
  'safe-large-transfer-review',
]

function normalizeSkillId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeDisabledSkills(list) {
  if (!Array.isArray(list)) {
    return []
  }
  return [...new Set(list.map(normalizeSkillId).filter(Boolean))]
}

function mergeFeatureFlags(baseFlags = {}, extraFlags = {}) {
  return {
    quoteOnly: Boolean(baseFlags.quoteOnly) || Boolean(extraFlags.quoteOnly),
    disabledSkills: [
      ...new Set([
        ...normalizeDisabledSkills(baseFlags.disabledSkills),
        ...normalizeDisabledSkills(extraFlags.disabledSkills),
      ]),
    ],
  }
}

function buildSkillsById(options = {}) {
  const byId = {}

  if (options.skillsById && typeof options.skillsById === 'object') {
    for (const [skillId, skill] of Object.entries(options.skillsById)) {
      const normalized = normalizeSkillId(skillId || skill?.id)
      if (normalized) {
        byId[normalized] = skill
      }
    }
  }

  if (Array.isArray(options.skills)) {
    for (const skill of options.skills) {
      const normalized = normalizeSkillId(skill?.id)
      if (normalized) {
        byId[normalized] = skill
      }
    }
  }

  return byId
}

function inferActorId(input, explicitActorId) {
  if (typeof explicitActorId === 'string' && explicitActorId.trim().length > 0) {
    return explicitActorId
  }
  if (typeof input?.fromAddress === 'string' && input.fromAddress.trim().length > 0) {
    return input.fromAddress
  }
  if (typeof input?.receiver === 'string' && input.receiver.trim().length > 0) {
    return input.receiver
  }
  return 'anonymous'
}

function assertSkillSupported(skillId) {
  if (!SUPPORTED_SKILLS.includes(skillId)) {
    throw new Error(`Unsupported skill id: ${skillId}`)
  }
}

export function createWorkflowRuntime(options = {}) {
  const rolloutManager = options.rolloutManager ?? null
  const operationRegistry =
    options.operationRegistry ??
    rolloutManager?.operationRegistry ??
    createOperationRegistry(options.idempotency ?? {})

  const skillsById = buildSkillsById(options)
  const baseFlags = options.baseFlags ?? {}

  async function getRuntimeFeatureFlags(actorId, runFlags = {}) {
    const rolloutFlags = rolloutManager
      ? await rolloutManager.getFlagsForActor(actorId, {
          baseFlags,
        })
      : baseFlags
    return mergeFeatureFlags(rolloutFlags, runFlags)
  }

  async function runSkill(params = {}) {
    const requestedSkillId = normalizeSkillId(params.skillId)
    assertSkillSupported(requestedSkillId)
    const skill = skillsById[requestedSkillId]
    if (!skill) {
      throw new Error(`Missing skill definition for: ${requestedSkillId}`)
    }

    const actorId = inferActorId(params.input, params.actorId)
    const featureFlags = await getRuntimeFeatureFlags(
      actorId,
      params.featureFlags ?? {},
    )

    const common = {
      skill,
      input: params.input,
      featureFlags,
      operationRegistry,
      policyConfig: params.policyConfig ?? options.policyConfig,
      pollingConfig: params.pollingConfig ?? options.pollingConfig,
      quotePolicy: params.quotePolicy ?? options.quotePolicy,
    }

    let result
    if (requestedSkillId === 'bridge-assets') {
      result = await runBridgeAssetsWorkflow({
        ...common,
        quoteTool: params.quoteTool ?? options.quoteTool,
        executeTool: params.executeTool ?? options.executeTool,
        statusTool: params.statusTool ?? options.statusTool,
        approvalProvider: params.approvalProvider ?? options.approvalProvider,
      })
    } else if (requestedSkillId === 'swap-then-bridge') {
      result = await runSwapThenBridgeWorkflow({
        ...common,
        quoteTool: params.quoteTool ?? options.quoteTool,
        executeTool: params.executeTool ?? options.executeTool,
        statusTool: params.statusTool ?? options.statusTool,
        approvalProvider: params.approvalProvider ?? options.approvalProvider,
      })
    } else {
      result = await runSafeLargeTransferReviewWorkflow({
        ...common,
        quoteTool: params.quoteTool ?? options.quoteTool,
        riskChecker: params.riskChecker ?? options.riskChecker,
        addressScreener: params.addressScreener ?? options.addressScreener,
      })
    }

    return {
      ...result,
      runtime: {
        skillId: requestedSkillId,
        actorId,
        featureFlags,
      },
    }
  }

  async function evaluateRollout(context = null) {
    if (!rolloutManager) {
      throw new Error('rolloutManager is not configured')
    }
    return rolloutManager.evaluateAndPromote({ context })
  }

  function listSkills() {
    return SUPPORTED_SKILLS.filter(skillId => Boolean(skillsById[skillId]))
  }

  return {
    runSkill,
    evaluateRollout,
    listSkills,
    operationRegistry,
    rolloutManager,
  }
}
