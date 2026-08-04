# CHECKPOINT.md

## Current release checkpoint — 2026-08-02

- Canonical base: `origin/main` at `cff7b36192cffca02edce58154d5c3414f03c18b`.
- Integration branch: `integration/ignyte-circle-arc-preview`.
- The primary judge path is the trusted `0.08 USDC` x402-style API-micropayment envelope.
- The flow evaluates deterministic recipient, amount, budget, scenario, and velocity policy before a future settlement adapter.
- New audit records optionally persist decimal-safe spend controls and local Arc adapter simulation evidence; legacy JSONL records remain readable.
- `fundsMoved` remains `false`; the MVP has no wallet, signing, custody, RPC, live Arc/Circle/x402 call, or transaction hash.
- CCTP, ERC-20, and Paymaster proposal previews remain deterministic secondary policy contexts. CitePay remains a collapsed illustrative local flow.

## Release checks

Final command output and public-link checks are recorded in `docs/reconciliation-report.md` before this branch is proposed for merge. The live demo must be manually redeployed from merged `main`, and the existing public video must be manually reviewed or re-recorded before final submission.
