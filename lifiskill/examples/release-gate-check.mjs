import { evaluateReleaseGate, assertReleaseGate } from '../src/index.js'

function sampleMetrics() {
  return {
    tests: {
      total: 22,
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
      statusTimeoutRate7d: 0.004,
      p95CompletionMinutes7d: 6.5,
    },
  }
}

function printReport(result) {
  console.log(result.summary)
  for (const check of result.checks) {
    const icon = check.pass ? 'PASS' : 'FAIL'
    console.log(`${icon} ${check.id}: actual=${check.actual} expected=${check.expected}`)
  }
}

async function main() {
  const metrics = sampleMetrics()
  const result = evaluateReleaseGate(metrics)
  printReport(result)

  try {
    assertReleaseGate(metrics)
    console.log('\nRelease gate assertion passed.')
  } catch (error) {
    console.error('\nRelease gate assertion failed.')
    console.error(error?.message ?? error)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error('Release gate check failed unexpectedly.')
  console.error(error)
  process.exitCode = 1
})
