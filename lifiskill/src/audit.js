function maskAddress(value) {
  if (typeof value !== 'string' || value.length < 12) {
    return value ?? null
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function createAudit({
  skillId,
  operationId = null,
  traceId = null,
  walletAddress = null,
  receiver = null,
}) {
  return {
    traceId,
    operationId,
    skillId,
    walletAddress: maskAddress(walletAddress),
    receiver: maskAddress(receiver),
    routeId: null,
    quoteId: null,
    routeFingerprint: null,
    decision: null,
    decisionReason: null,
    approval: null,
    txHash: null,
    statusTransitions: [],
    errorCode: null,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    events: [],
  }
}

export function pushAuditEvent(audit, state, detail) {
  const event = {
    at: new Date().toISOString(),
    state,
    detail,
  }
  audit.events.push(event)
  audit.statusTransitions.push({
    state,
    at: event.at,
  })
}

export function finalizeAudit(audit, endState, error = null) {
  audit.endedAt = new Date().toISOString()
  audit.durationMs =
    new Date(audit.endedAt).getTime() - new Date(audit.startedAt).getTime()
  if (error) {
    audit.errorCode = error.code ?? 'WORKFLOW_ERROR'
    audit.errorMessage = error.message ?? String(error)
  }
  audit.finalState = endState
  return audit
}

