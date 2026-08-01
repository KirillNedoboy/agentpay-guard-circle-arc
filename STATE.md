# Project state

## Canonical product

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc.

## Current phase

`INTEGRATION_PR_READY_PENDING_REVIEW`

## Implemented

- x402-first judge path for trusted `0.08 USDC` API access.
- `ALLOW` / `REVIEW` / `BLOCK` policy engine with CCTP, ERC-20 authority, and Paymaster proposal contexts.
- Decimal-safe spend-control envelope persisted on new audit records and returned by successful evaluations.
- Append-only JSONL audit evidence, legacy-record normalization, and idempotent replay.
- AgentPay Receipt with `fundsMoved: false`.
- Local Arc Testnet future-adapter evidence with `broadcast: false` and no RPC call.
- Visible validator fixtures for CCTP, ERC-20, and Paymaster; collapsed CitePay local source-selection illustration.
- Public docs and deck source aligned to the x402-first proof.

## Boundary

No real payments, signing, wallet, custody, private keys, transaction hashes, live Arc/Circle/x402/CCTP calls, database, auth, smart contracts, AML/KYC, fraud guarantee, or official partnership claim.

## Next manual actions

1. Review and merge the integration PR into `main`.
2. Redeploy the published demo from merged `main`.
3. Manually review or re-record the preserved video assets for the x402-first path.
4. Submit Encode only after those release actions.
