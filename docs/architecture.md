# Architecture

```txt
CitePay research agent
  -> proposed USDC payment intent
  -> request validation
  -> deterministic policy engine
  -> ALLOW / REVIEW / BLOCK
  -> append-only JSONL audit receipt
  -> Arc Testnet simulation (ALLOW + Arc USDC route only)
  -> browser evidence view
```

`POST /api/payment-intents/evaluate` remains the decision boundary. It validates the request, evaluates policy, writes or reuses an audit record, and returns additive `arcTestnetSimulation` evidence.

`GET /api/audit-log` returns recent receipts. `GET /api/health` returns an unauthenticated local readiness response and exposes no configuration or credentials.

## Arc Testnet simulation boundary

The adapter is pure TypeScript. It performs no RPC request, signing, wallet connection, or broadcast. It accepts only an `ALLOW` decision for `arc_settlement_preview` using USDC and the fixed Arc Testnet configuration. Every output has `broadcast: false` and `verificationStatus: not_broadcast`.

The receipt deliberately has no transaction hash, signature, wallet address, private key, or explorer transaction URL. The explorer base URL is reference configuration only.

## Persistence and failure posture

Audit records are append-only JSONL at `data/audit-log.jsonl` and are idempotent by `idempotencyKey`. Validation failures return `BLOCK` before audit writing or simulation. Internal failures return non-ALLOW results. A simulation adapter marked unavailable returns `not_executed`; it never falls through to settlement.
