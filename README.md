# LI.FI Hackathon Combined Submission

This repository contains two runnable modules and one root convenience CLI:

- `lifi-feature`: the user-facing LI.FI Earn + Composer quote preview CLI.
- `lifiskill`: the runtime, safety, workflow, release-gate, and gray-release layer.
- `run-skill.mjs`: a unified root CLI that calls `lifiskill` runtime with `lifi-feature`'s LI.FI client.

Root-level TypeScript files from the previous active workspace were removed because they depended on missing external project files and are not part of this submission.
There is no root `package.json`; install and run commands from `lifi-feature/` or `lifiskill/`, or use the root `run-skill.mjs` CLI directly.

## Repository Structure

```text
.
|-- lifi-feature/
|   |-- src/
|   |-- examples/
|   |-- submission/
|   |-- artifacts/
|   `-- README.md
|-- lifiskill/
|   |-- src/
|   |-- examples/
|   |-- skills/
|   |-- tests/
|   `-- README.md
|-- config.json
|-- run-skill.mjs
`-- README.md
```

## Entry Points

### Unified CLI

Use this root CLI to run a selected `lifiskill` workflow while using `lifi-feature`'s LI.FI client for quote/status calls.

```powershell
node .\run-skill.mjs bridge-assets --fromChain 1 --toChain 137 --amount 10000000000000000 --plan-only
node .\run-skill.mjs bridge-assets --fromChain 1 --toChain 137 --token USDC --amount 1000000 --execute
node .\run-skill.mjs swap-then-bridge --fromChain 1 --toChain 137 --fromToken USDC --toToken USDT --amount 1000000 --plan-only
node .\run-skill.mjs batch-run .\config.json --execute
```

Modes:

- `--plan-only` previews the route and blocks execution through `quoteOnly`.
- `--execute` runs the workflow execution branch and enables vault deposit after route completion when a selected vault + signer are available.
- `batch-run` reads a JSON array of tasks and executes them sequentially through the same runtime.

### `lifi-feature`

Use this module for the main hackathon demo: vault discovery, vault selection, quote preview, portfolio summary, and execution verification.

```powershell
cd .\lifi-feature
npm install
npm run lifi:cli -- --help
```

Main commands:

```powershell
npm run lifi:cli -- vaults list --chain 1 --top-n 5
npm run lifi:cli -- vaults select --chain 1 --protocol aave-v3 --rank 1 --json
npm run lifi:cli -- quote preview --from-chain 1 --from-token USDC --from-amount 1000000
npm run lifi:cli -- portfolio summary --address 0x1111111111111111111111111111111111111111 --json
npm run lifi:cli -- portfolio to-quote --address 0x1111111111111111111111111111111111111111 --to-vault-rank 1 --json
```

Execution verification:

```powershell
cd .\lifi-feature
$env:LI_FI_TX_HASH="0x..."
$env:LI_FI_FROM_CHAIN="42161"
$env:LI_FI_TO_CHAIN="8453"
$env:LI_FI_BRIDGE="across"
$env:LI_FI_REQUIRE_TERMINAL_STATUS="true"
npm run verify:execution
```

### `lifiskill`

Use this module for the engineering appendix: skill validation, workflow runtime, policy checks, approvals, idempotency, status polling, release gates, gray release, rollout management, and HTTP runtime integration.

```powershell
cd .\lifiskill
npm install
npm test
```

Runtime demos:

```powershell
npm run demo:workflow-runtime
npm run demo:gray-release
npm run demo:rollout-manager
npm run serve:runtime
```

The runtime server returns top-level `logs`, `txHash`, `depositTxHash`, and `state` from `POST /run-skill`, so it can be called from scripts or any external client.

## RPC Reliability

Ethereum (`chainId=1`) and Polygon (`chainId=137`) writes now share the same signer pipeline:

- `RPC_URL` / `RPC_URL_137` stay as the preferred primary RPCs.
- Public fallback RPCs are used when nonce fetch, transaction population, or raw transaction broadcast hits rate limits or temporary node failures.
- Vault `approve` + `deposit` reuse the same send path as route execution, so yield deposits no longer depend on a separate single-node wallet connection.
- A transaction is treated as successful only after it becomes visible on-chain or a mined receipt is observed; `TX SENT` alone is not treated as final success.

## Submission Materials

Submission files are under `lifi-feature/submission/`:

- `tweet-draft.md`
- `writeup-template.md`
- `checklist.md`
- `REAL_EXECUTION_EVIDENCE.md`
- `COMBINED_AUDIT_REPORT_2026-04-08.md`
