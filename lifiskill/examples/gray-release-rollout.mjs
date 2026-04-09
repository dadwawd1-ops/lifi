import {
  deriveGrayReleaseFlags,
  getSkillTrafficPercent,
  promoteGrayRelease,
} from '../src/index.js'

const trackedSkills = [
  'bridge-assets',
  'swap-then-bridge',
  'safe-large-transfer-review',
]

function buildActorIds(total = 200) {
  const out = []
  for (let i = 1; i <= total; i += 1) {
    const hex = i.toString(16).padStart(40, '0')
    out.push(`0x${hex}`)
  }
  return out
}

const actorIds = buildActorIds(200)

function baseConfig() {
  return {
    phases: [0, 5, 10, 25, 50, 100],
    salt: 'lifiskill-rollout',
    skills: {
      'bridge-assets': { phaseIndex: 1 },
      'swap-then-bridge': { phaseIndex: 0 },
      'safe-large-transfer-review': { phaseIndex: 1 },
    },
  }
}

function healthyMetrics() {
  return {
    tests: {
      total: 24,
      failed: 0,
    },
    quality: {
      p0Count: 0,
      p1Count: 0,
      confirmationCoverage: 1,
      auditCoverage: 1,
      fallbackCoverage: 1,
    },
    skills: {
      bridgeAssetsE2E: true,
      swapThenBridgeE2E: true,
      safeLargeTransferReviewE2E: true,
    },
    slos: {
      successRate7d: 0.98,
      statusTimeoutRate7d: 0.005,
      p95CompletionMinutes7d: 6.8,
    },
  }
}

function printFlags(config, title) {
  console.log(`\n${title}`)
  const stats = {}
  for (const skillId of trackedSkills) {
    stats[skillId] = {
      enabled: 0,
      expectedPercent: getSkillTrafficPercent(skillId, config),
    }
  }

  for (const actorId of actorIds) {
    const flags = deriveGrayReleaseFlags({
      actorId,
      config,
      knownSkills: trackedSkills,
    })
    for (const skillId of trackedSkills) {
      if (!flags.disabledSkills.includes(skillId)) {
        stats[skillId].enabled += 1
      }
    }
  }

  for (const skillId of trackedSkills) {
    const enabled = stats[skillId].enabled
    const ratio = ((enabled / actorIds.length) * 100).toFixed(1)
    console.log(
      `${skillId}: enabled=${enabled}/${actorIds.length} (${ratio}%), target=${stats[skillId].expectedPercent}%`,
    )
  }
}

async function main() {
  let config = baseConfig()
  printFlags(config, 'Before promotion')

  const result = promoteGrayRelease(config, {
    metrics: healthyMetrics(),
    step: 1,
  })
  if (!result.promoted) {
    console.log('\nPromotion skipped.')
    return
  }

  config = result.config
  console.log('\nPromotion succeeded for skills:', result.promotedSkills.join(', '))
  console.log(result.gate.summary)

  printFlags(config, 'After promotion')
}

main().catch(error => {
  console.error('Gray release rollout demo failed.')
  console.error(error)
  process.exitCode = 1
})
