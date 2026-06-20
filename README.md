# CitePay Agent

> A local paid-source demo where an AI agent selects premium source cards, turns them into payment intents, and evaluates them through AgentPay Guard before any payment rail is used.

## What this project is

CitePay Agent is the **Lepton / Arc-facing demo branch** of AgentPay Guard.

It shows a concrete agent workflow:

1. an agent needs premium or creator-owned sources for an answer;
2. it selects relevant mock paid sources;
3. each selected source becomes a normal payment intent;
4. AgentPay Guard evaluates that intent as `ALLOW`, `REVIEW`, or `BLOCK`;
5. the decision is written to a local JSONL audit log.

This repo is a **local deterministic MVP and proof pack**. It demonstrates the policy-and-audit layer that can sit **before** future Arc / Circle / x402-style payment rails.

## Why this matters

AI agents may need to access premium research, creator-owned data, telemetry, or paid APIs.

But before an agent moves toward payment, builders need a deterministic preflight layer that can answer:

- is this recipient trusted?
- does the amount fit policy?
- does the scenario match allowed usage?
- does the intent require review?
- is there a usable audit trail?

CitePay Agent demonstrates that control point.

## What is implemented now

### User-facing demo
- built-in CitePay / Lepton preset query;
- built-in budget of `0.24 USDC`;
- mock premium source cards;
- deterministic source selection;
- proposed spend versus allowed spend summary.

### Guard integration
- selected sources are converted into normal AgentPay Guard payment intents;
- each intent is evaluated through `POST /api/payment-intents/evaluate`;
- decisions return `ALLOW`, `REVIEW`, or `BLOCK`;
- append-only JSONL audit logging with idempotency is preserved.

### Proof-pack assets
- screenshots for preset-loaded state, decisions, and spend summary;
- Lepton-specific submission notes and video script in `docs/`.

## What is explicitly not implemented

This branch does **not** implement:

- real payment settlement;
- wallet signing;
- live Arc integration;
- live Circle Gateway integration;
- live x402 buyer or seller flows;
- custody or private key handling;
- DB / auth;
- smart contracts;
- creator payouts;
- production fraud, AML, or compliance guarantees.

This is a **payment-intent guard demo**, not a live payment product.

## Demo flow

### Preset query

```txt
Need weather risk, climate claims, telemetry attestation, and private scrape cache context for an insurance answer
```

### Preset budget

```txt
0.24 USDC
```

### Expected demo behavior

- `Weather risk brief` -> `ALLOW`
- `Climate claims dataset` -> `REVIEW`
- `Blocked scrape cache` -> `BLOCK`
- `Telemetry attestation note` -> `REVIEW`
- `Market data note` -> `not_relevant`

### Spend summary

- proposed spend: `0.24 USDC`
- allowed spend: `0.08 USDC`

## Architecture in one screen

```txt
Agent workflow
  -> source selection
  -> payment intent creation
  -> AgentPay Guard policy evaluation
  -> ALLOW / REVIEW / BLOCK
  -> JSONL audit record
  -> future payment rail only if allowed
```

## Main API

```http
POST /api/payment-intents/evaluate
```

Typical response fields include:

- `decision`
- `riskScore`
- `reason`
- `matchedRules`
- `policyId`
- `auditId`
- `createdAt`

## Repository structure

```txt
src/                         app, UI, API, guard logic
examples/                    sample payment-intent scenarios
data/policies.default.json   default policy config
data/audit-log.jsonl         local append-only audit log
docs/                        proof-pack, Lepton notes, scripts
screenshots/                 demo evidence
```

## Demo scenarios

- `examples/scenario-allow-api.json` -> `ALLOW`
- `examples/scenario-review-machine.json` -> `REVIEW`
- `examples/scenario-block-risky.json` -> `BLOCK`

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

## Screenshots

- [`screenshots/05-citepay-preset-loaded.png`](screenshots/05-citepay-preset-loaded.png)
- [`screenshots/06-citepay-guard-decisions.png`](screenshots/06-citepay-guard-decisions.png)
- [`screenshots/07-citepay-spend-summary.png`](screenshots/07-citepay-spend-summary.png)

## Lepton / Arc fit

This project fits Lepton as a **builder-facing proof for agentic paid-source selection plus payment-intent safety**.

The core thesis is simple:

> Agents may need to choose and pay for credible sources. CitePay Agent shows how those paid-source intents can be evaluated and audited before any payment rail is used.

That makes the repo relevant to:

- agent payments;
- paid APIs / premium retrieval;
- source monetization;
- deterministic control layers before autonomous spend;
- future Arc-native stablecoin workflows.

## Recommended judge reading order

1. `README.md`
2. `docs/lepton-submission-draft.md`
3. `docs/lepton-demo-video-script.md`
4. `docs/proof-pack-checklist.md`
5. `docs/architecture.md`

## Related docs

- [`docs/lepton-citepay-brief.md`](docs/lepton-citepay-brief.md)
- [`docs/lepton-form-answers.md`](docs/lepton-form-answers.md)
- [`docs/lepton-submission-draft.md`](docs/lepton-submission-draft.md)
- [`docs/lepton-demo-video-script.md`](docs/lepton-demo-video-script.md)
- [`docs/proof-pack-checklist.md`](docs/proof-pack-checklist.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/citepay-demo-script.md`](docs/citepay-demo-script.md)

## Roadmap after the hackathon MVP

Potential safe next steps:

1. publish the submission proof pack;
2. add a buyer-side adapter for a real future payment rail;
3. add an operator review queue for `REVIEW` decisions;
4. add policy editing and exportable audit reports;
5. add webhook examples for agent frameworks.

Live payment execution remains future work.
