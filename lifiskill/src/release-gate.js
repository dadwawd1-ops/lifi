const DEFAULT_THRESHOLDS = {
  minTestPassRate: 1,
  requireZeroP0: true,
  requireZeroP1: true,
  minSkillE2ECoverage: 1,
  minConfirmationCoverage: 1,
  minSuccessRate7d: 0.97,
  maxStatusTimeoutRate7d: 0.01,
  maxP95CompletionMinutes7d: 8,
  minAuditCoverage: 1,
  minFallbackCoverage: 1,
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeRate(value) {
  const n = toFiniteNumber(value, 0)
  if (n > 1) {
    return n / 100
  }
  if (n < 0) {
    return 0
  }
  return n
}

function addCheck(checks, input) {
  checks.push({
    id: input.id,
    label: input.label,
    pass: Boolean(input.pass),
    actual: input.actual,
    expected: input.expected,
  })
}

export function evaluateReleaseGate(metrics = {}, thresholdOverride = {}) {
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholdOverride,
  }

  const tests = metrics.tests ?? {}
  const quality = metrics.quality ?? {}
  const skills = metrics.skills ?? {}
  const slos = metrics.slos ?? {}

  const checks = []

  const testTotal = Math.max(0, Math.floor(toFiniteNumber(tests.total, 0)))
  const testFailed = Math.max(0, Math.floor(toFiniteNumber(tests.failed, 0)))
  const testPassRate =
    testTotal > 0 ? (testTotal - testFailed) / testTotal : 0
  addCheck(checks, {
    id: 'test-pass-rate',
    label: 'Automated tests pass rate',
    pass: testPassRate >= normalizeRate(thresholds.minTestPassRate),
    actual: testPassRate,
    expected: `>= ${normalizeRate(thresholds.minTestPassRate)}`,
  })

  const p0Count = Math.max(0, Math.floor(toFiniteNumber(quality.p0Count, 0)))
  addCheck(checks, {
    id: 'zero-p0',
    label: 'No P0 defects',
    pass: thresholds.requireZeroP0 ? p0Count === 0 : true,
    actual: p0Count,
    expected: thresholds.requireZeroP0 ? 0 : 'not_enforced',
  })

  const p1Count = Math.max(0, Math.floor(toFiniteNumber(quality.p1Count, 0)))
  addCheck(checks, {
    id: 'zero-p1',
    label: 'No P1 defects',
    pass: thresholds.requireZeroP1 ? p1Count === 0 : true,
    actual: p1Count,
    expected: thresholds.requireZeroP1 ? 0 : 'not_enforced',
  })

  const requiredSkillChecks = [
    Boolean(skills.bridgeAssetsE2E),
    Boolean(skills.swapThenBridgeE2E),
    Boolean(skills.safeLargeTransferReviewE2E),
  ]
  const skillCoverage =
    requiredSkillChecks.filter(Boolean).length / requiredSkillChecks.length
  addCheck(checks, {
    id: 'skill-e2e-coverage',
    label: 'Core skill E2E coverage',
    pass:
      skillCoverage >= normalizeRate(thresholds.minSkillE2ECoverage),
    actual: skillCoverage,
    expected: `>= ${normalizeRate(thresholds.minSkillE2ECoverage)}`,
  })

  const confirmationCoverage = normalizeRate(quality.confirmationCoverage ?? 0)
  addCheck(checks, {
    id: 'confirmation-coverage',
    label: 'Pre-execution confirmation coverage',
    pass:
      confirmationCoverage >=
      normalizeRate(thresholds.minConfirmationCoverage),
    actual: confirmationCoverage,
    expected: `>= ${normalizeRate(thresholds.minConfirmationCoverage)}`,
  })

  const successRate7d = normalizeRate(slos.successRate7d ?? slos.successRate)
  addCheck(checks, {
    id: 'success-rate-7d',
    label: '7-day success rate',
    pass: successRate7d >= normalizeRate(thresholds.minSuccessRate7d),
    actual: successRate7d,
    expected: `>= ${normalizeRate(thresholds.minSuccessRate7d)}`,
  })

  const timeoutRate7d = normalizeRate(
    slos.statusTimeoutRate7d ?? slos.statusTimeoutRate,
  )
  addCheck(checks, {
    id: 'status-timeout-rate-7d',
    label: '7-day status timeout rate',
    pass:
      timeoutRate7d <= normalizeRate(thresholds.maxStatusTimeoutRate7d),
    actual: timeoutRate7d,
    expected: `<= ${normalizeRate(thresholds.maxStatusTimeoutRate7d)}`,
  })

  const p95CompletionMinutes = toFiniteNumber(
    slos.p95CompletionMinutes7d ?? slos.p95CompletionMinutes,
    Number.POSITIVE_INFINITY,
  )
  addCheck(checks, {
    id: 'p95-completion-minutes-7d',
    label: '7-day P95 completion time (minutes)',
    pass:
      p95CompletionMinutes <=
      toFiniteNumber(thresholds.maxP95CompletionMinutes7d, 8),
    actual: p95CompletionMinutes,
    expected: `<= ${toFiniteNumber(thresholds.maxP95CompletionMinutes7d, 8)}`,
  })

  const auditCoverage = normalizeRate(quality.auditCoverage ?? 0)
  addCheck(checks, {
    id: 'audit-coverage',
    label: 'Audit field completeness coverage',
    pass: auditCoverage >= normalizeRate(thresholds.minAuditCoverage),
    actual: auditCoverage,
    expected: `>= ${normalizeRate(thresholds.minAuditCoverage)}`,
  })

  const fallbackCoverage = normalizeRate(quality.fallbackCoverage ?? 0)
  addCheck(checks, {
    id: 'fallback-coverage',
    label: 'Fallback coverage for key errors',
    pass: fallbackCoverage >= normalizeRate(thresholds.minFallbackCoverage),
    actual: fallbackCoverage,
    expected: `>= ${normalizeRate(thresholds.minFallbackCoverage)}`,
  })

  const failedChecks = checks.filter(check => !check.pass)
  const pass = failedChecks.length === 0
  const passedCount = checks.length - failedChecks.length

  return {
    pass,
    thresholds,
    summary: pass
      ? `Release gate passed (${passedCount}/${checks.length})`
      : `Release gate failed (${passedCount}/${checks.length})`,
    checks,
    failedChecks,
  }
}

export function assertReleaseGate(metrics = {}, thresholdOverride = {}) {
  const result = evaluateReleaseGate(metrics, thresholdOverride)
  if (result.pass) {
    return result
  }

  const failedIds = result.failedChecks.map(check => check.id).join(', ')
  const err = new Error(`Release gate failed: ${failedIds}`)
  err.code = 'RELEASE_GATE_FAILED'
  err.result = result
  throw err
}
