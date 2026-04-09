function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

export function needsApproval({ allowance, requiredAmount }) {
  const allowanceNum = BigInt(String(allowance ?? '0'))
  const requiredNum = BigInt(String(requiredAmount ?? '0'))
  return allowanceNum < requiredNum
}

export async function ensureApproval(params) {
  const {
    tokenAddress,
    ownerAddress,
    spenderAddress,
    requiredAmount,
    approvalProvider,
  } = params

  if (!approvalProvider || typeof approvalProvider.getAllowance !== 'function') {
    throw new Error('approvalProvider.getAllowance is required')
  }

  const allowance = await approvalProvider.getAllowance({
    tokenAddress,
    ownerAddress,
    spenderAddress,
  })

  if (!needsApproval({ allowance, requiredAmount })) {
    return {
      required: false,
      method: 'none',
      allowance,
      spenderAddress: normalizeAddress(spenderAddress),
    }
  }

  if (typeof approvalProvider.tryPermit === 'function') {
    const permitResult = await approvalProvider.tryPermit({
      tokenAddress,
      ownerAddress,
      spenderAddress,
      requiredAmount,
    })
    if (permitResult?.ok) {
      return {
        required: true,
        method: 'permit',
        allowanceAfter: permitResult.allowanceAfter ?? requiredAmount,
        spenderAddress: normalizeAddress(spenderAddress),
      }
    }
  }

  if (typeof approvalProvider.approve !== 'function') {
    throw new Error('approval required but approvalProvider.approve is missing')
  }

  const approveResult = await approvalProvider.approve({
    tokenAddress,
    ownerAddress,
    spenderAddress,
    requiredAmount,
  })

  if (!approveResult?.ok) {
    throw new Error('approve failed')
  }

  return {
    required: true,
    method: 'approve',
    txHash: approveResult.txHash ?? null,
    allowanceAfter: approveResult.allowanceAfter ?? requiredAmount,
    spenderAddress: normalizeAddress(spenderAddress),
  }
}
