# Circle Grants Package — AgentPay Guard

## 1. Grant track

- Grant track: Circle Grants / pre-pilot infrastructure grant
- Repository: https://github.com/KirillNedoboy/agentpay-guard-circle-arc
- Canonical baseline commit: `eb28fe7973cdd3d770de155556c23ee214c6ef33`
- Date: 2026-08-13
- Working branch: `grant/circle-grants-pilot-2026` (grant development track; no PR opened)

This package describes a proposed pre-pilot infrastructure grant: a deterministic
policy-and-audit control plane for autonomous USDC payment intents. Policy is evaluated
before execution; evidence is recorded after every decision. Nothing in this repository
moves funds.

Canonical product documentation (linked, not duplicated):

- [README](../README.md) — product overview, reviewer path, safety boundary
- [REQUIREMENTS.md](../docs/internal/REQUIREMENTS.md) — product and policy requirements
- [ROADMAP.md](../docs/internal/ROADMAP.md) — existing MVP and post-MVP milestones
- [Architecture](../docs/architecture.md) — canonical flow and protocol-context boundary
- [Integration status](../docs/integration-status.md) — per-context implemented behavior
- [Audit log schema](../docs/audit-log-schema.md) — JSONL record shape
- [Decision rules](../docs/decision-rules.md) — rule precedence and reason codes
- [Reconciliation report](../docs/reconciliation-report.md) — canonical history and release actions

## 2. VERIFIED

Facts below are directly supported by the current code, tests, and assets on this
baseline (`eb28fe7973cdd3d770de155556c23ee214c6ef33`):

- Deterministic `ALLOW` / `REVIEW` / `BLOCK` engine with `BLOCK` > `REVIEW` > `ALLOW`
  precedence, stable matched-rule names and reason codes
  ([`src/domain/policy/engine.ts`](../src/domain/policy/engine.ts),
  [decision rules](../docs/decision-rules.md)).
- Decimal-string `BigInt` money handling; no JavaScript floating-point arithmetic in
  money decisions ([`src/domain/policy/spend-controls.ts`](../src/domain/policy/spend-controls.ts)).
- Spend controls: per-request limit, daily allowed/remaining/projected spend, and
  velocity count persisted on new audit records.
- Append-only JSONL audit log with idempotent reuse by `idempotencyKey`
  ([`src/domain/audit/audit-log.ts`](../src/domain/audit/audit-log.ts),
  [audit log schema](../docs/audit-log-schema.md)).
- AgentPay Receipt with `fundsMoved: false`
  ([`src/domain/payment-intent/receipt.ts`](../src/domain/payment-intent/receipt.ts)).
- Local Arc adapter preview with `broadcast: false` and `status: "not_executed"`
  ([`src/domain/payment-intent/arc-testnet-simulation.ts`](../src/domain/payment-intent/arc-testnet-simulation.ts)).
- CCTP route, ERC-20 authority, and USDC Paymaster proposal-only previews with
  deterministic local rules ([integration status](../docs/integration-status.md)).
- x402-style judge preset: trusted `0.08 USDC` API micropayment intent
  ([`src/domain/payment-intent/judge-preset.ts`](../src/domain/payment-intent/judge-preset.ts)).
- CI workflow runs test, lint, typecheck, and build on push to `main` and pull requests
  (`.github/workflows/ci.yml`).
- Deterministic fixtures under `examples/` (CCTP, ERC-20, Paymaster, x402, machine,
  risky-block scenarios). Test suite on this branch: 19 files / 248 tests + 22 new
  security-boundary tests (`tests/security-boundaries.test.ts`) = 20 files / 270
  tests, all passing (verified run 2026-08-14; lint, typecheck, and build also
  pass).
- Phase 1 typed evidence baseline (commit `feat: add versioned policy evidence`):
  explicit `policyVersion` (`"1"`) on `PolicyConfig` and `data/policies.default.json`;
  deterministic `policyFingerprint` — `sha256:<64 hex>` of the canonicalized policy
  (recursively key-sorted SHA-256, array order and values preserved, computed at
  evaluation time, never stored in the policy file, same content always hashes equal,
  any value change changes the hash) via
  [`src/domain/policy/policy-fingerprint.ts`](../src/domain/policy/policy-fingerprint.ts);
  every `PolicyDecision` carries `policyId` + `policyVersion` + `policyFingerprint`;
  new audit records persist all three plus explicit top-level
  `executionStatus: "not_executed"`; legacy JSONL lines normalize in memory to
  `policyVersion: null` / `policyFingerprint: null` / `executionStatus: "not_executed"`
  with no historical fingerprint fabricated and no rewrite of `data/audit-log.jsonl`
  (byte-identical); `AgentPayReceipt` exposes `executionStatus: "not_executed"` with
  `fundsMoved: false`; successful `EvaluationResponse` sources these fields from the
  persisted audit record so idempotent reuse reflects stored evidence; failure
  responses carry honest `null` / `"not_executed"` evidence. Validation after Phase 1:
  14 test files / 162 tests, lint, typecheck, build, and `git diff --check` all passing.
