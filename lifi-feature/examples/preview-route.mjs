import {
  LiFiClient,
  summarizeQuote,
  formatQuotePreview,
} from '../src/index.js'

async function main() {
  const client = new LiFiClient({
    apiKey: process.env.LI_FI_API_KEY,
    integrator: process.env.LI_FI_INTEGRATOR ?? 'lifi-feature-demo',
  })

  const quote = await client.getQuote({
    fromChain: 42161,
    toChain: 8453,
    fromToken: 'USDC',
    toToken: 'USDC',
    fromAmount: '1000000',
    fromAddress: '0x1111111111111111111111111111111111111111',
    slippage: 0.003,
  })

  const summary = summarizeQuote(quote)
  console.log(formatQuotePreview(summary))
}

main().catch(error => {
  console.error('Failed to preview LI.FI route.')
  console.error(error)
  process.exitCode = 1
})
