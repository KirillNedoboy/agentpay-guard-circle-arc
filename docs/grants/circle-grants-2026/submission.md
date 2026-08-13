# Circle Grants 2026 — Grant Application Draft

**DRAFT — not proof that an application was submitted.** This document is a draft
of a proposed grant application for the Circle Grants pilot track. Nothing in this
document was submitted to Circle; all future pilot activity described here is
proposed only. External grant-program facts are NOT YET VALIDATED and must be
checked against the official current grant source before any submission.

# One-line description

AgentPay Guard is a deterministic policy-and-audit control plane for proposed autonomous USDC payments, enforcing spend controls before any future settlement adapter.

# Problem

Autonomous AI agents increasingly request paid data and API access without a human
reviewing every step. Before any payment rail executes, the system needs a
deterministic, explainable, recorded answer to one question: *is this proposed
spend within policy?* Without such a preflight layer, an agent's accidental,
duplicated, or out-of-policy payment request reaches the settlement path
unchecked, and there is no replayable evidence of what was decided and why.

# Solution

AgentPay Guard is a preflight policy-and-audit control plane for **proposed**
autonomous USDC payments. It evaluates each validated payment intent and returns a
deterministic `ALLOW` / `REVIEW` / `BLOCK` decision before any execution exists,
records one canonical audit record per idempotency key, and — for `ALLOW` — issues
a bounded `ExecutionAuthorization` that a separately authorized future adapter
could consume. Policy is evaluated before execution; evidence is recorded after
every decision.

# Why USDC / machine payments

USDC is the natural asset for machine-to-machine payments: it is stable (no
volatility for fixed API fees), standard (broad chain and rail support), and
settles programmatically. Machine payments need deterministic, explainable policy
and auditable evidence more than humans do — humans can ask questions; agents
cannot. A guard layer that decides and records *before* the rail is the missing
control point, and it can be built and verified without moving a single cent.

# What exists today

Only verified capabilities are listed (see [evidence.md](./evidence.md)):

- deterministic `ALLOW` / `REVIEW` / `BLOCK` engine with `BLOCK` > `REVIEW` >
  `ALLOW` precedence and stable reason codes;
- decimal-safe spend controls (per-request, daily, velocity) using BigInt money
  arithmetic — no floating-point money math;
- `policyVersion` and deterministic `policyFingerprint` attribution on every
  record;
- deterministic `intentFingerprint` binding the validated intent;
- append-only local canonical audit evidence (one record per idempotency key);
- AgentPay Receipt with `fundsMoved: false` and `executionStatus: "not_executed"`;
- `ExecutionAuthorization` envelope (single-intent, prepare/simulate-only,
  not executed);
- exact replay evidence (same key → same audit context, same deterministic
  authorization, one canonical record);
- mismatch and policy-drift detection on replay;
- authorization suppression on unsafe replay or policy drift (fail-closed);
- local pilot observability (observation log + read-only metrics endpoint);
- canonical ALLOW / REVIEW / BLOCK / REPLAY scenarios as fixtures and tests;
- judge-first UI presenting all of the above;
- threat model (internal engineering review) plus a 22-test security regression
  suite.

**No funds move. No settlement occurs.** Nothing in the repository signs,
broadcasts, submits transactions, or touches a blockchain.

# Technical architecture

A concise flow: typed `PaymentIntent` → deterministic policy engine → canonical
audit evidence → replay/authorization evidence → observability → judge UI.

1. Incoming request JSON is validated into a typed `PaymentIntent`
   (`src/domain/payment-intent/validation.ts`); unknown fields are ignored.
2. The deterministic policy engine (`src/domain/policy/engine.ts`) applies
   decimal-safe spend controls and returns `ALLOW` / `REVIEW` / `BLOCK` with
   stable reason codes.
3. One canonical audit record per `idempotencyKey` is appended, carrying
   `policyVersion`, `policyFingerprint`, `intentFingerprint`, and
   `executionStatus: "not_executed"`.
4. Replay evidence compares stored vs current fingerprints; mismatch or policy
   drift suppresses authorization. On clean replay or first `ALLOW`, a bounded
   `ExecutionAuthorization` is derived from the persisted record.
5. Pilot observability (`src/domain/observability/`) records privacy-minimal
   evaluation observations and serves `GET /api/pilot-metrics`.
6. The judge-first UI (`src/app/demo-client.tsx`) presents evidence, replay
   status, authorization, and metrics. See [evidence.md](./evidence.md) for the
   full proof index.

# Deterministic evidence

See [evidence.md](./evidence.md) for the complete reviewer-readable proof index.
Key invariants:

- intent and policy fingerprints are SHA-256 over a key-sorted stable-JSON
  canonical form (`src/lib/stable-json.ts`);
- exactly one canonical audit record per idempotency key, in-process;
- replay mismatch or policy drift → no authorization;
- `ExecutionAuthorization` is derived only from the persisted audit record and
  current policy — never from the raw request.

