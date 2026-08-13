# Circle Grants 2026 — Roadmap

Phases 0–7 are complete on this branch. Phases 8 and 9 are NOT yet implemented.
Each phase lists objective, main deliverable, dependencies, and Definition of
Done. This roadmap is planning documentation only; no phase beyond 7 is
implemented here.

## Phase 0 — Grant isolation and source of truth (IMPLEMENTED)

- Objective: isolate grant work on its own branch and establish a canonical, honest
  grant source of truth.
- Main deliverable: `docs/circle-grants-package.md` plus this `docs/grants/` set; CI
  branch coverage.
- Dependencies: canonical `main` at `eb28fe7973cdd3d770de155556c23ee214c6ef33`.
- Definition of Done: package doc distinguishes VERIFIED / PROPOSED / NOT YET
  VALIDATED; branch pushed; no source changes.

## Phase 1 — Typed evidence baseline (IMPLEMENTED — 2026-08-13)

- Objective: make audit evidence self-describing about policy version and execution
  status.
- Main deliverable: typed policy-version and explicit execution-status fields on
  records.
- Dependencies: Phase 0.
- Definition of Done: new records carry policy version and an explicit
  not-executed status; legacy records remain readable; tests cover both.
- Evidence (commit `feat: add versioned policy evidence`): explicit `policyVersion`
  (`"1"`) on `PolicyConfig` and `data/policies.default.json`; deterministic
  `policyFingerprint` (`sha256:<64 hex>`, canonicalized key-sorted SHA-256 via
  `src/domain/policy/policy-fingerprint.ts`, computed at evaluation time, never
  stored in policy JSON); `PolicyDecision` and every `evaluatePolicy` result carry
  `policyId` + `policyVersion` + `policyFingerprint`; new audit records persist the
  three fields with `executionStatus: "not_executed"`; legacy JSONL lines normalize
  in memory to `policyVersion: null` / `policyFingerprint: null` (metadata not
  reconstructed) / `executionStatus: "not_executed"` without rewriting the file;
  `AgentPayReceipt` exposes `executionStatus: "not_executed"` with `fundsMoved: false`;
  successful `EvaluationResponse` sources the fields from the persisted audit record
  (idempotent reuse reflects stored evidence); failure responses expose honest
  `null` / `"not_executed"` evidence. Validation: 162 tests / 14 files passing
  (was 147 / 13), lint, typecheck, build, `git diff --check` all green; historical
  `data/audit-log.jsonl` byte-identical.

## Phase 2 — ExecutionAuthorization Envelope (IMPLEMENTED — 2026-08-13)

- Objective: formal boundary between policy decision and any future adapter execution.
- Main deliverable: typed envelope (intent, decision, evidence reference) that an
  authorized future adapter would consume.
- Dependencies: Phase 1.
- Definition of Done: envelope is deterministic, replayable, and testable; it performs
  no execution.
- Evidence (commit `feat: add execution authorization envelope`): deterministic,
  typed `ExecutionAuthorization` in
  `src/domain/authorization/execution-authorization.ts`, built purely from the
  normalized persisted `AuditRecord` + current `PolicyConfig` (never from the raw
  request); ALLOW-only (REVIEW/BLOCK return no envelope); exact single-intent binding
  (`maxAmountUSDC` = proposed amount, not the policy cap; recipient/agentId from
  persisted audit); deterministic `auth_<64 hex>` SHA-256 id bound to intent/audit/
  agent/recipient/amount/rail/policy evidence/timestamps; `issuedAt` = persisted
  audit timestamp, `expiresAt` = issuedAt + `policy.authorization.ttlSeconds` (300s,
  local preview setting, no `Date.now()`); `executionScope: ["prepare", "simulate"]`
  only, `executionStatus: "not_executed"`, `fundsMoved: false`; legacy records
  without policy attribution produce no authorization; `programmablePaymentContext`
  carried when persisted; `EvaluationResponse.executionAuthorization` optional field
  (absent on REVIEW/BLOCK/failures); nothing persisted to JSONL (fully derivable);
  policy bumped to `policyVersion: "2"` with `authorization.ttlSeconds: 300`.
  Validation: 180 tests / 15 files passing (was 162 / 14), lint, typecheck, build,
  `git diff --check` all green.

## Phase 3 — Replay and policy-drift evidence (IMPLEMENTED — 2026-08-13)

- Objective: re-evaluate recorded decisions against current policy to surface drift.
- Main deliverable: deterministic replay command and drift report.
- Dependencies: Phase 1.
- Definition of Done: replay of historical records reproduces decisions or reports
  exact policy differences; tests cover drift scenarios.