- Phase 2 ExecutionAuthorization envelope (commit `feat: add execution authorization
  envelope`): deterministic, typed, ALLOW-only `ExecutionAuthorization`
  (`src/domain/authorization/execution-authorization.ts`) built purely from the
  normalized persisted audit record + current policy config; exact single-intent
  binding (`maxAmountUSDC` equals the proposed amount, never the per-payment policy
  cap; recipient/agentId from the persisted audit); deterministic `auth_<64 hex>`
  SHA-256 id bound to immutable envelope identity (no randomness, no wall clock);
  `issuedAt` from the persisted audit timestamp and `expiresAt` from
  `policy.authorization.ttlSeconds` (300s local preview setting — not claimed as a
  Circle/security standard); `executionScope` exactly `["prepare", "simulate"]`,
  `executionStatus: "not_executed"`, `fundsMoved: false`; programmable payment
  context carried when persisted; legacy records without policy attribution produce
  no authorization; exposed as optional `EvaluationResponse.executionAuthorization`
  (absent on REVIEW/BLOCK/failures); nothing persisted to JSONL. Active
  `policyVersion` is now `"2"` (`policyId` unchanged). Validation after Phase 2:
  15 test files / 180 tests, lint, typecheck, build, and `git diff --check` all
  passing; historical `data/audit-log.jsonl` byte-identical.
- Phase 3 replay and policy-drift evidence (commit `feat: add replay and policy
  drift evidence`): deterministic `intentFingerprint` (`sha256:<64 hex>` over the
  validated intent; key order irrelevant, array order significant) persisted on
  new audit records, `null` on legacy records via in-memory normalization only
  (historical JSONL byte-identical, no reconstruction); explicit `replayed` signal
  from the audit writer (same `idempotencyKey` still creates at most one original
  line); `ReplayEvidence` in every successful response (`replayed`,
  `replayMismatch`, `policyChanged`, stored/current fingerprints) comparing
  stored evidence vs the current evaluation; policy drift reported when stored
  `policyVersion` or `policyFingerprint` differs from the current loaded policy,
  and `null` (unknown, not fabricated) when stored attribution is missing;
  mismatched replay preserves the stored decision as historical evidence without a
  duplicate line; ExecutionAuthorization is issued only when replay evidence shows
  no intent mismatch and no policy change, and the builder rejects stored records
  with missing attribution or a changed current policy. Stable-JSON
  canonicalization extracted to `src/lib/stable-json.ts` and shared by policy and
  intent fingerprints (policy fingerprint output verified byte-identical to
  Phase 2). Validation after Phase 3: 16 test files / 204 tests, lint, typecheck,
  build, and `git diff --check` all passing; `data/policies.default.json`
  (`policyVersion: "2"`, unchanged), `package.json`, `pnpm-lock.yaml`, and
  historical `data/audit-log.jsonl` byte-identical.
- Phase 4 canonical scenario set (commit `test: add canonical grant scenarios`):
  canonical ALLOW / REVIEW / BLOCK decision fixtures
  (`examples/scenario-allow-api.json`, `scenario-review-machine.json`,
  `scenario-block-risky.json`) explicitly evaluated at policy-engine level and
  end-to-end through `evaluatePaymentIntent`; canonical deterministic REPLAY proof —
  the same validated intent evaluated twice on an isolated temp audit log yields the
  same `auditId`, the same deterministic `authorizationId`, `replayed: true` with no
  mismatch or policy change, exactly one JSONL record, and `not_executed` /
  `fundsMoved: false` throughout; replay descriptor
  `examples/scenario-replay.json` is metadata only and never a payment intent.
  Documented in
  [canonical-scenarios.md](../docs/grants/circle-grants-2026/canonical-scenarios.md).
  These are deterministic product evidence fixtures, not pilot usage. Validation
  after Phase 4: 17 test files / 212 tests, lint, typecheck, build, and
  `git diff --check` all passing; no source, policy, or UI changes.
