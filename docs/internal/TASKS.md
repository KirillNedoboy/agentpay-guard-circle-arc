# Release tasks

## Completed in the integration branch

- [x] Reconcile from canonical `origin/main` without merging unrelated feature history.
- [x] Preserve CI, public media, deck assets, historical audit JSONL, receipts, and CCTP/ERC-20/Paymaster behavior from main.
- [x] Add x402-first judge preset, spend controls, audit/receipt evidence, and non-broadcast Arc adapter preview.
- [x] Add deterministic tests for spend controls, x402 receipt/idempotency, API evidence, Paymaster fixture, and external audit-path smoke isolation.
- [x] Make CitePay a secondary local flow and expose CCTP/ERC-20/Paymaster validator fixtures.
- [x] Align required docs and deck source with proposal-only scope.
- [x] Polish canonical submission packaging: judge-first README, internal-note relocation, MIT license, metadata, and presentation-only x402-first UI hierarchy.

## Before final Encode submission

- [ ] Review and merge the integration PR.
- [ ] Redeploy the public demo from merged `main`.
- [ ] Review the existing YouTube and fallback MP4 against the new x402-first click path; re-record if needed.
- [ ] Run the one-minute click path against the deployed build.
- [ ] Submit the Encode form manually.
