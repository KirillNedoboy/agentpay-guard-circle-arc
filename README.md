# AgentPay Guard

> Preflight policy and audit layer for autonomous AI-agent USDC payment intents before x402, Circle Gateway, or Arc-compatible payment flows.

## What this is

AgentPay Guard is a local deterministic proof for the Stablecoins Commerce Stack / agentic economy track.

It shows the control point before an agent spends:

1. an agent creates a USDC payment intent for a paid API, data source, or service;
2. Guard validates the request and applies deterministic policy rules;
3. Guard returns `ALLOW`, `REVIEW`, or `BLOCK`;
4. Guard writes or reuses an append-only JSONL audit record;
5. the UI shows a Circle/Arc rail preview without moving funds.

This is not a live payment product. It is the guard and evidence layer before a future payment rail.

## Implemented now

- Next.js / TypeScript local demo.
- `POST /api/payment-intents/evaluate`.
- `GET /api/audit-log`.
- Decimal-string USDC amount handling.
- Deterministic policy engine with trusted, review-required, unknown, and blocked recipient paths.
- Circle/Arc rail preview adapter for:
  - `mock_x402_service`;
  - `mock_gateway_nanopayment`;
  - `arc_settlement_preview`;
  - `mock_agent_wallet`;
  - unknown rails as `live_disabled`.
- JSONL audit records with idempotency by `idempotencyKey`.
- AgentPay Receipt proof artifact for every evaluated spend intent, sourced from existing audit evidence and marked preview-only.
- Demo preset with visible `ALLOW`, `REVIEW`, and `BLOCK` outcomes.

## Not implemented

- no real payment execution;
- no live Circle Gateway call;
- no live Arc integration;
- no live x402 buyer or seller flow;
- no wallet signing;
- no custody or private keys;
- no transaction hash fabrication;
- no DB/auth/smart contracts;
- no AML/KYC or fraud guarantee;
- no official Circle, Arc, or Ignyte integration claim.

## Demo story

A research agent needs paid evidence before publishing a thesis. It prepares USDC spend intents for:

- `Trusted x402 verification API` at `0.08 USDC` -> `ALLOW`;
- `Premium evidence bundle` at `0.25 USDC` -> `REVIEW`;
- `Untrusted scrape cache` at `0.04 USDC` -> `BLOCK`;
- `Telemetry attestation note` at `0.03 USDC` -> `REVIEW`.

The UI shows proposed spend, allowed spend, matched policy rules, audit IDs, and the preview-only rail metadata.

## Architecture

```txt
Agent workflow
  -> paid API/data/service source
  -> payment intent
  -> AgentPay Guard policy evaluation
  -> ALLOW / REVIEW / BLOCK
  -> JSONL audit record
  -> mock x402 / Circle Gateway / Arc rail preview
```

Payment execution remains outside this MVP.

## Main API

```http
POST /api/payment-intents/evaluate
```

Typical response fields:

- `decision`
- `riskScore`
- `reason`
- `matchedRules`
- `reasonCodes`
- `policyId`
- `auditId`
- `createdAt`
- `executionMode`
- `railPreview`

## Repository structure

```txt
src/                         app, UI, API, guard logic
examples/                    sample payment-intent scenarios
data/policies.default.json   default policy config
data/audit-log.jsonl         local append-only audit log
docs/                        architecture, demo, proof-pack notes
screenshots/                 demo evidence
```

## Demo scenarios

- `examples/scenario-allow-api.json` -> trusted x402 API purchase -> `ALLOW`
- `examples/scenario-review-machine.json` -> premium dataset review -> `REVIEW`
- `examples/scenario-block-risky.json` -> untrusted source block -> `BLOCK`

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm dev
```

Open:

```txt
http://localhost:3000
```

If port 3000 is busy, Next.js will print the alternate local URL.

## Recommended reviewer path

1. `README.md`
2. `docs/ignyte-circle-arc-brief.md`
3. `docs/architecture.md`
4. `docs/demo-script.md`
5. `docs/audit-log-schema.md`
6. `data/policies.default.json`
7. `tests/rail-preview.test.ts`

## Roadmap

- buyer-side x402/Gateway adapter after explicit approval;
- operator review queue for `REVIEW`;
- policy editor and audit export;
- DB/auth/rate limiting for production hardening;
- optional live sandbox integration only after wallet/signing/payment-execution scope is explicitly approved.
