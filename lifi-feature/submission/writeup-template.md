# Hackathon Write-up Template

## 1) Project

- Name: `[project name]`
- Repo: `[github link]`
- Demo: `[video/live link]`
- Track: `Developer Tooling`
- Team: `[member names]`

## 2) What We Built

We built a vault-first LI.FI integration flow:

1. Discover earn vaults from `earn.li.fi`
2. Select an eligible vault (address + chain + transactional checks)
3. Generate a Composer quote from `li.quest` (`GET /v1/quote`)
4. Render a human-readable route preview before execution

This closes the loop from discovery to action planning.

## 3) Technical Details

- Earn data layer:
  - Vault list endpoint
  - Cursor-based pagination (`nextCursor`)
  - Basic normalization for APY/TVL/address/chain fields
- Composer layer:
  - Quote request based on selected vault address as `toToken`
  - Route risk/fee/gas summary output

## 4) Why This Matters

- Reduces context switching between yield discovery and execution planning
- Helps users avoid wrong target token mistakes when depositing into vaults
- Adds explainability before signing transactions

## 5) Current Limitations

- Heuristic vault normalization for heterogeneous payloads
- Example flow uses static sender defaults
- No execution/signing in this prototype

## 6) Next Steps

- Add portfolio position tracking from Earn API
- Add wallet integration + safe execution path
- Add AI strategy layer for vault filtering and allocation proposals

## 7) Feedback for LI.FI APIs

- What was smooth:
  - `[fill in]`
- Pain points:
  - `[fill in]`
- Requested improvements:
  - `[fill in]`
