# TASKS.md - Build Plan

## Phase 0 - Starter pack

- [x] Define product.
- [x] Write requirements.
- [x] Add Codex instructions.
- [x] Add demo scenarios.
- [x] Add default policy config.
- [x] Add grant/demo docs.

## Phase 1 - Core backend

- [x] Create TypeScript app scaffold.
- [x] Add request validation.
- [x] Add decimal-safe amount parsing/comparison.
- [x] Load `data/policies.default.json`.
- [x] Implement policy engine.
- [x] Implement risk scoring.
- [x] Implement idempotency.
- [x] Append JSONL audit log.
- [x] Read recent audit log entries.
- [x] Add tests for all demo scenarios.

## Phase 2 - Demo UI

- [x] Add single page demo.
- [x] Add scenario selector.
- [x] Add editable form.
- [x] Add decision card.
- [x] Add matched rules list.
- [x] Add audit log table.
- [x] Add architecture strip.

## Phase 3 - Proof pack

- [x] Finalize README.
- [x] Finalize `docs/grant-draft.md`.
- [x] Finalize `docs/demo-script.md`.
- [x] Add `docs/proof-pack-checklist.md`.
- [x] Add `screenshots/README.md`.
- [x] Capture screenshots:
  - [x] `screenshots/01-allow-decision.png`
  - [x] `screenshots/02-review-decision.png`
  - [x] `screenshots/03-block-decision.png`
  - [x] `screenshots/04-audit-log.png`
- [x] Confirm `data/audit-log.jsonl` has valid demo records.
- [x] Prepare short post text.
- [x] Verify repo hygiene for publication.
- [ ] Prepare GitHub repo.

## Phase 4 - Lepton/CitePay documentation pivot

- [x] Create `docs/lepton-citepay-brief.md`.
- [x] Create `docs/citepay-mvp-scope.md`.
- [x] Update `STATE.md` with the CitePay direction.
- [x] Update `TASKS.md` with the CitePay documentation and next implementation phase.
- [x] Append a CitePay planning entry to `SESSION_NOTES.md`.
- [x] Keep `README.md` and `REQUIREMENTS.md` unchanged for this documentation-only phase.

## Next safe implementation phase

## Phase 5 - CitePay local MVP code slice

- [x] Add mock creator source cards in code.
- [x] Add deterministic source selection by query relevance.
- [x] Add decimal-string budget cap behavior.
- [x] Map selected sources to existing Guard-compatible payment intents.
- [x] Evaluate selected source intents through `POST /api/payment-intents/evaluate`.
- [x] Display selected sources, skipped sources, Guard decisions, proposed spend, and allowed spend in the local UI.
- [x] Preserve existing AgentPay Guard scenarios and audit behavior.
- [x] Keep the implementation local and deterministic.
- [x] Add unit tests for selection relevance, budget caps, payment-intent mapping, and Guard REVIEW/BLOCK propagation.
- [x] Add deterministic Lepton/CitePay demo preset query and budget.
- [x] Add `docs/citepay-demo-script.md` with the local paid-source selection demo flow.

## Next safe implementation phase

- [x] Capture updated CitePay demo screenshots:
  - [x] `screenshots/05-citepay-preset-loaded.png`
  - [x] `screenshots/06-citepay-guard-decisions.png`
  - [x] `screenshots/07-citepay-spend-summary.png`
- [x] Update the public README narrative for the Lepton/CitePay branch.
- [x] Align `STATE.md`, `TASKS.md`, and `SESSION_NOTES.md` with the CitePay branch narrative.
- [x] Review proof-pack consistency against the CitePay screenshots.
- [x] Add `docs/lepton-submission-draft.md`.
- [x] Add `docs/lepton-form-answers.md`.
- [x] Add `docs/lepton-demo-video-script.md`.
- [ ] Keep payment execution, signing, live integrations, DB/auth, and smart contracts out of scope.

## Do not start yet without explicit request

- [ ] Live Circle Gateway integration.
- [ ] Real x402 buyer/seller payment.
- [ ] Wallet signing.
- [ ] Custody/private key handling.
- [ ] DB/auth.
- [ ] Smart contracts.
