# Tasks

## Current Circle Grants track

Remaining tasks after Phase 8 (all unchecked; none are verified done):

- [ ] Phase 9: fresh-clone reproducibility — install, test, lint, typecheck, build
      green on a new clone of `grant/circle-grants-pilot-2026`.
- [ ] Current demo parity — redeploy the public demo and confirm it matches the
      grant-branch judge-first UI (NOT YET VALIDATED).
- [ ] Media parity — review the existing YouTube and fallback MP4 against the
      judge-first click path; re-record if needed.
- [ ] Capture the Phase 6 evidence PNGs (still pending per docs/screenshots.md).
- [ ] External grant-program requirement verification — verify requirements,
      deadlines, budget amounts, and form specifics against official sources.
- [ ] Add applicant-specific fields and budget to the submission.
- [ ] Submit the grant application.

## Legacy Encode release tasks (historical)

From the 2026-08-02 integration/Encode track; superseded by the Circle Grants
development track. Kept for context only — do not treat as current work.

### Completed in the integration branch

- [x] Reconcile from canonical `origin/main` without merging unrelated feature history.
- [x] Preserve CI, public media, deck assets, historical audit JSONL, receipts, and CCTP/ERC-20/Paymaster behavior from main.
- [x] Add x402-first judge preset, spend controls, audit/receipt evidence, and non-broadcast Arc adapter preview.
- [x] Add deterministic tests for spend controls, x402 receipt/idempotency, API evidence, Paymaster fixture, and external audit-path smoke isolation.
- [x] Make CitePay a secondary local flow and expose CCTP/ERC-20/Paymaster validator fixtures.
- [x] Align required docs and deck source with proposal-only scope.
- [x] Polish canonical submission packaging: judge-first README, internal-note relocation, MIT license, metadata, and presentation-only x402-first UI hierarchy.

### Before final Encode submission (historical)

- [x] Review and merge the integration PR — resolved: PR #3 merged at `eb28fe7…`.
      Note: merging PR #3 does not merge the later grant-branch Phase 1–7 work
      into `main`.
- [ ] Redeploy the public demo from merged `main` — OPEN manual action; not
      verified done (deployed-demo parity with the grant branch is NOT YET
      VALIDATED).
- [ ] Review the existing YouTube and fallback MP4 against the new x402-first
      click path; re-record if needed — OPEN manual action; media parity not
      verified.
- [ ] Run the one-minute click path against the deployed build — OPEN manual
      action.
- [ ] Submit the Encode form manually — OPEN manual action.
