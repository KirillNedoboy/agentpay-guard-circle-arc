# STATE.md - Project State

## Product

AgentPay Guard is a preflight policy and audit layer for AI-agent stablecoin payment intents.

Current focus: Ignyte / Circle / Arc stablecoin commerce proof. The demo shows an agent creating USDC spend intents for paid API/data/service access, Guard returning `ALLOW`, `REVIEW`, or `BLOCK`, and a preview-only x402 / Circle Gateway / Arc rail object.

## Current phase

`PROGRAMMABLE_MONEY_CONTEXT_FOUNDATION_COMPLETE`

## Done

- Next.js / React / TypeScript / Vitest app scaffold exists.
- Guard API exists at `POST /api/payment-intents/evaluate`.
- Audit API exists at `GET /api/audit-log`.
- Deterministic policy engine exists.
- Decimal-string money helpers are used for amount comparisons.
- JSONL audit logging is append-only and idempotent by `idempotencyKey`.
- Existing paid-source selection flow maps source candidates to Guard-compatible payment intents.
- Ignyte/Circle/Arc demo preset uses:
  - trusted x402 API -> `ALLOW`;
  - premium evidence bundle -> `REVIEW`;
  - untrusted scrape cache -> `BLOCK`;
  - telemetry attestation note -> `REVIEW`.
- Additive rail preview types and adapter exist.
- Audit records include `eventType`, `reasonCodes`, `executionMode`, and `railPreview`.
- Tests cover rail preview, policy reason codes, audit payload shape, scenario decisions, and safe invalid-request posture.
- Demo UI shows compact rail preview rows for evaluated spend intents.
- README and core docs now use AgentPay Guard / Circle / Arc positioning as primary.
- Generated Playwright artifacts were removed from the working tree.
- Final validation after tracker updates passed for `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- Optional programmable-money context types are available on `PaymentIntent`.
- Validation accepts legacy intents unchanged and strictly validates optional route, authority, base-unit, and fee context.

## In progress

- Phase 1 checkpoint documentation is pending final validation and commit.

## Boundary

The MVP does not:

- move funds;
- sign transactions;
- connect wallets;
- store private keys;
- call live Circle Gateway APIs;
- call live Arc services;
- run live x402 buyer/seller flows;
- create transaction hashes;
- add DB/auth/smart contracts;
- perform AML/KYC or fraud prevention.

## Reference-only context

The prior Lepton/CitePay and Mantle research-flow materials are useful narrative context only. They should not be treated as runtime dependencies or application models for this slice.

## Next safe step

Begin Phase 2 only after explicit review of the Phase 1 checkpoint. The next planned scope is deterministic CCTP-first route policy; it is not implemented in this branch.

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```
