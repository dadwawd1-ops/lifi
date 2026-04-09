import {
  LiFiClient,
  summarizeStatus,
  formatStatusPreview,
} from '../src/index.js'

async function main() {
  const txHash = process.env.LI_FI_TX_HASH
  if (!txHash) {
    throw new Error(
      'Please set LI_FI_TX_HASH before running the status preview example.',
    )
  }

  const client = new LiFiClient({
    apiKey: process.env.LI_FI_API_KEY,
    integrator: process.env.LI_FI_INTEGRATOR ?? 'lifi-feature-demo',
  })

  const status = await client.getStatus({
    txHash,
    fromChain: process.env.LI_FI_FROM_CHAIN,
    toChain: process.env.LI_FI_TO_CHAIN,
    bridge: process.env.LI_FI_BRIDGE,
  })

  const summary = summarizeStatus(status)
  console.log(formatStatusPreview(summary))
}

main().catch(error => {
  console.error('Failed to preview LI.FI transfer status.')
  console.error(error)
  process.exitCode = 1
})
