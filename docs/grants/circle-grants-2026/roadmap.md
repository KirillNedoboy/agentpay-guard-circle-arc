# Circle Grants 2026 — Roadmap

Phase 0 and Phase 1 are complete on this branch. Phases 2–9 are NOT yet implemented.
Each phase lists objective, main deliverable, dependencies, and Definition of Done.
This roadmap is planning documentation only; no future phase is implemented here.

## Phase 0 — Grant isolation and source of truth (CURRENT)

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

## Phase 2 — ExecutionAuthorization Envelope (NOT IMPLEMENTED)

- Objective: formal boundary between policy decision and any future adapter execution.
- Main deliverable: typed envelope (intent, decision, evidence reference) that an
  authorized future adapter would consume.
- Dependencies: Phase 1.
- Definition of Done: envelope is deterministic, replayable, and testable; it performs
  no execution.

## Phase 3 — Replay and policy-drift evidence (NOT IMPLEMENTED)

- Objective: re-evaluate recorded decisions against current policy to surface drift.
- Main deliverable: deterministic replay command and drift report.
- Dependencies: Phase 1.
- Definition of Done: replay of historical records reproduces decisions or reports
  exact policy differences; tests cover drift scenarios.

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
