export const ErrorCode = {
  POLICY_DENY: 'POLICY_DENY',
  SIGN_REJECTED: 'SIGN_REJECTED',
  SIGN_FAILED: 'SIGN_FAILED',
  APPROVAL_FAILED: 'APPROVAL_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  QUOTE_DEGRADED_PLAN_ONLY: 'QUOTE_DEGRADED_PLAN_ONLY',
  STATUS_FETCH_FAILED: 'STATUS_FETCH_FAILED',
  STATUS_TIMEOUT: 'STATUS_TIMEOUT',
  LIFI_API_ERROR: 'LIFI_API_ERROR',
  WORKFLOW_ERROR: 'WORKFLOW_ERROR',
  EXECUTION_BLOCKED_QUOTE_ONLY: 'EXECUTION_BLOCKED_QUOTE_ONLY',
  SKILL_DISABLED: 'SKILL_DISABLED',
}

export function classifyError(error) {
  const code = error?.code
  if (code && Object.values(ErrorCode).includes(code)) {
    return {
      code,
      message: error.message ?? code,
      severity: severityFromCode(code),
      retryable: retryableFromCode(code),
    }
  }

  const msg = String(error?.message ?? '')
  if (error?.name === 'LiFiApiError' || /LI\.FI request failed/i.test(msg)) {
    return {
      code: ErrorCode.LIFI_API_ERROR,
      message: msg || 'LI.FI API request failed',
      severity: 'high',
      retryable: true,
    }
  }

  if (/input|parameter|address/i.test(msg)) {
    return {
      code: ErrorCode.INVALID_INPUT,
      message: msg || 'Invalid workflow input',
      severity: 'low',
      retryable: false,
    }
  }

  if (/timeout/i.test(msg)) {
    return {
      code: ErrorCode.STATUS_TIMEOUT,
      message: msg,
      severity: 'high',
      retryable: true,
    }
  }

  if (/deny|forbidden|blocked/i.test(msg)) {
    return {
      code: ErrorCode.POLICY_DENY,
      message: msg,
      severity: 'medium',
      retryable: false,
    }
  }

  return {
    code: ErrorCode.WORKFLOW_ERROR,
    message: msg || 'Unknown workflow error',
    severity: 'medium',
    retryable: false,
  }
}

function severityFromCode(code) {
  if (
    code === ErrorCode.SIGN_FAILED ||
    code === ErrorCode.STATUS_TIMEOUT ||
    code === ErrorCode.LIFI_API_ERROR
  ) {
    return 'high'
  }
  if (code === ErrorCode.POLICY_DENY || code === ErrorCode.SKILL_DISABLED) {
    return 'low'
  }
  return 'medium'
}

function retryableFromCode(code) {
  return (
    code === ErrorCode.STATUS_TIMEOUT ||
    code === ErrorCode.LIFI_API_ERROR ||
    code === ErrorCode.SIGN_FAILED ||
    code === ErrorCode.STATUS_FETCH_FAILED
  )
}
