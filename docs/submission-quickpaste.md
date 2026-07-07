# Ignyte / Circle / Arc submission quickpaste

## Project title

AgentPay Guard

## Short one-liner

Preflight policy and audit layer for AI-agent USDC payment intents before x402, Circle Gateway, or Arc-compatible payment flows.

## 500-character summary

AgentPay Guard is a local preflight policy and audit layer for AI-agent USDC payment intents. It validates amount, currency, recipient, scenario, limits, and risk before any rail is reached, then returns ALLOW, REVIEW, or BLOCK with JSONL audit evidence, preview-only x402/Circle/Arc rail metadata, and an AgentPay Receipt proof artifact. The MVP proves the control layer, not live payment execution.

## Full project description

AgentPay Guard is a deterministic guard layer for agentic stablecoin commerce. The demo starts with an AI agent preparing paid API, data, and telemetry requests. Each request becomes a USDC payment intent. Guard validates the intent, applies policy rules, returns `ALLOW`, `REVIEW`, or `BLOCK`, and writes or reuses an append-only audit record.

The UI shows the full proof path: proposed spend, allowed spend, matched rules, reason codes, audit IDs, preview-only rail metadata for x402, Circle Gateway-style nanopayments, Arc settlement, and local agent-wallet modes, plus a human-readable and JSON AgentPay Receipt for every evaluated spend intent.

Each AgentPay Receipt includes the decision, reason codes, rail preview, execution mode, audit ID, and `fundsMoved: false`. It is preview-only and does not imply live Circle, Arc, or x402 execution.

This is not a live payment product. It is the decision and evidence layer that should sit before a future payment rail integration.

## Problem

Autonomous agents can request paid APIs, data, compute, telemetry, or services without a human reviewing every spend decision. A payment rail can move value, but it does not automatically answer whether the agent should spend, whether the recipient is trusted, whether the amount is within policy, or how the decision will be audited later.

Agentic commerce needs a clear preflight step before execution.

## Solution

AgentPay Guard evaluates payment intents before they reach a rail. It checks request shape, decimal-string USDC amounts, currency, recipient policy, scenario policy, spend limits, suspicious keywords, and velocity conditions.

The result is explicit:

- `ALLOW`: the intent is clean under policy.
- `REVIEW`: the intent needs operator review.
- `BLOCK`: the intent must not execute.

Every successful evaluation creates or reuses a JSONL audit record keyed by `idempotencyKey`.

## Target users

- AI-agent builders adding spend controls before autonomous payments.
- Stablecoin commerce developers who need policy evidence before execution.
- Operators reviewing agent spend requests.
- Grant or challenge reviewers checking that payment safety is handled before rail integration.

## Why Circle / Arc

Circle and Arc matter because AI agents need stable, programmable money rails. But programmable money still needs policy gates. AgentPay Guard focuses on the layer before settlement: can this agent spend, for this purpose, to this recipient, at this amount?

The MVP uses USDC payment intents and preview-only Circle / Arc rail metadata to show where the guard fits. It does not call live Circle Gateway APIs, live Arc services, or a live x402 buyer/seller flow.

## Challenge track

Agentic Economy

## Demo flow

1. Open the local demo.
2. Run the built-in Ignyte / Circle / Arc preset.
3. The agent selects paid API, data, and telemetry sources for a research workflow.
4. Each selected source maps to a Guard-compatible USDC payment intent.
5. Guard evaluates each intent:
   - trusted x402 verification API: `ALLOW`;
   - premium evidence bundle: `REVIEW`;
   - untrusted scrape cache: `BLOCK`;
   - telemetry attestation note: `REVIEW`.
6. The UI shows proposed spend, allowed spend, matched rules, reason codes, audit IDs, and preview-only rail metadata.
7. The audit proof panel shows the guard decision, audit trace, matched policy rules, and reason codes.
8. The AgentPay Receipt panel shows the human-readable receipt card and matching JSON proof artifact for the selected evaluated intent.

## What is implemented

- Next.js / TypeScript local demo.
- `POST /api/payment-intents/evaluate`.
- `GET /api/audit-log`.
- Deterministic policy engine.
- Decimal-string USDC amount handling.
- `ALLOW`, `REVIEW`, and `BLOCK` decisions.
- Recipient, scenario, amount, daily-limit, velocity, currency, and suspicious-keyword rules.
- Append-only JSONL audit log at `data/audit-log.jsonl`.
- Idempotency by `idempotencyKey`.
- Typed preview adapter for mock x402, mock Circle Gateway-style nanopayment, Arc settlement preview, and local agent-wallet preview modes.
- AgentPay Receipt proof artifact for every evaluated spend intent, in both human-readable and JSON form.
- UI demo preset with allowed, reviewed, and blocked payment intents.
- Tests for policy behavior, invalid input, idempotency, audit payload shape, rail preview behavior, and safe failure posture.

## What is mock/preview only

- x402 flow is local preview metadata only.
- Circle Gateway-style nanopayment is local preview metadata only.
- Arc settlement is local preview metadata only.
- Agent wallet behavior is local preview metadata only.
- Unknown future rails resolve to `executionMode: "live_disabled"`.

## Safety boundaries

AgentPay Guard does not:

- move funds;
- sign transactions;
- connect wallets;
- custody assets;
- store private keys;
- call live Circle Gateway APIs;
- call live Arc services;
- run a live x402 buyer or seller flow;
- create transaction hashes;
- implement AML/KYC;
- claim fraud prevention;
- claim official Circle, Arc, or Ignyte integration status.

## Validation proof

Validation commands for the submitted repo:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Expected submitted state: all four commands pass, and `git status --short` is clean after commit.

## Repo link

https://github.com/KirillNedoboy/agentpay-guard-circle-arc

## Screenshot list

- `docs/assets/screenshots/demo-main.png`
- `docs/assets/screenshots/scenario-allow.png`
- `docs/assets/screenshots/scenario-review.png`
- `docs/assets/screenshots/scenario-block.png`
- `docs/assets/screenshots/audit-preview.png`
- `docs/assets/screenshots/agentpay-receipt.png`

## Roadmap / next milestones

- Add an operator review queue for `REVIEW` decisions.
- Add a policy editor and audit export flow.
- Harden persistence, auth, rate limits, and distributed audit writes for production.
- Add a buyer-side x402 or Circle Gateway sandbox adapter only after explicit scope approval.
- Explore Arc-compatible settlement integration only after wallet, signing, custody, and execution boundaries are designed and reviewed.