Exact replay demonstrates idempotent replay consistency with the persisted
decision/evidence; it is not "independent decision reproducibility", which is a
proposed pilot protocol only.

# Safety boundary

- No wallet, no signing, no broadcast, no settlement, no custody. `fundsMoved:
  false` everywhere; the local Arc adapter preview is `broadcast: false` /
  `status: "not_executed"`.
- `ExecutionAuthorization` is **bounded evidence for a future adapter** — an
  explicit boundary, not an executable capability or bearer token.
- The local filesystem is an explicit **trust assumption**: policy JSON, audit
  JSONL, and observation JSONL are not tamper-evident and not remotely attested.
  "Append-only" is a writer-level convention enforced in-process only.
- Authorization expiry (`expiresAt = issuedAt + 300s`) is **metadata only** —
  there is no runtime enforcement; a future adapter must enforce it itself.
- Full analysis: [limitations.md](./limitations.md) and
  [threat-model.md](./threat-model.md).

# Pilot hypothesis

> Agent builders and API providers may adopt a deterministic pre-spend policy
> layer if it reduces accidental autonomous spending, makes decisions
> explainable, and produces replayable audit evidence without requiring custody.

This is a **hypothesis, not validated traction**. No partners, pilot usage, or
adoption exist yet.

# Proposed pilot

Proposed targets only — not commitments, and no partners are named:

- 3–5 design partners;
- 100–500 proposed payment intents evaluated during the pilot;
- a 12-week pilot structure.

# Proposed milestones

The proposed 12-week structure is:

- Weeks 1–2: design-partner discovery and integration requirements;
- Weeks 3–4: integration hardening around validated payment-intent contract;
- Weeks 5–7: partner sandbox / controlled proposed-intent evaluation;
- Weeks 8–9: policy-gap analysis and replay/evidence review;
- Weeks 10–11: integration feedback and security-boundary refinement;
- Week 12: pilot report and next-stage recommendation.

**No week has happened.** Every milestone above is a proposal for a future pilot.

# Proposed metrics

**SYSTEM-DERIVED TODAY** (produced from the local logs; see
[pilot-observability.md](./pilot-observability.md)):

- canonical intent count;
- ALLOW / REVIEW / BLOCK counts;
- evaluation attempt count;
- replay count;
- exact replay count;
- mismatch count;
- policy-drift observations;
- policy-evaluation p95 (nearest-rank);
- policy-gap reason-code signals;
- evidence-attribution coverage (intent/policy fingerprint, policy version).

**PROPOSED / MANUAL PILOT MEASURES** (require the pilot; not measured today):

- design-partner count;
- integration time;
- structured partner feedback;
- policy gaps requiring new rules;
- adoption willingness;
- independent decision reproducibility (a defined protocol — distinct from exact
  replay consistency, which the system already measures).

# Current limitations

Concise summary; full detail in [limitations.md](./limitations.md) and
[threat-model.md](./threat-model.md):

- no execution, settlement, or custody of any kind (by design);
- no authenticated agent identity (`agentId` is self-asserted);
- no immutable audit storage (append-only JSONL by application convention,
  in-process only, not tamper-evident);
- authorization expiry is metadata only (no runtime enforcement);
- no cross-process concurrency control.

# What grant funding would enable

Proposed use categories (no dollar amounts; budget is TBD):

- engineering/integration work on the validated payment-intent contract and
  adapter boundary;
- security hardening (tamper-evident audit options, authenticated identity,
  expiry enforcement as execution preconditions);
- pilot support (partner onboarding, sandbox operation, evidence review);
- documentation and developer experience (integration guides, fresh-clone
  reproducibility);
- controlled testnet research **only if separately authorized** — none is
  authorized today.

# Evidence links

- [evidence.md](./evidence.md) — proof index
- [threat-model.md](./threat-model.md) — internal engineering threat-model
  verification
- [canonical-scenarios.md](./canonical-scenarios.md) — canonical scenario set
- [pilot-observability.md](./pilot-observability.md) — metric definitions
- [roadmap.md](./roadmap.md) — phase plan
- [limitations.md](./limitations.md) — explicit boundaries
- [circle-grants-package.md](../../circle-grants-package.md) — package source of
  truth (VERIFIED / PROPOSED / NOT YET VALIDATED)
- [README](../../../README.md) — product overview and safety boundary

# Fields still requiring external/user input

- Official current grant-program requirements — **NOT YET VALIDATED**: deadline,
  max amount, required chain, form fields, eligibility, review process, decision
  dates. Verify against the official current grant source before any submission.
- Applicant-specific fields (entity name, contact, links, wallet, statement) —
  require user input.
- Budget amount — TBD (grant-program constraints + applicant decision).
- Design-partner commitments — none exist; require future confirmation.
- Pilot scope confirmation — the 3–5 partners / 100–500 intents / 12-week
  targets require applicant confirmation.
- Deploy/media/screenshot parity decisions — current deployed demo and video
  parity with this branch are NOT YET VALIDATED; Phase 6 grant-evidence
  screenshots are pending.
