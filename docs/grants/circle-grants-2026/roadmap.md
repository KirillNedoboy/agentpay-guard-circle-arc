# Circle Grants 2026 — Roadmap

Phases 0, 1, 2, and 3 are complete on this branch. Phases 4–9 are NOT yet implemented.
Each phase lists objective, main deliverable, dependencies, and Definition of Done.
This roadmap is planning documentation only; no future phase is implemented here.

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

## Phase 4 — Canonical ALLOW / REVIEW / BLOCK / REPLAY scenarios (NOT IMPLEMENTED)

- Objective: fixture-and-test canon for every decision class plus replay.
- Main deliverable: canonical scenario set covering ALLOW, REVIEW, BLOCK, and REPLAY.
- Dependencies: Phase 3.
- Definition of Done: scenarios are deterministic, documented, and green in CI.

## Phase 5 — Minimal pilot observability (NOT IMPLEMENTED)

- Objective: measure what a pilot needs without touching execution.
- Main deliverable: decision latency, reproducibility, integration-time, and
  policy-gap metrics on top of the existing audit trail.
- Dependencies: Phase 1.
- Definition of Done: metrics computed from audit records; documented in the package.

## Phase 6 — Judge-first UI delta (NOT IMPLEMENTED)

- Objective: surface grant evidence in the existing judge-first demo without scope creep.
- Main deliverable: UI presentation of the Phase 1–5 evidence additions.
- Dependencies: Phases 1, 4, 5.
- Definition of Done: reviewer path shows typed evidence and replay status; no policy
  or execution behavior changes.

## Phase 7 — Threat-model verification (NOT IMPLEMENTED)

- Objective: verify the boundary against the stated threat model.
- Main deliverable: threat-model review of the boundary, evidence, and fixtures.
- Dependencies: Phases 2, 3.
- Definition of Done: documented review; no boundary regressions.

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