- Phase 5 minimal pilot observability (commit `feat: add minimal pilot
  observability`): privacy-safe local observability with no external telemetry,
  databases, or queues — two evidence layers: the canonical audit log (unchanged,
  one record per idempotency key) plus an append-only evaluation-observation log
  (one line per successful validated evaluation including idempotent replays;
  references the canonical decision only by `auditId`, never raw intent/recipient/
  agent/amount); `policyEvaluationDurationMs` from monotonic `performance.now()`
  around `evaluatePolicy` only; a failed observation append never changes the
  persisted decision or authorization (`pilotObservability.observationRecorded:
  false` reported honestly); deterministic `PilotMetricsSummary` (canonical
  decision/reason-code/gap/coverage counts from audit records; attempt, replay
  exact/mismatch/drift/unknown, authorization-issued counters and nearest-rank p95
  from observations); read-only `GET /api/pilot-metrics`. Documented in
  [pilot-observability.md](../docs/grants/circle-grants-2026/pilot-observability.md)
  with SYSTEM-DERIVED NOW vs NOT AUTOMATICALLY MEASURED explicitly separated and a
  statement that exact replay consistency is not independent decision
  reproducibility (that pilot target remains PROPOSED). Validation after Phase 5:
  19 test files / 227 tests, lint, typecheck, build, and `git diff --check` all
  passing; policy config, dependencies, and historical audit log untouched; no
  pilot usage claimed from local tests.
- Phase 6 judge-first UI delta (commit `feat: surface grant evidence in judge UI`):
  presentation-only — reviewer-visible exact replay evidence ("First evaluation" /
  "Exact replay" / mismatch / drift / legacy states) driven by the real API
  `replayEvidence`; reviewer-visible bounded ExecutionAuthorization panel
  (`single_intent` scope, maximum amount equal to the proposed amount,
  `prepare + simulate only`, `not_executed`, `fundsMoved: false`) with an explicit
  safety line and honest no-authorization states; explicit policy attribution
  (policy ID, version, deterministic shortened fingerprint with full value in
  title/aria); explicit not-executed presentation; local/demo pilot metrics panel
  (canonical intents, attempts, decision counts, replay counters, p95, gap signals,
  coverage) with a "Local/demo evidence only — not partner traction or production
  usage" qualifier; "Replay exact intent" action that re-submits an immutable
  snapshot of the last successfully evaluated intent (same idempotency key).
  Verified in a live production-server + automated-browser session (x402-first
  reviewer flow, replay idempotency across repeated clicks, REVIEW/BLOCK
  no-authorization states, 1440 px and 390 px no-overflow responsive states).
  No live pilot usage, users, customers, design partners, production traffic, or
  settlement is claimed — those remain PROPOSED / NOT YET VALIDATED. Validation
  after Phase 6: 19 test files / 248 tests, lint, typecheck, build, and
  `git diff --check` all passing; no domain/backend or policy changes.
- Phase 7 threat-model verification (docs-only change): documented engineering
  threat model at
  [threat-model.md](../docs/grants/circle-grants-2026/threat-model.md) covering 21
  threat classes (T01–T15 + ADD-1..ADD-6), each with a verified control, status,
  and residual risk, cited to source lines. Verified controls include
  replay/mismatch/policy-drift authorization suppression (an authorization is
  issued only when `replayMismatch === false && policyChanged === false`), exact
  single-intent recipient/amount binding (`maxAmountUSDC` = persisted proposed
  amount), prepare/simulate-only authorization scope (literal
  `["prepare","simulate"]`, `not_executed`, `fundsMoved: false`), legacy
  fail-closed behavior, decimal-safe spend limits, and in-process audit write
  locking. Explicit residual-risk register (audit log not tamper-evident; expiry
  metadata-only with no runtime enforcement; no cross-process concurrency
  control; no authenticated agent identity; policy fingerprint proves content
  identity, not authenticity) and a 14-item future execution security
  precondition checklist, all unchecked because no execution adapter exists.
  This is an **internal engineering threat-model verification, NOT an
  independent external security audit** — no claim of "production secure",
  "fully audited", "formally verified", "penetration tested", or "compliant" is
  made. Security regression suite `tests/security-boundaries.test.ts`
  (22 tests, all passing) brings the suite to 19 files / 248 tests + 22 new
  security-boundary tests = 20 files / 270 tests total; docs only — `src/`,
  `data/`, `package.json`
  untouched.

