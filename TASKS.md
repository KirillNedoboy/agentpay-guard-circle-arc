# TASKS.md - Build Plan

## Existing MVP foundation

- [x] TypeScript / Next.js local app.
- [x] Deterministic policy engine.
- [x] `ALLOW` / `REVIEW` / `BLOCK` decisions.
- [x] Decimal-string amount handling.
- [x] JSONL audit log with idempotency.
- [x] Guard evaluation API.
- [x] Audit log API.
- [x] Local demo UI.
- [x] Baseline scenario fixtures.

## Ignyte / Circle / Arc implementation slice

- [x] Add additive `CircleRail`, `PaymentPurpose`, and `CircleRailPreview` types.
- [x] Add pure rail-preview adapter.
- [x] Map `mock_x402_service`, `mock_gateway_nanopayment`, and `arc_settlement_preview`.
- [x] Make unknown future rails `live_disabled`.
- [x] Add stable policy reason codes.
- [x] Add review threshold semantics.
- [x] Update demo sources and scenarios for trusted API, premium dataset, and untrusted source.
- [x] Add audit fields for event type, reason codes, execution mode, and rail preview.
- [x] Update README, architecture, audit schema, and demo script.
- [x] Add `docs/ignyte-circle-arc-brief.md`.
- [x] Show compact rail preview in the demo UI.
- [x] Run focused tests after UI change.
- [x] Run full validation: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
- [x] Run final validation after tracker updates and commit if clean.

## Hackathon-ready simulation proof

- [x] Add a pure Arc Testnet USDC simulation adapter with explicit `not_broadcast` evidence.
- [x] Add simulation evidence to evaluation responses and audit receipts.
- [x] Route the approved CitePay source into the Arc simulation boundary.
- [x] Reshape the main demo into a guided proof flow with progressive disclosure.
- [x] Add `GET /api/health`, local smoke script, deployment guide, judge one-pager, submission answers, and integration status matrix.
- [x] Run final full validation and inspect the final diff.

## Judge-visible x402 policy envelope

- [x] Add decimal-safe per-request, daily-budget, projected-spend, and velocity receipt evidence.
- [x] Add the deterministic trusted x402-style USDC API micropayment judge preset.
- [x] Make the x402 proof the primary UI path and retain CitePay as an optional secondary flow.
- [x] Preserve append-only JSONL audit evidence, idempotency, `ALLOW` / `REVIEW` / `BLOCK`, rail preview, and Arc Testnet simulation boundaries.
- [x] Update README, one-pagers, demo script, submission answers, integration matrix, state, and session notes.
- [ ] Refresh the published deck and video separately before final submission; do not imply their older CitePay-led story matches this click path.

## Do not start without explicit approval

- [ ] Live Circle Gateway integration.
- [ ] Live Arc integration.
- [ ] Real x402 buyer/seller payment.
- [ ] Wallet signing.
- [ ] Custody/private key handling.
- [ ] Transaction hash generation.
- [ ] DB/auth.
- [ ] Smart contracts.
- [ ] Background/cron autonomous spend.