- Evidence (commit `feat: add replay and policy drift evidence`): explicit
  `replayed` signal from the audit writer (`createOrReuseAuditRecordWithEvidence`
  returns `{ record, replayed }`; same key → at most one original line);
  deterministic `intentFingerprint` (`sha256:<64 hex>`, key-order-insensitive,
  over the validated intent) persisted on new audit records and `null` on legacy
  records via in-memory normalization only (historical JSONL byte-identical);
  `ReplayEvidence` response object (`replayed`, `replayMismatch`,
  `policyChanged`, stored/current intent fingerprints, stored/current policy
  version + fingerprint) comparing stored evidence vs the current evaluation;
  policy drift detected by comparing both `policyVersion` and `policyFingerprint`
  against the current loaded policy (missing stored attribution → `null`, never
  fabricated); mismatched replay returns the stored decision as historical
  evidence without appending a duplicate line; ExecutionAuthorization is issued
  only when `replayMismatch === false && policyChanged === false`, and the
  builder additionally refuses to mix stored old attribution with a changed
  current policy (null `policyVersion`/`policyFingerprint`/`intentFingerprint`,
  current version mismatch, or current fingerprint mismatch → no envelope).
  Shared stable-JSON canonicalization extracted to `src/lib/stable-json.ts` and
  reused by policy and intent fingerprints — policy fingerprint output verified
  byte-identical to Phase 2. Validation: 204 tests / 16 files passing (was
  180 / 15), lint, typecheck, build, `git diff --check` all green; policy config,
  dependencies, and historical audit log untouched.

## Phase 4 — Canonical ALLOW / REVIEW / BLOCK / REPLAY scenarios (IMPLEMENTED — 2026-08-13)

- Objective: fixture-and-test canon for every decision class plus replay.
- Main deliverable: canonical scenario set covering ALLOW, REVIEW, BLOCK, and REPLAY.
- Dependencies: Phase 3.
- Definition of Done: scenarios are deterministic, documented, and green in CI.
- Evidence (commit `test: add canonical grant scenarios`): canonical decision set is
  the existing generic fixtures — ALLOW `examples/scenario-allow-api.json`, REVIEW
  `examples/scenario-review-machine.json`, BLOCK `examples/scenario-block-risky.json`
  (CCTP/ERC-20/Paymaster remain compatibility/evidence scenarios, not canonical);
  replay descriptor `examples/scenario-replay.json` (metadata only — never a
  PaymentIntent) referencing the ALLOW fixture; end-to-end proof in
  `tests/canonical-grant-scenarios.test.ts` through `evaluatePaymentIntent` with
  isolated temp audit files: ALLOW issues a single-intent authorization
  (maxAmountUSDC = proposed amount, `["prepare","simulate"]`, `not_executed`,
  `fundsMoved: false`), REVIEW and BLOCK produce no authorization with stable reason
  codes (`RECIPIENT_REVIEW_REQUIRED`, `RECIPIENT_BLOCKED`), REPLAY runs the same
  validated intent twice and preserves `auditId`, `authorizationId`, and exactly one
  JSONL line; canonical fixtures also explicitly evaluated at policy-engine level in
  `tests/scenario-fixtures.test.ts` plus descriptor consistency check. No source,
  policy, or UI changes. Validation: 212 tests / 17 files passing (was 204 / 16),
  lint, typecheck, build, `git diff --check` all green; `src/`, policy config,
  dependencies, and historical audit log untouched. See
  [canonical-scenarios.md](./canonical-scenarios.md).

## Phase 5 — Minimal pilot observability (IMPLEMENTED — 2026-08-13)

- Objective: measure what a pilot needs without touching execution.
- Main deliverable: decision latency, reproducibility, integration-time, and
  policy-gap metrics on top of the existing audit trail.
- Dependencies: Phase 1.
- Definition of Done: metrics computed from audit records; documented in the package.
- Evidence (commit `feat: add minimal pilot observability`): privacy-safe local
  observability with no external telemetry — two evidence layers (canonical audit
  log unchanged; new append-only evaluation-observation log with one line per
  successful validated evaluation including idempotent replays, referencing the
  canonical decision only by `auditId`, never raw intent/recipient/agent/amount);
  `policyEvaluationDurationMs` measured with monotonic `performance.now()` around
  `evaluatePolicy` only (3-decimal precision, never affects policy/fingerprints/
  authorization IDs); observation write failure is secondary-evidence-only
  (`pilotObservability.observationRecorded: false`, decision and authorization
  unchanged); pure `buildPilotMetrics` over canonical records + observations
  (decision counts, reason-code counts, selected policy-gap signals, evidence
  coverage from canonical; attempt/replay/drift/authorization counters and
  nearest-rank p95 duration from observations); read-only `GET /api/pilot-metrics`;
  `.env.example` drift fixed (`AGENTPAY_AUDIT_LOG_PATH`,
  `AGENTPAY_OBSERVATION_LOG_PATH`); `data/evaluation-observations.jsonl`
  gitignored. Validation: 227 tests / 19 files passing (was 212 / 17), lint,
  typecheck, build, `git diff --check` all green; policy config, dependencies, and
  historical audit log untouched. See
  [pilot-observability.md](./pilot-observability.md).