## 3. PROPOSED

Future grant/pilot targets only. None of these are current traction:

- 3–5 design partners for a 12-week pilot (target).
- 100–500 proposed payment intents evaluated during the pilot (target).
- Pilot metrics: policy decision latency, decision reproducibility (same intent, same
  decision), integration time for a new policy context, and policy-gap signals from
  REVIEW/BLOCK outcomes (target).
- Future controlled testnet work (proposal only; requires separate authorization).
- Proposed grant budget (proposal only; amount to be defined with the grant program —
  verify against official sources).

Every item above is a target or proposal, not a current achievement.

## 4. NOT YET VALIDATED

External facts requiring verification:

- Current live-demo availability at https://138-124-108-146.nip.io — probed on
  2026-08-13 with a short-timeout HTTP request: returned HTTP 200. Availability is
  time-dependent; re-verify before any submission.
- Whether the deployed demo matches current `main` — cannot be confirmed from this
  repository. The README states the deployed baseline predates the x402-first screen.
- Whether the YouTube/MP4 walkthroughs match the x402-first reviewer path — the media
  is preserved as an earlier CitePay-led walkthrough; it has not been re-recorded.
- Design partners, actual pilot usage, grant acceptance, and external integrations —
  none exist yet; verify against official sources when claimed.

## 5. Product safety boundary

AgentPay Guard does not: move funds; hold custody; store private keys; sign
transactions; connect wallets; submit UserOperations; perform RPC execution; execute
CCTP burn/mint; verify Iris attestations; perform live x402, Gateway, or other live
settlement; produce transaction hashes; confirm settlement or finality; or claim
official Circle, Arc, or x402 partnership. Every AgentPay Receipt records
`fundsMoved: false`; the Arc adapter evidence is `broadcast: false` /
`status: "not_executed"`. An `ALLOW` decision means only that a separately authorised
future adapter could be considered — it never means funds moved.

## 6. Claim hygiene rules

- Never claim users, customers, revenue, pilot usage, partnerships, live settlement,
  or production execution unless directly observed and recorded here as VERIFIED.
- Always mark claims as VERIFIED (observed in code/tests/assets), PROPOSED (target),
  or NOT YET VALIDATED (external, unverified).
- For external facts (demo availability, program requirements, partnership status),
  write "verify against official sources" instead of asserting.
- When behavior changes, update this package and the linked canonical docs; do not
  duplicate product documentation.

## 7. Follow-up items

Confirmed present in the current checkout at `eb28fe7973cdd3d770de155556c23ee214c6ef33`
(recorded only; not edited in Phase 0):

- `docs/internal/STATE.md` still states phase `CANONICAL_SUBMISSION_POLISH_READY_FOR_PR_REVIEW`
  and lists "Review and merge the updated integration PR into `main`" as a next action,
  although PR #3 is merged — pending-review wording drift.
- `docs/internal/CHECKPOINT.md` still says release checks apply "before this branch is
  proposed for merge" and that the live demo must be redeployed and the video reviewed
  "before final submission" — pending-review wording drift.
- `docs/internal/TASKS.md` still has unchecked items: "Review and merge the integration
  PR", "Redeploy the public demo from merged `main`", and "Review the existing YouTube
  and fallback MP4 against the new x402-first click path; re-record if needed".
- `docs/screenshots.md` still states "The current reviewer path is CitePay first",
  which is stale against the x402-first README.
- `.env.example` uses `AUDIT_LOG_PATH` and `POLICY_CONFIG_PATH`, while
  `src/lib/paths.ts` reads `AGENTPAY_AUDIT_LOG_PATH` and has no `POLICY_CONFIG_PATH`
  override (policy path is hardcoded to `data/policies.default.json`) — naming drift.
- Live demo: probe returned HTTP 200 on 2026-08-13; whether the deployed demo matches
  current `main` is NOT YET VALIDATED (README states the deployed baseline predates
  the x402-first screen).
- README video caveat wording is current and honest: the YouTube link and fallback MP4
  are described as "earlier CitePay-led walkthrough, preserved for reference"; the
  media itself still needs review/re-recording for the x402-first path (TASKS.md item).

See also [requirements](./grants/circle-grants-2026/requirements.md),
[limitations](./grants/circle-grants-2026/limitations.md), and
[roadmap](./grants/circle-grants-2026/roadmap.md) for the Phase 0 grant scope.
