# LI.FI Hackathon Combined Submission

This repository is a combined submission workspace for:

- `lifi-feature`: user-facing DeFi Earn + Quote preview CLI flow
- `lifiskill`: runtime, safety, and workflow orchestration layer

The intent is to present one coherent submission story:

1. Discover Earn opportunities (`vaults/chains/protocols/portfolio`)
2. Select a vault and preview a route quote
3. Validate execution evidence and provide submission artifacts
4. Demonstrate runtime governance and safety extensions

## Repository Structure

```text
.
|-- lifi-feature/
|   |-- src/
|   |-- examples/
|   |-- submission/
|   `-- README.md
|-- lifiskill/
|   |-- src/
|   |-- examples/
|   |-- tests/
|   `-- README.md
`-- README.md
```

## Quick Start

Prerequisites:

- Node.js 18+
- npm

Install dependencies:

```powershell
cd F:\src\lifi-feature
npm install

cd F:\src\lifiskill
npm install
```

## Main Demo (lifi-feature)

CLI entrypoint:

```powershell
node .\examples\lifi-earn-cli.mjs --help
```

Core commands:

```powershell
# Vault discovery
node .\examples\lifi-earn-cli.mjs vaults list --chain 8453 --limit 20

# Select a specific vault
node .\examples\lifi-earn-cli.mjs vaults select --chain 8453 --vault 0xYourVaultAddress

# Quote preview to selected vault
node .\examples\lifi-earn-cli.mjs quote preview --fromChain 42161 --toChain 8453 --toToken 0xVaultAddress --fromAmount 1000000

# Portfolio summary
node .\examples\lifi-earn-cli.mjs portfolio summary --user 0xYourWallet

# Portfolio position -> quote preview
node .\examples\lifi-earn-cli.mjs portfolio to-quote --user 0xYourWallet --toVault 0xVaultAddress --toChain 8453
```

Execution verification:

```powershell
cd F:\src\lifi-feature
$env:LI_FI_TX_HASH="0x..."
$env:LI_FI_FROM_CHAIN="42161"
$env:LI_FI_TO_CHAIN="8453"
$env:LI_FI_BRIDGE="across"
$env:LI_FI_REQUIRE_TERMINAL_STATUS="true"
npm run verify:execution
```

## Runtime / Safety Layer (lifiskill)

Run tests:

```powershell
cd F:\src\lifiskill
npm test
```

Example runtime demos:

```powershell
node .\examples\runtime-server-start.mjs
node .\examples\workflow-runtime-run.mjs
node .\examples\gray-release-rollout.mjs
```

## Submission Materials

Located under:

- `lifi-feature/submission/tweet-draft.md`
- `lifi-feature/submission/writeup-template.md`
- `lifi-feature/submission/checklist.md`
- `lifi-feature/submission/REAL_EXECUTION_EVIDENCE.md`
- `lifi-feature/submission/COMBINED_AUDIT_REPORT_2026-04-08.md`

## Notes

- Root-level TypeScript files are preserved from the active workspace.
- Main hackathon presentation path should prioritize `lifi-feature`.
- `lifiskill` is recommended as engineering appendix and risk-control enhancement in the final write-up.
