# UI App Demo

## 30-Second Browser Demo

1. Open `http://127.0.0.1:5173/` in your browser.
2. In `Runtime Config`, fill:
   - `Runtime Base URL`: `http://127.0.0.1:8787`
   - `Mode`: `plan-only`
   - `Global Wallet Address`: `0x1111111111111111111111111111111111111111`
3. Click `Ping Runtime`.
4. In `Destination Vault Picker`, set:
   - `Target Chain`: `Base`
   - `Exact Vault Address`: `0x12afdefb2237a5963e7bab3e2d46ad0eee70406e`
5. Click `Search Vaults`.
6. In the results, select `RE7USDC`.
7. In the first task card, fill:
   - `Source Chain`: `Arbitrum`
   - `Source Token`: `USDC`
   - `Amount`: `1250000`
8. Click `Add Card`, then fill the second card:
   - `Source Chain`: `Optimism`
   - `Source Token`: `ETH`
   - `Amount`: `420000000000000000`
9. Click `Run Batch`.

## Expected Result

- Card 1 shows `Bridge`.
- Card 2 shows `Swap + Bridge`.
- The result panel shows `total = 2`.
- In `plan-only` mode, you should see route/planning results without triggering a real deposit.
