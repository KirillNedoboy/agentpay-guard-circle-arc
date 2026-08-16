# Circle Grants 2026 — Evidence Package

This file is the reviewer-readable proof index for the Circle Grants pilot track on
branch `grant/circle-grants-pilot-2026`. It collects the internal engineering
evidence produced by Phases 1–8 of that branch: deterministic policy decisions,
fingerprint-based attribution, replay and policy-drift evidence, a bounded
ExecutionAuthorization envelope, local pilot observability, judge-first UI
presentation, and a documented engineering threat model. This is **internal
engineering evidence**, distinct from external validation (audits, pilot usage,
grant acceptance, partnerships) — see [What this evidence does NOT prove](#what-this-evidence-does-not-prove).
Every claim below is VERIFIED / PROPOSED / NOT YET VALIDATED / NOT IMPLEMENTED;
nothing else.

## Evidence claims

Statuses: **VERIFIED** (observed in code, tests, or assets), **PROPOSED** (target,
not traction), **NOT YET VALIDATED** (external, unverified), **NOT IMPLEMENTED**
(does not exist in this repository).

| Claim | Status | Evidence | Caveat |
| --- | --- | --- | --- |
| Deterministic `ALLOW` / `REVIEW` / `BLOCK` with `BLOCK` > `REVIEW` > `ALLOW` precedence, stable matched rules and reason codes | VERIFIED | [`src/domain/policy/engine.ts`](../../../src/domain/policy/engine.ts), [decision rules](../../decision-rules.md) | Deterministic over the validated intent and loaded policy; it is not a fraud-prevention guarantee. |
| `policyVersion` and deterministic `policyFingerprint` (sha256 over key-sorted stable JSON, computed at evaluation time, never stored in the policy file) | VERIFIED | [`src/domain/policy/policy-fingerprint.ts`](../../../src/domain/policy/policy-fingerprint.ts), [`data/policies.default.json`](../../../data/policies.default.json) (`policyVersion: "2"`) | Fingerprint proves **content identity only**, not authorship or authenticity. |
| `intentFingerprint` (sha256 over the validated intent; key order irrelevant, array order significant) | VERIFIED | [`src/domain/payment-intent/intent-fingerprint.ts`](../../../src/domain/payment-intent/intent-fingerprint.ts) | Binds the literal validated fields; recipient binding is string-level, not identity-level. |
| `ExecutionAuthorization` — deterministic, typed, ALLOW-only envelope built from the persisted audit record + current policy | VERIFIED | [`src/domain/authorization/execution-authorization.ts`](../../../src/domain/authorization/execution-authorization.ts) | Bounded evidence for a **future** adapter; not an executable capability or bearer token. |
| Single-intent amount binding: `maxAmountUSDC` = persisted proposed amount, never the policy cap (`10.00`) | VERIFIED | `execution-authorization.ts` (`audit.amountUSDC ?? audit.amount`); asserted by tests/security-boundaries.test.ts (`T04 binding`); Phase 2 commit `feat: add execution authorization envelope` | No external executor exists to enforce the envelope. |
| Recipient binding: recipient taken from the persisted audit record | VERIFIED | `execution-authorization.ts`; tests/security-boundaries.test.ts (`T03 binding`) | String-level equality only, not proof of real-world recipient identity. |
| Prepare/simulate-only scope: `executionScope` is the literal `["prepare", "simulate"]` | VERIFIED | `execution-authorization.ts`; tests/security-boundaries.test.ts (`T08 scope`); Phase 2 commit | Type-literal enforced; no execute/submit/broadcast/sign/settle values exist. |
| `executionStatus: "not_executed"` | VERIFIED | `execution-authorization.ts`, audit record type, AgentPay Receipt; Phase 1 commit `feat: add versioned policy evidence` | Literal type, not a runtime value. |
| `fundsMoved: false` on every receipt and authorization | VERIFIED | `execution-authorization.ts`, [`src/domain/payment-intent/receipt.ts`](../../../src/domain/payment-intent/receipt.ts) | No funds move anywhere in this repository. |
| Exact replay: same key → `replayed: true`, `replayMismatch: false`, `policyChanged: false`, same `auditId`, same deterministic `authorizationId`, exactly one canonical record | VERIFIED | [`src/domain/audit/audit-log.ts`](../../../src/domain/audit/audit-log.ts), [`src/domain/audit/replay-evidence.ts`](../../../src/domain/audit/replay-evidence.ts), tests/canonical-grant-scenarios.test.ts (REPLAY), tests/security-boundaries.test.ts (T14); Phase 3 commit `feat: add replay and policy drift evidence` | Demonstrates **idempotent replay consistency** with the persisted decision/evidence. It is NOT "independent decision reproducibility" — that is a PROPOSED pilot protocol only. |
| Replay mismatch detection: same key, changed intent → `replayMismatch: true` → stored decision preserved, **no authorization** | VERIFIED | `replay-evidence.ts`, tests/security-boundaries.test.ts (T02/T04/T05/T12) | A changed stored fingerprint field fails the gate; edited non-fingerprint stored fields are trusted as-is (T13 residual). |
| Policy drift detection: changed `policyVersion`/`policyFingerprint` → `policyChanged: true` → **no authorization**; missing stored attribution → `null` → no authorization | VERIFIED | `replay-evidence.ts`, `execution-authorization.ts` (fail-closed), tests/security-boundaries.test.ts (T06/T07); Phase 3 commit | Drift is reported, not silently absorbed. |
| Canonical ALLOW / REVIEW / BLOCK / REPLAY scenarios | VERIFIED | [`examples/scenario-allow-api.json`](../../../examples/scenario-allow-api.json), [`examples/scenario-review-machine.json`](../../../examples/scenario-review-machine.json), [`examples/scenario-block-risky.json`](../../../examples/scenario-block-risky.json), [`examples/scenario-replay.json`](../../../examples/scenario-replay.json), [`tests/canonical-grant-scenarios.test.ts`](../../../tests/canonical-grant-scenarios.test.ts), [canonical-scenarios.md](./canonical-scenarios.md) | Deterministic product evidence fixtures, not pilot usage. |
| Pilot observation log (append-only, privacy-minimal, one line per validated evaluation including replays, references decisions only by `auditId`) | VERIFIED | [`src/domain/observability/evaluation-observation-log.ts`](../../../src/domain/observability/evaluation-observation-log.ts); Phase 5 commit `feat: add minimal pilot observability` | Observation failure is secondary-evidence-only (`observationRecorded: false`); never changes a decision. |
| Pilot metrics (`PilotMetricsSummary`; read-only `GET /api/pilot-metrics`) | VERIFIED | [`src/domain/observability/pilot-metrics.ts`](../../../src/domain/observability/pilot-metrics.ts), [`src/app/api/pilot-metrics/route.ts`](../../../src/app/api/pilot-metrics/route.ts), [pilot-observability.md](./pilot-observability.md) | Local/demo observations only; metrics computed from the two local logs, never external telemetry. |
| Judge-first UI evidence (replay evidence, authorization panel, policy attribution, local pilot metrics) | VERIFIED | [`src/app/demo-client.tsx`](../../../src/app/demo-client.tsx), [`src/app/page.tsx`](../../../src/app/page.tsx); Phase 6 commit `feat: surface grant evidence in judge UI` | Presentation of server-persisted records; not independent server attestation. |
| Threat-model verification (21 threat classes: T01–T15 + ADD-1..ADD-6, each with control, status, verification, residual risk) | VERIFIED | [threat-model.md](./threat-model.md); Phase 7 commit `test: verify payment security boundaries` | **Internal engineering threat-model verification**, NOT an independent external security audit; no "production secure" claim. |
| Security regression suite (22 tests covering replay substitution, binding, drift, legacy, scope, limits, tamper, concurrency, junk input) | VERIFIED | [`tests/security-boundaries.test.ts`](../../../tests/security-boundaries.test.ts); Phase 7 commit | Documents residual risks (expiry metadata-only, no tamper-evidence, self-asserted identity) as well as mitigations. |
| Strict normalized x402 Payment Requirement contract (typed, validated from unknown input, strict unknown-field rejection at top level and in `extra`) | VERIFIED | [`src/domain/x402/payment-requirement.ts`](../../../src/domain/x402/payment-requirement.ts), [`src/domain/x402/payment-requirement-evidence.ts`](../../../src/domain/x402/payment-requirement-evidence.ts), [`tests/x402-payment-requirement.test.ts`](../../../tests/x402-payment-requirement.test.ts), [x402-payment-requirement-contract.md](./x402-payment-requirement-contract.md) | Syntax validation only; no network/contract allowlisting (that is I2). Injected fields (`privateKey`, `signature`, `transactionHash`, `to`, `data`, `execute`, `rpcUrl`) are rejected, never silently dropped. |
| Deterministic requirement digest (`sha256:<64 hex>` over stable-JSON of the validated requirement via `src/lib/stable-json.ts`; key-order independent, no wall clock/randomness/environment) | VERIFIED | `src/domain/x402/payment-requirement.ts`; `src/lib/stable-json.ts`; `tests/x402-payment-requirement.test.ts` | Commits the validated normalized requirement only — never raw input. |
| Deterministic `PaymentRequirementEvidence` (`evidenceType "x402_payment_requirement"`, `version "v1"`, `protocol "x402"`, `x402Version 2`, `requirementDigest`; no signature/keys/tx hash, no timestamp) | VERIFIED | `src/domain/x402/payment-requirement-evidence.ts`; `tests/x402-payment-requirement.test.ts` | Deterministic by construction (no timestamp, no execution state). |
| Association to Guard audit/authorization evidence (`AuthorizedPaymentRequirementEvidence`: `auditId` + `authorizationId` + `requirementDigest`, `executionStatus "not_executed"`, `fundsMoved false`) built by `buildAuthorizedPaymentRequirementEvidence` from an existing `ExecutionAuthorization` + `PaymentRequirementEvidence` | VERIFIED | `src/domain/x402/payment-requirement-evidence.ts`; `tests/x402-payment-requirement.test.ts` | Association/linkage evidence only, NOT an execution approval. |
| I1 performs no execution/network/signing behavior | VERIFIED | `src/domain/x402/*`; static scan (no wallet/keys/RPC/signing code); `tests/x402-payment-requirement.test.ts` | Guard remains keyless; no Gateway call, no settlement, no funds movement. I1 does not implement I2–I6. |
| CI and full test suite | VERIFIED | [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml); 21 test files / 360 tests, all passing (incl. I1 `tests/x402-payment-requirement.test.ts`, 90 tests); lint, typecheck, build, `git diff --check` green | CI runs on push to `main` and `grant/circle-grants-pilot-2026`, and on pull requests targeting `main`; suite reflects the grant branch at the I1 commit `feat: add x402 payment requirement evidence`. |

## Phase implementation ledger

Verified commit ledger for the grant track, in order, on branch
`grant/circle-grants-pilot-2026` (stable main base:
`eb28fe7973cdd3d770de155556c23ee214c6ef33` — merge of PR #3
`integration/ignyte-circle-arc-preview`). Phases 0–8 are on the grant branch only,
NOT on `main`.

| Phase | Commit | Subject |
| --- | --- | --- |
| 0 | `46cfbab` | chore: establish Circle Grants development track |
| 1 | `971f144` | feat: add versioned policy evidence |
| 2 | `b3aa97e` | feat: add execution authorization envelope |
| 3 | `f5ad45d` | feat: add replay and policy drift evidence |
| 4 | `da282ff` | test: add canonical grant scenarios |
| 5 | `25630d4` | feat: add minimal pilot observability |
| 6 | `65d9ef8` | feat: surface grant evidence in judge UI |
| 7 | `068c579` | test: verify payment security boundaries |
| 8 | `09b400f` | docs: assemble Circle Grants evidence package |

This ledger is current through the Phase 8 checkpoint `09b400f`.

## Evidence status matrix

| Item | State |
| --- | --- |
| Policy engine (`ALLOW` / `REVIEW` / `BLOCK`) | VERIFIED |
| Spend controls (per-request, daily, velocity; decimal-safe) | VERIFIED |
| Policy attribution (`policyVersion` + `policyFingerprint` per record) | VERIFIED |
| ExecutionAuthorization (bounded, single-intent, prepare/simulate-only) | VERIFIED |
| Exact replay (one canonical record per key, same audit + authorization) | VERIFIED |
| Pilot observability (observation log + metrics endpoint) | VERIFIED locally |
| Threat model (21 threat classes, internal engineering review) | VERIFIED internal engineering review |
| x402 payment requirement contract + evidence (I1) | VERIFIED |
| Design partners | PROPOSED |
| 100–500 pilot intents | PROPOSED |
| Production settlement | NOT IMPLEMENTED |
| Current deployed-demo parity (https://138-124-108-146.nip.io vs grant branch) | NOT YET VALIDATED |
| Current video parity (YouTube/MP4 walkthrough vs x402-first path) | NOT YET VALIDATED |
| External grant eligibility/rules (deadline, amount, chain, forms) | NOT YET VALIDATED |

## What this evidence does NOT prove

Repository evidence proves product capabilities only. It does NOT prove:

- design partners exist or are committed;
- any real pilot usage or customer adoption;
- grant acceptance or grant eligibility under the current official program rules;
- a Circle / Arc / x402 partnership or endorsement;
- live production settlement, execution, or funds movement of any kind;
- that the live demo at https://138-124-108-146.nip.io currently matches this
  branch (only a historical HTTP 200 probe exists), or that the YouTube/MP4
  walkthrough matches the current x402-first reviewer path;
- that the audit log is an immutable, tamper-evident ledger (it is append-only
  JSONL by application convention, in-process only).

All of the above remain PROPOSED or NOT YET VALIDATED. External claims must be
verified against official current sources before any submission.
