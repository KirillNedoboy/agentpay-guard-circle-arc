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
- [x] Phase 3: ERC-20 authority policy.

Phase 2 did not add an endpoint, top-level API response field, top-level audit field, audit writer change, receipt builder change, UI change, fixture, dependency, or network execution.

## ERC-20 authority-aware policy — Phase 3

- [x] Add separate local spender allow and deny lists.
- [x] Evaluate proposal-only `approve`, `transferFrom`, and direct `transfer` authority context.
- [x] Preserve hard-block precedence and stable, deduplicated authority reason codes.
- [x] Add string-only USDC six-decimal base-unit conversion.
- [x] Add nested ERC-20 authority preview inside the existing `railPreview` value.
- [x] Keep decimal `amount` as the policy source of truth when supplied base units differ.
- [x] Add focused authority, base-unit, and preview tests.
- [x] Commit authority policy and preview/helper changes separately.
- [x] Add a separate local Paymaster total-cost demo budget.
- [x] Apply missing-fee, developer-control, and decimal-safe total-cost rules only to `usdc-paymaster-preview`.
- [x] Add nested Paymaster proposal preview details and the no-UserOperation/permit/bundler/gas-payment boundary.
- [x] Preserve CCTP, ERC-20, audit, receipt, API, UI, fixtures, and public documentation behavior.
- [x] Add focused policy and preview tests, including boundaries, precedence, isolation, and deduplication.
- [x] Phase 4: USDC Paymaster-preview total-cost policy.

Phase 3 did not add a chain read, allowance or balance query, signing, permit, transaction, endpoint, top-level API response field, top-level audit field, audit writer change, receipt builder change, UI change, fixture, dependency, or network execution.

## USDC Paymaster-preview total-cost policy — Phase 4

- [x] Keep a separate `paymaster.maxTotalUsdcSpend` local demo-policy budget.
- [x] Use `addDecimalStrings` for amount-plus-fee policy and preview totals.
- [x] Preserve hard-block precedence and deduplicate matched rules and reason codes.
- [x] Keep Paymaster context proposal-only with no UserOperation, permit, bundler/EntryPoint call, or gas payment.
- [ ] Phase 5: audit, receipt, API and idempotency evidence.

Phase 4 did not change the audit writer or schema, receipt builder, API endpoint or top-level response fields, UI, demo fixtures, public documentation, dependencies, environment, wallet/signing, RPC/network calls, or payment execution.

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
