# LI.FI Earn + Quote Preview Prototype

A small, dependency-free LI.FI prototype for hackathon delivery.

This project now includes:

- Composer client (`https://li.quest/v1`) for quote and status
- Earn client (`https://earn.li.fi`) for vault/chains/protocols/portfolio
- Cursor pagination helpers (`nextCursor`)
- Multi-command CLI:
  - `vaults list`
  - `vaults select`
  - `quote preview`
  - `portfolio summary`
  - `portfolio to-quote`
- Demo flow: pick vault -> call quote -> render route preview
- Submission templates (tweet, write-up, checklist)

## Project Structure

- `src/lifi-client.js`
  - LI.FI Composer client
  - `GET /quote`
  - `GET /status`
- `src/earn-client.js`
  - LI.FI Earn client
  - `GET /v1/earn/vaults`
  - `GET /v1/earn/vaults/{network}/{address}`
  - `GET /v1/earn/chains`
  - `GET /v1/earn/protocols`
  - `GET /v1/earn/portfolio/{userAddress}/positions`
  - all-pages pagination helpers (`getAllVaults`, `getAllPortfolioPositions`)
- `src/route-preview.js`
  - quote summarization and risk hints
- `src/status-preview.js`
  - status summarization
- `examples/preview-route.mjs`
  - quote preview demo
- `examples/preview-status.mjs`
  - status preview demo
- `examples/earn-vault-to-quote-preview.mjs`
  - backward-compatible wrapper for quote preview
- `examples/lifi-earn-cli.mjs`
  - multi-command CLI entrypoint
- `submission/tweet-draft.md`
  - tweet draft template
- `submission/writeup-template.md`
  - write-up template
- `submission/checklist.md`
  - final submission checklist

## Quick Start

Requires Node.js 18+ (native `fetch`).

```powershell
cd F:\src\lifi-feature
```

Route preview:

```powershell
$env:LI_FI_API_KEY="your_api_key"
npm.cmd run preview:route
```

Status preview:

```powershell
$env:LI_FI_API_KEY="your_api_key"
$env:LI_FI_TX_HASH="0x..."
npm.cmd run preview:status
```

Real execution verification (for submission evidence):

```powershell
$env:LI_FI_TX_HASH="0x..."
$env:LI_FI_FROM_CHAIN="42161"
$env:LI_FI_TO_CHAIN="8453"
$env:LI_FI_BRIDGE="across"
$env:LI_FI_REQUIRE_TERMINAL_STATUS="true"
npm.cmd run verify:execution
```

Earn vault -> quote preview:

```powershell
$env:LI_FI_API_KEY="your_api_key"
$env:LI_FI_FROM_CHAIN="1"
$env:LI_FI_FROM_TOKEN="USDC"
$env:LI_FI_FROM_AMOUNT="1000000"
$env:LI_FI_FROM_ADDRESS="0x1111111111111111111111111111111111111111"
npm.cmd run preview:earn-quote
```

CLI examples:

```powershell
npm.cmd run preview:earn-quote -- --help
npm.cmd run preview:earn-quote -- --protocol aave-v3 --sort-by tvl --top-n 5
npm.cmd run preview:earn-quote -- --vault-address 0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8 --json --quiet
```

Multi-command CLI examples:

```powershell
npm.cmd run lifi:cli -- --help
npm.cmd run lifi:cli -- vaults list --chain 1 --top-n 5
npm.cmd run lifi:cli -- vaults select --chain 1 --protocol aave-v3 --rank 1 --json
npm.cmd run lifi:cli -- quote preview --from-chain 1 --from-token USDC --from-amount 1000000
npm.cmd run lifi:cli -- portfolio summary --address 0x1111111111111111111111111111111111111111 --json
npm.cmd run lifi:cli -- portfolio to-quote --address 0x1111111111111111111111111111111111111111 --to-vault-rank 1 --json
npm.cmd run lifi:cli -- quote preview --from-chain 1 --from-token USDC --from-amount 1000000 --out .\\artifacts\\quote-preview.txt
npm.cmd run lifi:cli -- vaults list --chain 1 --json --out .\\artifacts\\vaults.json
```

## Environment Variables

Composer:

- `LI_FI_API_KEY` (optional but recommended)
- `LI_FI_INTEGRATOR` (optional)
- `LI_FI_BASE_URL` (default: `https://li.quest/v1`)
- `LI_FI_REQUIRE_TERMINAL_STATUS` (`true|false`, default: `false`, used by `verify:execution`)
- `LI_FI_EVIDENCE_OUTPUT` (optional custom output path for verification JSON)

Earn:

- `LI_FI_EARN_BASE_URL` (default: `https://earn.li.fi`)
- `EARN_VAULT_MAX_PAGES` (default: `3`)
- `EARN_VAULT_PAGE_LIMIT` (default: `100`)
- `EARN_VAULT_TOP_N` (default: `3`)
- `EARN_VAULT_SORT_BY` (`apy` or `tvl`, default: `apy`)
- `EARN_VAULT_PROTOCOL` (optional protocol filter)
- `EARN_VAULT_ADDRESS` (optional exact vault override)
- `EARN_REQUIRE_TRANSACTIONAL` (default: `true`)
- `EARN_REQUIRE_REDEEMABLE` (default: `false`)
- `EARN_VAULT_RANK` (default: `1`)
- `LI_FI_PORTFOLIO_ADDRESS` (for `portfolio summary`)
- `LI_FI_PORTFOLIO_CHAIN` (optional chain filter for portfolio)
- `LI_FI_PORTFOLIO_PROTOCOL` (optional protocol filter for portfolio)
- `LI_FI_POSITION_RANK` (for `portfolio to-quote`, default `1`)
- `LI_FI_POSITION_VAULT` (force source position vault for `portfolio to-quote`)
- `LI_FI_TO_VAULT_ADDRESS` (force target vault for `portfolio to-quote`)
- `LI_FI_TO_VAULT_RANK` (target vault rank, default `1`)

Flow input:

- `LI_FI_FROM_CHAIN` (default: `1`)
- `LI_FI_FROM_TOKEN` (default: `USDC`)
- `LI_FI_FROM_AMOUNT` (default: `1000000`)
- `LI_FI_FROM_ADDRESS` (default placeholder address)
- `LI_FI_SLIPPAGE` (default: `0.003`)

## Notes

- For vault deposit flows, set `toToken` to the vault address.
- `APY` can be missing (`null`) and `TVL` may be a string.
- Earn pagination is cursor-based (`nextCursor`).

## Hackathon Submission Files

- Tweet draft: `submission/tweet-draft.md`
- Write-up template: `submission/writeup-template.md`
- Submission checklist: `submission/checklist.md`
