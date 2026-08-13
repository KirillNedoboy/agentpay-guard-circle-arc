# CHECKPOINT.md

## Current grant-track checkpoint — 2026-08-14

- Stable main base: `eb28fe7973cdd3d770de155556c23ee214c6ef33` (merge of PR #3,
  integration/ignyte-circle-arc-preview). `main` does NOT contain the grant-branch
  Phase 1–7 work.
- Grant development branch: `grant/circle-grants-pilot-2026`; Phases 0–7 complete
  (commit range 46cfbab…068c579); Phase 8 (grant evidence package) in progress;
  Phase 9 (fresh-clone / release readiness) next.
- The primary judge path is the trusted `0.08 USDC` x402-style API-micropayment
  envelope, now surfacing grant evidence (Phase 6): exact replay evidence, policy
  attribution (ID / version / fingerprint), the bounded ExecutionAuthorization,
  explicit not-executed states, and local pilot metrics.
- The flow evaluates deterministic recipient, amount, budget, scenario, and velocity
  policy before a future settlement adapter.
- New audit records persist decimal-safe spend controls, policy/intent fingerprints,
  replay evidence, and local Arc adapter simulation evidence; legacy JSONL records
  remain readable (in-memory normalization only, never rewritten on disk).
- `fundsMoved` remains `false`; the MVP has no wallet, signing, custody, RPC, live
  Arc/Circle/x402 call, or transaction hash.
- Threat-model verification is complete (Phase 7): internal engineering
  verification, NOT an independent external security audit.
- CCTP, ERC-20, and Paymaster proposal previews remain deterministic secondary
  policy contexts. CitePay remains a collapsed illustrative local flow.

## Release checks (manual, NOT YET VALIDATED)

The live demo must be manually redeployed and verified against the grant branch;
the existing public video must be manually reviewed or re-recorded for the
judge-first path; and the Phase 6 evidence PNGs must be captured before final
submission. External grant-program requirements must be verified against official
sources.
