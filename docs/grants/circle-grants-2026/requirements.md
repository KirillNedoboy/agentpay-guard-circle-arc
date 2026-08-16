# Circle Grants 2026 — Grant Requirements

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
- CI workflow (test/lint/typecheck/build), deterministic fixtures; test suite on the
  grant branch: 20 test files / 270 tests, all passing (verified run 2026-08-14).

## Implemented on the grant track (Phases 1–7, VERIFIED)

Capabilities added after the stable main baseline `eb28fe7…` on branch
`grant/circle-grants-pilot-2026` (Phases 1–7; commit range 46cfbab…068c579). The
per-phase evidence records live in the [canonical package](../../circle-grants-package.md);
a compiled evidence index is assembled in [evidence.md](./evidence.md) (Phase 8,
commit `09b400f`).

- ExecutionAuthorization envelope (Phase 2, commit b3aa97e) — typed, deterministic,
  ALLOW-only authorization boundary between policy decision and any future adapter
  execution; literal `["prepare","simulate"]` scope, `not_executed`,
  `fundsMoved: false`.
- Replay and policy-drift evidence (Phase 3, commit f5ad45d) — deterministic
  `intentFingerprint`, explicit `replayed` signal, and `ReplayEvidence`
  (mismatch / drift / unknown) comparing stored evidence vs the current evaluation.
- Adapter prepare/simulate boundary — the authorization scope is exactly
  `["prepare","simulate"]`; the local Arc adapter preview stays `broadcast: false`,
  `status: "not_executed"` (Phases 2–3, verified again in Phase 7 threat model).
- Pilot observability (Phase 5, commit 25630d4) — local, privacy-safe
  evaluation-observation log and deterministic `PilotMetricsSummary` (p95 policy
  evaluation latency, replay counters, policy-gap signals, evidence coverage) via
  read-only `GET /api/pilot-metrics`.
- Canonical ALLOW / REVIEW / BLOCK / REPLAY scenario fixtures (Phase 4, commit
  da282ff) and the judge-first evidence UI (Phase 6, commit 65d9ef8) presenting the
  evidence above to reviewers.
- Threat-model verification (Phase 7, commit 068c579) — internal engineering
  verification of the no-execution boundary; NOT an independent external security
  audit.

## Future grant capabilities (candidate, not committed)

- External pilot with design partners and proposed payment intents.
- Authenticated agent identity model (self-asserted `agentId` is a documented
  residual risk today).
- Production durability — cross-process idempotency, tamper-evident audit, and
  rate limiting / auth before any public deployment.
- Execution-adapter security gates — the 14 unchecked future-execution
  preconditions in the threat model before any adapter may move funds.
- Controlled testnet funds movement — proposal only; requires separate
  authorization.

These remain candidates for later phases, not commitments of the current product.

## Required evidence

- Deterministic fixtures for ALLOW / REVIEW / BLOCK scenarios (VERIFIED, Phase 4).
- Append-only audit trail with idempotent replay (VERIFIED).
- Idempotent replay consistency: exact replay of the same validated intent returns
  the persisted decision and evidence (same `auditId`, no duplicate line). This is
  replay of a stored decision — it is NOT independent re-execution of historical
  policy state.
- Policy evaluation latency (p95) and replay-consistency measurements (VERIFIED,
  Phase 5, from the local observation log via `GET /api/pilot-metrics`).
- Independent decision reproducibility (re-running historical policy to reproduce
  past decisions) — NOT produced; remains a PROPOSED pilot protocol.

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
- NOT YET VALIDATED: external facts — live-demo availability and parity with the
  grant branch, video/MP4 parity with the x402-first path, grant program
  requirements, deadlines,
  budget amounts, form specifics, partnership status. For any grant-program
  requirement not stated here, verify against official sources.
