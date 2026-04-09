import { runCli } from './lifi-earn-cli.mjs'

const GROUPS = new Set(['vaults', 'quote', 'portfolio', 'help'])

function isKnownPair(first, second) {
  if (!GROUPS.has(first)) {
    return false
  }
  if (first === 'help') {
    return true
  }
  if (first === 'vaults' && ['list', 'select'].includes(second)) {
    return true
  }
  if (first === 'quote' && ['preview'].includes(second)) {
    return true
  }
  if (first === 'portfolio' && ['summary', 'positions'].includes(second)) {
    return true
  }
  return false
}

function normalizeLegacyArgs(argv) {
  const first = argv[0]
  const second = argv[1]
  if (isKnownPair(first, second)) {
    return argv
  }

  return ['quote', 'preview', ...argv]
}

runCli(normalizeLegacyArgs(process.argv.slice(2))).catch(error => {
  console.error('Failed to run Earn vault -> quote preview flow.')
  console.error(error)
  process.exitCode = 1
})
