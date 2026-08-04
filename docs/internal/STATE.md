# Project state

## Canonical product

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc.

## Current phase

`CANONICAL_SUBMISSION_POLISH_READY_FOR_PR_REVIEW`

## Implemented

- x402-first judge path for trusted `0.08 USDC` API access.
- `ALLOW` / `REVIEW` / `BLOCK` policy engine with CCTP, ERC-20 authority, and Paymaster proposal contexts.
- Decimal-safe spend-control envelope persisted on new audit records and returned by successful evaluations.
- Append-only JSONL audit evidence, legacy-record normalization, and idempotent replay.
- AgentPay Receipt with `fundsMoved: false`.
- Local Arc Testnet future-adapter evidence with `broadcast: false` and no RPC call.
- Visible validator fixtures for CCTP, ERC-20, and Paymaster; collapsed CitePay local source-selection illustration.
- Public docs and deck source aligned to the x402-first proof.
- Judge-first README with CI and license badges, screenshot evidence, and one navigation block for review assets.
- MIT license and canonical GitHub homepage/topics.
- Internal process notes moved under `docs/internal/` so the repository root stays product-focused.

## Boundary

No real payments, signing, wallet, custody, private keys, transaction hashes, live Arc/Circle/x402/CCTP calls, database, auth, smart contracts, AML/KYC, fraud guarantee, or official partnership claim.

## Next manual actions

1. Review and merge the updated integration PR into `main`.
2. Redeploy the published demo from merged `main`.
3. Manually review or re-record the preserved video assets for the x402-first path.
4. Submit Encode only after those release actions.
