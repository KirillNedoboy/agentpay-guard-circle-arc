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

## Programmable-money context foundation — Phase 1

- [x] Map validation, policy, rail preview, audit, and receipt flow before editing.
- [x] Run baseline validation at `99fbc46`.
- [x] Add optional route, operation, spender, base-unit, and fee context types.
- [x] Preserve legacy `PaymentIntent` callers and validator form behavior without optional context.
- [x] Strictly validate optional route context, enums, fee asset and decimal, spender, and base units.
- [x] Reject invalid nested context before policy evaluation or audit writing.
- [x] Add focused validation and API fail-closed tests.
- [x] Commit the Phase 1 types and validation changes separately.
- [x] Phase 2: deterministic CCTP-first route policy.

Phase 1 did not change policy behavior, audit schema, receipt content, rail preview behavior, scenarios, or UI behavior.

## CCTP-first route policy — Phase 2

- [x] Add local CCTP demo-policy configuration for Ethereum to Base and local review/budget thresholds.
- [x] Keep generic hard max `10.00`; set Fast Transfer review threshold to `5.00`.
- [x] Apply deterministic CCTP block and review rules only to `transferMode: "cctp"`.
- [x] Calculate amount plus optional fee with existing decimal-string arithmetic.
- [x] Add a nested CCTP route preview inside the existing `railPreview` value.
- [x] Keep generic and unknown-rail preview behavior unchanged.
- [x] Add policy and preview tests, including precedence, decimal boundary, and no fabricated execution evidence.
- [x] Commit policy and preview work separately.
- [ ] Phase 3: ERC-20 authority policy.

Phase 2 did not add an endpoint, top-level API response field, top-level audit field, audit writer change, receipt builder change, UI change, fixture, dependency, or network execution.

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
