# Architecture

## Implemented flow

```txt
Proposed payment intent
  -> strict validation
  -> deterministic local policy
  -> ALLOW / REVIEW / BLOCK
  -> preview-only route, authority, and fee explanation
  -> append-only audit record or idempotent reuse
  -> AgentPay Receipt evidence
  -> future settlement adapter boundary
```

The browser demo calls `POST /api/payment-intents/evaluate`. The endpoint validates the request before policy evaluation, writes JSONL evidence only for successful evaluations, and returns the decision, matched rules, reason codes, audit ID, and existing `railPreview` field.

## Implemented policy and evidence

- Generic USDC policy checks currency, amount, recipient, scenario, daily limit, velocity, and suspicious terms.
- CCTP route policy handles only proposal context. The local allowlist permits Ethereum to Base; same-chain and unsupported routes block. Fast Transfer, developer-controlled wallet context, and claimed verified attestation can require review.
- ERC-20 authority policy handles proposal-only `approve` and `transferFrom` details. Decimal `amount` remains the policy amount; base units are informational evidence.
- Paymaster policy handles only `usdc-paymaster-preview`. A missing estimated fee or developer-controlled context requires review; amount plus fee above the separate local demo budget blocks.
- `programmablePaymentContext` is optional audit and receipt evidence. Legacy generic JSONL lines remain readable, and repeated `idempotencyKey` values reuse the existing line.

Decimal sums use string arithmetic. None of these contexts proves an on-chain protocol result.

## Preview-only protocol context

`railPreview` can contain nested CCTP route, ERC-20 authority, or Paymaster fee details. They describe what the policy evaluated:

- a proposed native-USDC CCTP route, not a burn, Iris request, attestation verification, or mint;
- a proposed authority operation, not an allowance/balance read or signed ERC-20 action;
- a proposed USDC fee budget, not a UserOperation, permit, bundler/EntryPoint request, or gas payment.

The AgentPay Receipt has `fundsMoved: false` and remains policy/evidence output, not a payment receipt or settlement result.

## Future integration boundary

Any settlement adapter is future, separately approved work. This repository has no live Circle, Arc, CCTP, Gateway, x402, Iris, wallet, signing, private-key, transaction, balance, finality, or custody capability.

## Main modules

```txt
src/domain/payment-intent  types, validation, evaluation, preview, receipt
src/domain/policy          policy config and deterministic engine
src/domain/audit           append-only JSONL records and idempotency
src/domain/citepay         local source selection
src/app                    demo UI and API routes
```
