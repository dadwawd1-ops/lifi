import { LiFiQuoteTool } from '../src/index.js'

async function main() {
  const tool = new LiFiQuoteTool({
    clientOptions: {
      apiKey: process.env.LI_FI_API_KEY,
      integrator: process.env.LI_FI_INTEGRATOR ?? 'lifiskill-demo',
    },
  })

  const result = await tool.run({
    fromChain: 42161,
    toChain: 8453,
    fromToken: 'USDC',
    toToken: 'USDC',
    fromAmount: '1000000',
    fromAddress: '0x1111111111111111111111111111111111111111',
    slippage: 0.003,
  })

  console.log(result.text)
}

main().catch(error => {
  console.error('Quote preview failed.')
  console.error(error)
  process.exitCode = 1
})
