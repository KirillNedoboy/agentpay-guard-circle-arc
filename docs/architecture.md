# Architecture

## Canonical flow

```txt
AI agent payment intent
  -> strict validation
  -> deterministic policy + decimal-safe spend controls
  -> ALLOW / REVIEW / BLOCK, matched rules, reason codes
  -> append-only JSONL audit record or idempotent reuse
  -> AgentPay Receipt (fundsMoved: false)
  -> future settlement adapter preview (broadcast: false)
```

The API is `POST /api/payment-intents/evaluate`. It validates the request before policy evaluation, computes the spend-control envelope once, writes or reuses audit evidence, and returns the decision plus the persisted evidence fields.

## Policy and evidence

- `src/domain/policy/engine.ts` evaluates currency, amount, recipient, scenario, suspicious intent terms, daily budget, and velocity. CCTP, ERC-20 authority, and Paymaster rules remain additive policy contexts.
- `src/domain/policy/spend-controls.ts` uses string parsing and `BigInt` decimal arithmetic. It reports the request amount, per-request limit, review threshold, daily allowed/remaining/projected spend, and velocity count.
- `src/domain/audit/audit-log.ts` serialises one JSON object per line. Repeated `idempotencyKey` values return the original record and do not append a duplicate.
- `src/domain/payment-intent/receipt.ts` builds an AgentPay Receipt from audit evidence. Every receipt has `fundsMoved: false`.

New fields are optional in `AuditRecord` so historical JSONL remains readable without rewriting it: `spendControls`, `arcTestnetSimulation`, and the existing `programmablePaymentContext`.

## x402-first judge path

`createX402JudgePreset()` describes a trusted `0.08 USDC` API intent. It is a deterministic x402-style context, not an implementation of x402. The UI puts it first and shows:

- the decision, matched rules, reason codes, and audit trace;
- per-request and daily spend controls;
- the linked AgentPay Receipt;
- the explicit future-adapter boundary.

## Protocol-context boundary

`railPreview` may describe CCTP route, ERC-20 authority, or USDC Paymaster policy inputs. `arcTestnetSimulation` is local deterministic evidence only, with `broadcast: false` and `status: "not_executed"`.

This code does not call an RPC, Circle, Arc, Gateway, x402, CCTP, Iris, bundler, EntryPoint, or wallet API. It does not read balances or allowances, construct a UserOperation or permit, sign, custody, or settle USDC.
