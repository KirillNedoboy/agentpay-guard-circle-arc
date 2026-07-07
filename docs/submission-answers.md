# AgentPay Guard submission answers

## Project Name

AgentPay Guard

## One-Liner

Preflight policy and audit layer for AI-agent USDC payment intents before x402, Circle Gateway, or Arc-compatible payment flows.

## Challenge Track

Ignyte / Circle / Arc challenge: agentic stablecoin commerce and payment safety.

## Problem

Autonomous agents can generate payment intents for APIs, data, compute, telemetry, and other services faster than a human operator can review each spend decision. Before those intents reach a payment rail, builders need a deterministic control point that can answer a few basic questions:

- Is this currency supported?
- Is the amount valid and within limits?
- Is the recipient trusted, unknown, or denied?
- Does the scenario match approved policy?
- Can the result be audited later?

Without that layer, an agentic payment flow risks sending spend decisions directly to execution with weak evidence, unclear policy reasoning, or no durable audit trail.

## Solution

AgentPay Guard evaluates each payment intent before execution. It validates the request, applies deterministic policy rules, returns `ALLOW`, `REVIEW`, or `BLOCK`, and writes or reuses an append-only JSONL audit record keyed by `idempotencyKey`.

The demo shows a research agent preparing paid-source requests. Each selected source becomes a USDC payment intent, then Guard decides whether the intent can proceed, needs operator review, or must be blocked. The response also includes preview-only rail metadata so a reviewer can see how the decision layer would sit before x402, Circle Gateway, or Arc-compatible settlement.

Every evaluated spend intent also emits an AgentPay Receipt in human-readable and JSON form. The receipt includes the decision, reason codes, rail preview, execution mode, audit ID, and `fundsMoved: false`. It is preview-only and does not imply live Circle, Arc, or x402 execution.

## Why Circle / Arc

Circle and Arc are relevant because agentic payments need stable, programmable money rails, but the rail is only one part of the system. Builders also need a preflight layer that decides when an agent is allowed to spend and records why.

AgentPay Guard is built around USDC payment intents and preview-only Circle / Arc rail objects. It does not call live Circle Gateway APIs or Arc services. The point of this MVP is to prove the safety and audit layer that should sit before those rails in a future integration.

## Demo Flow

1. Open the local demo.
2. Run the built-in Ignyte / Circle / Arc preset.
3. The agent selects paid API, data, and telemetry sources for a research workflow.
4. Each selected source maps to a Guard-compatible USDC payment intent.
5. Guard evaluates the intents and returns:
   - trusted x402 verification API: `ALLOW`;
   - premium evidence bundle: `REVIEW`;
   - untrusted scrape cache: `BLOCK`;
   - telemetry attestation note: `REVIEW`.
6. The UI shows proposed spend, allowed spend, matched rules, audit IDs, preview-only rail metadata, and an AgentPay Receipt for the selected evaluated intent.
7. The audit log shows JSONL evidence for successful evaluations.

## What Is Implemented

- Next.js / TypeScript local demo.
- `POST /api/payment-intents/evaluate`.
- `GET /api/audit-log`.
- Deterministic request validation.
- Decimal-string USDC amount handling.
- Policy decisions for `ALLOW`, `REVIEW`, and `BLOCK`.
- Recipient, scenario, amount, daily-limit, velocity, currency, and suspicious-keyword rules.
- JSONL audit records at `data/audit-log.jsonl`.
- Idempotency by `idempotencyKey`.
- Typed rail preview adapter for mock x402, mock Circle Gateway-style nanopayment, Arc settlement preview, and local agent-wallet preview modes.
- AgentPay Receipt proof artifact for every evaluated spend intent, in both human-readable and JSON form.
- UI preset that demonstrates allowed, reviewed, and blocked payment intents.
- Tests for policy decisions, invalid inputs, idempotency, audit payload shape, rail preview behavior, and safe failure posture.

## What Is Preview / Mock Only

- x402 flow is represented as a local preview object only.
- Circle Gateway-style nanopayment is represented as a local preview object only.
- Arc settlement is represented as a local preview object only.
- Agent wallet behavior is represented as a local preview object only.
- Unknown or future rails resolve to `executionMode: "live_disabled"` instead of pretending a live integration exists.

## Safety Boundaries

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

The MVP returns policy decisions and audit evidence. Payment execution remains outside the current scope.

## Validation

Repository validation commands:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Expected result for the submitted commit: all four commands pass.

The project also keeps the product boundary visible in docs and UI copy: preview-only rails, no fund movement, no signing, no private keys, and no fabricated transaction hashes.

## Roadmap

- Add an operator review queue for `REVIEW` decisions.
- Add a policy editor and audit export flow.
- Add production hardening for auth, rate limits, persistence, and distributed audit writes.
- Add a buyer-side x402 or Circle Gateway sandbox adapter only after explicit scope approval.
- Explore Arc-compatible settlement integration only after wallet, signing, custody, and execution boundaries are designed and reviewed.

## Repo URL

https://github.com/KirillNedoboy/agentpay-guard-circle-arc
