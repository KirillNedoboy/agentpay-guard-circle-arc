# Circle Grants 2026 — Grant Requirements (Phase 0)

Canonical grant source of truth: [`docs/circle-grants-package.md`](../../circle-grants-package.md).
Linked product docs (not duplicated here): [README](../../../README.md),
[REQUIREMENTS](../../../docs/internal/REQUIREMENTS.md),
[ROADMAP](../../../docs/internal/ROADMAP.md),
[architecture](../../../docs/architecture.md),
[integration status](../../../docs/integration-status.md),
[audit log schema](../../../docs/audit-log-schema.md),
[decision rules](../../../docs/decision-rules.md),
[reconciliation report](../../../docs/reconciliation-report.md).

## Grant objective

Pre-pilot infrastructure grant: a deterministic policy-and-audit control plane for
proposed autonomous USDC payments. Policy before execution; evidence after every
decision. The deliverable is the guard layer that decides `ALLOW` / `REVIEW` / `BLOCK`
and records audit evidence before any future settlement adapter — it is not a payment
rail.

## Product thesis

Autonomous AI agents can request paid data or API access quickly. Before a future
payment adapter executes, the system needs a deterministic, explainable, recorded
answer: is this proposed spend within policy? AgentPay Guard supplies that preflight
decision, a spend-control envelope, and append-only audit evidence, without pretending
to be the rail itself.

## Current reusable capabilities (VERIFIED)

From the VERIFIED list in [`docs/circle-grants-package.md`](../../circle-grants-package.md):

- Deterministic `ALLOW` / `REVIEW` / `BLOCK` engine, `BLOCK` > `REVIEW` > `ALLOW`
  precedence, stable matched rules and reason codes.
- Decimal-string `BigInt` money handling; spend controls (per-request limit, daily
  allowed/remaining/projected spend, velocity).
- Append-only JSONL audit with idempotency by `idempotencyKey`.
- AgentPay Receipt with `fundsMoved: false`.
- Local Arc adapter preview: `broadcast: false`, `status: "not_executed"`.
- CCTP route, ERC-20 authority, and Paymaster proposal-only previews.
- x402-style judge preset (trusted `0.08 USDC` API intent).
- CI workflow (test/lint/typecheck/build), deterministic fixtures, 147 tests passing.

## Candidate future grant capabilities (candidate, not committed)

- ExecutionAuthorization envelope — a typed, replayable authorization boundary between
  policy decision and any future adapter execution.
- Replay and policy-drift evidence — deterministic re-evaluation of past decisions
  against current policy to surface drift.
- Adapter prepare/simulate boundary — explicit separation of preview preparation from
  execution.
- Pilot observability — latency, reproducibility, integration-time, and policy-gap
  metrics.

These are candidates for later phases, not commitments of the current product.

## Required evidence

- Deterministic fixtures for ALLOW / REVIEW / BLOCK scenarios.
- Append-only audit trail with idempotent replay.
- Replayable decisions: the same intent must produce the same decision.
- Later (pilot phase) latency and decision-reproducibility measurements — not yet
  produced.

## Safety constraints (non-negotiable)

- No funds movement, custody, private keys, signing, wallets, UserOperations, RPC,
  CCTP burn/mint, Iris verification, live settlement, or transaction hashes.
- `ALLOW` never means funds moved; it only means a separately authorised future adapter
  could be considered.
- No claim of official Circle/Arc/x402 partnership or production execution.

## VERIFIED / PROPOSED / NOT YET VALIDATED

- VERIFIED: facts directly supported by current code, tests, and assets (see the
  package doc).
- PROPOSED: future pilot targets (partners, intent volumes, metrics, testnet work,
  budget).
- NOT YET VALIDATED: external facts — live-demo availability and parity with `main`,
  video/MP4 parity with the x402-first path, grant program requirements, deadlines,
  budget amounts, form specifics, partnership status. For any grant-program
  requirement not stated here, verify against official sources.
