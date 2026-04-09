import {
  createJsonFileRolloutStateStore,
  createRolloutManager,
} from '../src/index.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const statePath = join(__dirname, '..', '.runtime', 'rollout-state.json')

function mockMetricsProvider() {
  return {
    tests: { total: 37, failed: 0 },
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
      successRate7d: 0.985,
      statusTimeoutRate7d: 0.004,
      p95CompletionMinutes7d: 6.2,
    },
  }
}

async function main() {
  const stateStore = createJsonFileRolloutStateStore({
    filePath: statePath,
    initialConfig: {
      phases: [0, 5, 10, 25, 50, 100],
      salt: 'lifiskill-prod',
      skills: {
        'bridge-assets': { phaseIndex: 1 },
        'swap-then-bridge': { phaseIndex: 0 },
        'safe-large-transfer-review': { phaseIndex: 1 },
      },
    },
  })

  const manager = createRolloutManager({
    stateStore,
    metricsProvider: async () => mockMetricsProvider(),
    baseFlags: {
      quoteOnly: false,
    },
    autoPromote: true,
    strictGate: false,
  })

  const rollout = await manager.evaluateAndPromote()
  console.log('Gate:', rollout.gate.summary)
  console.log('Promoted:', rollout.promoted, rollout.promotedSkills.join(', '))
  console.log('Traffic:', rollout.traffic)

  const actorIds = [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
  ]
  const flagsByActor = await manager.getFlagsForActors(actorIds)
  console.log('\nFlags by actor')
  for (const actorId of actorIds) {
    const flags = flagsByActor[actorId]
    console.log(`${actorId} -> disabledSkills=${flags.disabledSkills.join(',')}`)
  }

  const state = await manager.getState()
  console.log('\nState saved to:', statePath)
  console.log('UpdatedAt:', state.updatedAt)
}

main().catch(error => {
  console.error('Rollout manager demo failed.')
  console.error(error)
  process.exitCode = 1
})
