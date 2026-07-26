# STATE.md - Project State

## Product

AgentPay Guard is a preflight policy and audit layer for AI-agent stablecoin payment intents.

Current focus: Ignyte / Circle / Arc stablecoin commerce proof. The demo shows an agent creating USDC spend intents for paid API/data/service access, Guard returning `ALLOW`, `REVIEW`, or `BLOCK`, and a preview-only x402 / Circle Gateway / Arc rail object.

## Current phase

`DOCUMENTATION_AND_SUBMISSION_READY`

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
- Local CCTP demo-policy supports the Ethereum-to-Base pair, review thresholds, and a decimal-safe total USDC budget.
- CCTP proposals can deterministically `ALLOW`, `REVIEW`, or `BLOCK` without changing generic intent behavior.
- CCTP route previews are attached only inside the existing `railPreview` field and state that no execution occurred.
- ERC-20 authority policy evaluates proposed `approve` and `transferFrom` operations with separate spender lists.
- USDC base-unit conversion uses string-only six-decimal formatting and remains informational preview data.
- Local Paymaster preview policy has its own `100.00` USDC total-cost demo budget, separate from the CCTP route budget.
- Only `usdc-paymaster-preview` requires an estimated fee, reviews developer-controlled wallets, and blocks totals above its local budget.
- Paymaster totals use decimal-string addition; exact `100.00` remains non-blocking.
- `railPreview` can include nested Paymaster proposal context without constructing a UserOperation, permit, bundler/EntryPoint call, or gas payment.
- Audit JSONL records persist optional normalized programmable-payment proposal context while legacy entries remain readable and idempotent replays reuse the original line.
- AgentPay Receipt carries the same optional proposal context and explicitly remains policy/evidence, not a payment or settlement receipt.
- API evidence tests cover valid CCTP, ERC-20, and Paymaster-preview requests plus validation and storage fail-closed posture without changing the route.
- Validator mode now loads the three original generic scenarios plus Fast Transfer CCTP review, standard CCTP allow, unsupported CCTP route block, and ERC-20 approval review fixtures.
- One compact programmable-evidence renderer shows proposal-only route, authority, fee, base-unit, policy, and preview-boundary context in decisions, validator output, receipts, and audit proof.
- CCTP evidence includes a four-step preview-only lane; it does not claim burn, Iris attestation, mint, or settlement execution.
- Phase 6 browser verification covered desktop and a `390x844` mobile viewport; receipts continued to show `fundsMoved: false`.
- Phase 7 documentation now describes implemented programmable-money policy as proposal-only evidence, with no live protocol or settlement claims.
- Real local screenshots cover CCTP Fast Transfer review, standard CCTP allow, unsupported CCTP route block, ERC-20 approval review, and AgentPay Receipt context.

## In progress

- No implementation work is in progress.

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

After review or merge, prepare the existing branch for push/PR. Do not start another implementation phase.

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```
