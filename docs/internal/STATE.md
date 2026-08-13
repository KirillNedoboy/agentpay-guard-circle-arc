# Project state

## Canonical product

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc.

## Current phase

`GRANT_TRACK_PHASE_8` — Circle Grants evidence package (grant/circle-grants-pilot-2026).

## Current grant-track facts

- Stable main base: `eb28fe7973cdd3d770de155556c23ee214c6ef33` (merge of PR #3,
  integration/ignyte-circle-arc-preview). `main` does NOT contain the grant-branch
  Phase 1–7 work.
- Current grant development branch: `grant/circle-grants-pilot-2026`.
- Phases 0–7 complete on the grant branch (commit range 46cfbab…068c579): typed
  policy evidence, ExecutionAuthorization envelope, replay and policy-drift
  evidence, canonical grant scenarios, pilot observability, judge-first evidence
  UI, and threat-model verification (internal engineering verification, not an
  external audit).
- Phase 8 = grant evidence package (docs reconciliation; evidence.md, submission.md,
  pilot-plan.md, demo-script.md). Phase 9 = fresh-clone / release readiness next.
- External deployment and video work remain manual actions, NOT YET VALIDATED (see
  TASKS.md).

## Implemented

- x402-first judge path for trusted `0.08 USDC` API access.
- `ALLOW` / `REVIEW` / `BLOCK` policy engine with CCTP, ERC-20 authority, and Paymaster proposal contexts.
- Decimal-safe spend-control envelope persisted on new audit records and returned by successful evaluations.
- Append-only JSONL audit evidence, legacy-record normalization, and idempotent replay.
- Grant-branch Phases 1–7: typed policy evidence, ExecutionAuthorization envelope, replay/policy-drift evidence, local pilot observability, judge-first evidence UI, and threat-model verification.
- AgentPay Receipt with `fundsMoved: false`.
- Local Arc Testnet future-adapter evidence with `broadcast: false` and no RPC call.
- Public docs and deck source aligned to the judge-first proof.

## Boundary

No real payments, signing, wallet, custody, private keys, transaction hashes, live Arc/Circle/x402/CCTP calls, database, auth, smart contracts, AML/KYC, fraud guarantee, or official partnership claim.

## History

The 2026-08-02 integration state (`integration/ignyte-circle-arc-preview`, phase
`CANONICAL_SUBMISSION_POLISH_READY_FOR_PR_REVIEW`) was superseded when PR #3 merged
at `eb28fe7…`. The Circle Grants development track (Phases 0–7) then built the
grant evidence on top of that stable base; those phases live on
`grant/circle-grants-pilot-2026`, not on `main`.

## Next manual actions (NOT YET VALIDATED)

1. Redeploy the published demo and verify parity with the grant branch.
2. Manually review or re-record the preserved video assets for the judge-first path.
3. Capture the Phase 6 evidence PNGs (still pending per docs/screenshots.md).
4. Verify external grant-program requirements against official sources, then submit.
