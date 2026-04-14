import { Interface } from 'ethers'
import { sendTransaction } from './signer.js'

const ERC20_INTERFACE = new Interface([
  'function approve(address,uint256) returns (bool)',
])
const ERC4626_INTERFACE = new Interface([
  'function deposit(uint256,address) returns (uint256)',
])

function ensureValue(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${label} is required for vault deposit`)
  }
  return value
}

export async function depositToVault({
  chainId,
  vaultAddress,
  tokenAddress,
  amount,
  receiverAddress,
  sendTransactionImpl = sendTransaction,
}) {
  ensureValue(chainId, 'chainId')
  ensureValue(vaultAddress, 'vaultAddress')
  ensureValue(tokenAddress, 'tokenAddress')
  ensureValue(amount, 'amount')
  ensureValue(receiverAddress, 'receiverAddress')

  console.log('DEPOSIT WALLET:', receiverAddress)

  let approveMeta = null
  const approveTxRequest = {
    to: tokenAddress,
    data: ERC20_INTERFACE.encodeFunctionData('approve', [vaultAddress, amount]),
    value: 0n,
  }
  const approveTxHash = await sendTransactionImpl(approveTxRequest, {
    chainId,
    onResult(meta) {
      approveMeta = meta
    },
  })
  console.log('✅ Approved')

  let depositMeta = null
  const depositTxRequest = {
    to: vaultAddress,
    data: ERC4626_INTERFACE.encodeFunctionData('deposit', [
      amount,
      receiverAddress,
    ]),
    value: 0n,
  }

  try {
    const depositTxHash = await sendTransactionImpl(depositTxRequest, {
      chainId,
      onResult(meta) {
        depositMeta = meta
      },
    })
    console.log('📥 Depositing to vault:', depositTxHash)
    console.log('🔥 Deposit confirmed')

    return {
      approveTxHash,
      txHash: depositTxHash,
      depositTxHash,
      approve: approveMeta,
      deposit: depositMeta,
    }
  } catch (error) {
    error.approveTxHash ??= approveTxHash
    error.approveMeta ??= approveMeta
    error.depositMeta ??= depositMeta
    throw error
  }
}
