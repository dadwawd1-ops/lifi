# Real Execution Evidence

Use this file to make "real execution" auditable inside the repo.

## 1) Evidence Inputs

- Date (UTC+8): `[YYYY-MM-DD HH:mm]`
- Wallet address used for execution: `[0x...]`
- Source chain: `[chain id]`
- Destination chain: `[chain id]`
- Bridge / route id (if available): `[value]`
- Tx hash: `[0x...]`
- Demo/video link: `[url]`

## 2) Verification Command

Run from `F:\src\lifi-feature`:

```powershell
$env:LI_FI_TX_HASH="0x..."
$env:LI_FI_FROM_CHAIN="42161"
$env:LI_FI_TO_CHAIN="8453"
$env:LI_FI_BRIDGE="across"
$env:LI_FI_REQUIRE_TERMINAL_STATUS="true"
npm.cmd run verify:execution
```

Expected output file:

- `submission/real-execution-verification.json`

## 3) Acceptance Criteria

- `real-execution-verification.json` exists in repo.
- JSON has:
  - `"ok": true`
  - terminal status when required (`DONE` or `FAILED`)
  - same tx hash as this document
- This markdown is filled with matching metadata and video link.

## 4) Auditor Notes

- If status is pending/non-terminal, rerun later with the same tx hash.
- If verification fails, keep failure JSON for traceability and fix env/query.