## Phase 6 — Judge-first UI delta (IMPLEMENTED — 2026-08-13)

- Objective: surface grant evidence in the existing judge-first demo without scope creep.
- Main deliverable: UI presentation of the Phase 1–5 evidence additions.
- Dependencies: Phases 1, 4, 5.
- Definition of Done: reviewer path shows typed evidence and replay status; no policy
  or execution behavior changes.
- Evidence (commit `feat: surface grant evidence in judge UI`): presentation-only
  changes under `src/app/` — client result type now models the real API
  (policyVersion, policyFingerprint, executionStatus, ExecutionAuthorization,
  ReplayEvidence, pilotObservability) via imported domain types; "Replay exact
  intent" action re-submitting an immutable snapshot of the last successfully
  evaluated intent (same idempotency key), disabled until evidence exists and while
  evaluation runs; Replay Evidence block (First evaluation / Exact replay / Replay
  mismatch / Policy changed / Legacy evidence); policy attribution panel (ID,
  version, fingerprint — deterministically shortened for display with full value in
  title/aria); Execution Authorization panel (scope single_intent, max amount =
  proposed amount, prepare + simulate only, not_executed, fundsMoved false, safety
  line) and explicit no-authorization states for REVIEW/BLOCK/mismatch/drift;
  observability status ("Observation recorded" / not recorded); local pilot evidence
  panel (canonical intents, attempts, decision counts, replay counters, p95 with
  sub-millisecond precision, gap signals, evidence coverage) with
  "Local/demo evidence only" qualifier and honest failure state; responsive at 1440
  and 390 px (no horizontal overflow, cards stack, hashes wrap); `page.tsx` and
  `src/domain/` untouched. Validation: 248 tests / 19 files passing (was 227 / 19),
  lint, typecheck, build, `git diff --check` all green; live judge-flow smoke via
  production server + automated browser (ALLOW → First evaluation + authorization;
  replay ×3 → same auditId, same deterministic authorizationId, one canonical
  record; REVIEW/BLOCK → no authorization; metrics reflect the API).

## Phase 7 — Threat-model verification (IMPLEMENTED — 2026-08-14)

- Objective: verify the boundary against the stated threat model.
- Main deliverable: threat-model review of the boundary, evidence, and fixtures.
- Dependencies: Phases 2, 3.
- Definition of Done: documented review; no boundary regressions.
- Evidence: engineering threat-model delivered at
  [threat-model.md](./threat-model.md) (internal engineering verification, NOT an
  independent external security audit), covering 21 threat classes — 15 core
  (T01–T15) plus 6 additional (ADD-1..ADD-6) — each with a current control,
  status, file:line verification, and residual risk. The threat model is written
  against the verified code, not the other way around; every claim cites source
  lines. Verified current controls (each checked in code): exact-replay
  idempotency (one canonical line per key, in-process); replay-mismatch
  suppression of authorization; policy-drift suppression of authorization; legacy
  fail-closed (missing attribution → null → no authorization); literal
  prepare/simulate-only authorization scope (`executionScope: ["prepare",
  "simulate"]`, `executionStatus: "not_executed"`, `fundsMoved: false`);
  decimal-safe BigInt spend limits (per-request 10.00 / daily 25.00 / velocity
  5 per 60s); in-process per-path write lock. Explicit residual-risk register
  with severities calibrated to the current no-execution scope (audit log not
  tamper-evident; expiry metadata-only with no runtime enforcement; no
  cross-process concurrency control; no authenticated agent identity; policy
  fingerprint proves content identity only — none of these are claimed as
  implemented controls). Future execution precondition checklist: 14 items,
  all unchecked, with the explicit statement that none are complete because no
  execution adapter exists and all must be implemented and tested before ANY
  testnet adapter can move funds. Security regression suite
  `tests/security-boundaries.test.ts` (22 tests, all passing). Full suite now
  20 files / 270 tests (baseline 19 files / 248 tests + 22 new
  security-boundary tests; verified run 2026-08-14); lint, typecheck,
  build, and `git diff --check` green; this phase changes docs only — `src/`,
  `data/`, and `package.json` untouched.

## Phase 8 — Grant evidence package (NOT IMPLEMENTED)

- Objective: assemble the pilot-ready evidence package.
- Main deliverable: updated `docs/circle-grants-package.md` with validated pilot
  evidence.
- Dependencies: Phases 1–7.
- Definition of Done: every claim is VERIFIED / PROPOSED / NOT YET VALIDATED; no fake
  claims.

## Phase 9 — Fresh-clone / release readiness (NOT IMPLEMENTED)

- Objective: a new clone can reproduce every claim.
- Main deliverable: install, test, lint, typecheck, build green on a fresh clone.
- Dependencies: Phases 1–8.
- Definition of Done: fresh-clone run recorded in the package doc; release actions
  (demo redeploy, media review) listed as follow-up items.
