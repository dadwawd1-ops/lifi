# Real Execution Evidence

Status: pending user-signed transaction.

This file is the audit record for a real ETH -> Polygon execution. It is not marked complete yet because the repository does not contain a wallet signer, private key, WalletConnect session, or production broadcaster. The root `run-skill.mjs --execute` path can build the real LI.FI transaction request, but it does not broadcast an on-chain transaction by itself.

Do not replace the pending fields below unless the transaction was actually signed by the wallet owner and broadcast on-chain.

## 1) Transaction Summary

- Execution status: `PENDING_REAL_TRANSACTION`
- Date (UTC+8): `PENDING`
- Wallet address used for execution: `PENDING`
- Source chain: Ethereum mainnet (`1`)
- Destination chain: Polygon (`137`)
- Asset: `ETH`
- Amount: `PENDING_SMALL_AMOUNT`
- Bridge / route id: `PENDING`
- Source tx hash: `PENDING`
- Destination tx hash: `PENDING`
- Demo/video link: `PENDING`

## 2) Required Artifact Files

The following files must be saved after the real transaction is signed and broadcast:

- Route response JSON: `lifi-feature/submission/real-execution-route-response.json`
- Status response JSON: `lifi-feature/submission/real-execution-status-response.json`
- CLI output screenshot: `lifi-feature/submission/screenshots/01-run-skill-cli-output.png`
- Wallet confirmation screenshot: `lifi-feature/submission/screenshots/02-wallet-confirmation.png`
- Explorer status screenshot: `lifi-feature/submission/screenshots/03-explorer-status.png`

Current artifact state:

- Route response JSON: `PENDING`
- Status response JSON: `PENDING`
- Screenshots: `PENDING`

## 3) Explorer Links

Fill these with real links after the tx hash is known:

- Ethereum source transaction: `https://etherscan.io/tx/PENDING_TX_HASH`
- Polygon destination transaction: `https://polygonscan.com/tx/PENDING_DESTINATION_TX_HASH`
- LI.FI explorer link: `PENDING`

## 4) Execution Steps

1. Generate the LI.FI route and inspect the plan.

```powershell
node .\run-skill.mjs bridge-assets `
  --fromChain 1 `
  --toChain 137 `
  --token ETH `
  --amount PENDING_SMALL_RAW_WEI_AMOUNT `
  --fromAddress 0xYourWallet `
  --receiver 0xYourWallet `
  --plan-only `
  --routeOut .\lifi-feature\submission\real-execution-route-response.json
```

Expected result:

- The CLI prints step-by-step runtime logs.
- The CLI prints a route preview.
- `real-execution-route-response.json` contains the raw LI.FI route/quote response.
- This step does not move funds.

2. Sign and broadcast the transaction with a user-controlled wallet or production broadcaster.

The repository cannot do this step by itself. A real execution requires the wallet owner to review the route, confirm the transaction, and broadcast it on-chain. Keep a screenshot of the wallet confirmation UI at:

```text
lifi-feature/submission/screenshots/02-wallet-confirmation.png
```

3. Verify the transaction status and save the status JSON.

After the source transaction hash is available:

```powershell
node .\run-skill.mjs bridge-assets `
  --fromChain 1 `
  --toChain 137 `
  --token ETH `
  --amount PENDING_SMALL_RAW_WEI_AMOUNT `
  --fromAddress 0xYourWallet `
  --receiver 0xYourWallet `
  --execute `
  --txHash 0xRealSourceTxHash `
  --routeOut .\lifi-feature\submission\real-execution-route-response.json `
  --statusOut .\lifi-feature\submission\real-execution-status-response.json
```

Expected result:

- `real-execution-status-response.json` contains the raw LI.FI status response.
- The CLI prints route preview and execution/status information.
- Save a screenshot of this CLI output at `lifi-feature/submission/screenshots/01-run-skill-cli-output.png`.

4. Cross-check explorer links.

Use the source hash and any destination hash from the LI.FI status response:

- Ethereum source tx: `https://etherscan.io/tx/0xRealSourceTxHash`
- Polygon destination tx: `https://polygonscan.com/tx/0xRealDestinationTxHash`

Save an explorer screenshot at:

```text
lifi-feature/submission/screenshots/03-explorer-status.png
```

5. Replace the pending fields in this file.

The evidence is complete only when:

- The source tx hash is real and present in this markdown.
- `real-execution-route-response.json` exists and matches the submitted route.
- `real-execution-status-response.json` exists and contains the real LI.FI status response.
- Explorer links resolve to real transaction pages.
- Screenshots exist at the paths listed above.

## 5) Current Auditor Note

As of this repository state, no real ETH -> Polygon transaction has been executed by Codex. The existing `lifi-feature/submission/real-execution-verification.json` is not accepted as proof because it contains the placeholder hash `0x你的真实交易哈希` and records a failed LI.FI status lookup.
