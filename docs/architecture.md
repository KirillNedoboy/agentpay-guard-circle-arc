# Architecture

```txt
AI agent
  -> proposed USDC payment intent
  -> request validation
  -> deterministic policy engine + decimal-safe spend controls
  -> ALLOW / REVIEW / BLOCK
  -> append-only JSONL AgentPay Receipt
  -> future x402 / Circle Gateway / Arc adapter (preview only)
  -> browser evidence view
```

`POST /api/payment-intents/evaluate` is the decision boundary. It validates the request, evaluates policy, derives `spendControls` from the policy and recent audit records, writes or reuses an audit record, and returns the decision plus preview evidence. New receipts persist the policy envelope: requested amount, per-request limit, review threshold, daily allowed spend, daily remaining before request, projected daily spend, and velocity attempt count.

`GET /api/audit-log` returns recent receipts. `GET /api/health` returns an unauthenticated local readiness response and exposes no configuration or credentials.

## Preview-only settlement boundary

The x402/Circle/Arc handoff is descriptive only. The pure Arc Testnet simulation performs no RPC request, signing, wallet connection, or broadcast. It accepts only an `ALLOW` decision for `arc_settlement_preview` using USDC and fixed Arc Testnet configuration. Every output has `broadcast: false` and `verificationStatus: not_broadcast`.

The receipt deliberately has no transaction hash, signature, wallet address, private key, or explorer transaction URL. The explorer base URL is reference configuration only.

## Persistence and failure posture

Audit records are append-only JSONL at `data/audit-log.jsonl` and are idempotent by `idempotencyKey`. Validation failures return `BLOCK` before audit writing or simulation. Internal failures return non-ALLOW results. A simulation adapter marked unavailable returns `not_executed`; it never falls through to settlement.
