# STATE.md - Project State

## Product

AgentPay Guard is a preflight policy and audit layer for AI-agent stablecoin payment intents.

Current focus: Ignyte / Circle / Arc stablecoin commerce proof. The demo shows an agent creating USDC spend intents for paid API/data/service access, Guard returning `ALLOW`, `REVIEW`, or `BLOCK`, and a preview-only x402 / Circle Gateway / Arc rail object.

## Current phase

`HACKATHON_READY_SIMULATION_PROOF`

## Done

- Next.js / React / TypeScript / Vitest app scaffold exists.
- Guard API exists at `POST /api/payment-intents/evaluate`.
- Audit API exists at `GET /api/audit-log`.
- Deterministic policy engine exists.
- Decimal-string money helpers are used for amount comparisons.
- JSONL audit logging is append-only and idempotent by `idempotencyKey`.
- Existing paid-source selection flow maps source candidates to Guard-compatible payment intents.
- Ignyte/Circle/Arc demo preset uses:
  - trusted Arc Testnet verification API -> `ALLOW` and non-broadcast simulation;
  - premium evidence bundle -> `REVIEW`;
  - untrusted scrape cache -> `BLOCK`;
  - telemetry attestation note -> `REVIEW`.
- Additive rail preview types and adapter exist.
- Audit records include `eventType`, `reasonCodes`, `executionMode`, and `railPreview`.
- Tests cover rail preview, policy reason codes, audit payload shape, scenario decisions, and safe invalid-request posture.
- Demo UI shows compact rail preview rows for evaluated spend intents.
- Arc Testnet simulation uses fixed official network and USDC metadata; it performs no RPC call, signing, or broadcast.
- Health endpoint exists at `GET /api/health`; `pnpm smoke` verifies local health and the three decision states.
- README and core docs now use AgentPay Guard / Circle / Arc positioning as primary.
- Generated Playwright artifacts were removed from the working tree.
- Current validation passed: `pnpm test` (9 files, 47 tests), `pnpm lint`, `pnpm typecheck`, `pnpm build`, and production HTTP smoke.

## In progress

- Submission owner can record a public demo URL or video only after it exists.

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

Inspect the final diff, then commit only if the diff remains intentional:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

After commit, report the commit hash and validation results.
