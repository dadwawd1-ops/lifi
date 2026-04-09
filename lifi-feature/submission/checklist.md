# Submission Checklist

## Build

- [ ] `npm run preview:route` works
- [ ] `npm run preview:status` works (with real `LI_FI_TX_HASH`)
- [ ] `npm run preview:earn-quote` works
- [ ] Earn endpoint uses `https://earn.li.fi`
- [ ] Composer endpoint uses `https://li.quest/v1`
- [ ] Quote path uses `GET /quote` (not POST)
- [ ] Vault deposit uses vault address as `toToken`

## Deliverables

- [ ] Public repo link prepared
- [ ] Demo link prepared (video or live app)
- [ ] Write-up completed from `submission/writeup-template.md`
- [ ] Tweet posted in submission window
- [ ] Google Form submitted
- [ ] `submission/REAL_EXECUTION_EVIDENCE.md` filled
- [ ] `submission/real-execution-verification.json` exists with `"ok": true`

## Tweet Window (APAC, UTC+8)

- [ ] Posted on `2026-04-14` between `09:00` and `12:00`

## Validation Notes

- [ ] Handle missing/`null` APY safely
- [ ] Handle string TVL parsing
- [ ] Handle pagination via `nextCursor`
- [ ] Respect `isTransactional` / `isRedeemable` hints when selecting vaults
