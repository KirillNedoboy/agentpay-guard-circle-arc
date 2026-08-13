# Pilot Observability (Phase 5)

Privacy-safe, local, deterministic pilot observability for the Circle Grants pilot
track. No external telemetry, databases, vendors, queues, workers, or network calls.

## Two evidence layers

1. **Canonical audit log** (`data/audit-log.jsonl` by default) — authoritative,
   unchanged: one record per `idempotencyKey`, append-only, with policy attribution,
   intent fingerprint, decision evidence, and receipt data.
2. **Evaluation observation log**
   (`evaluation-observations.jsonl` next to the active audit log; override with
   `AGENTPAY_OBSERVATION_LOG_PATH`) — secondary activity evidence: one
   `agentpay_evaluation_observed` line per successful validated evaluation attempt,
   **including idempotent replays**. Observations are privacy-minimal: they reference
   the canonical decision only by `auditId` and never store raw intent text,
   recipient, amount, agent, wallet, transaction, or signature data.

Observations are never stored inside `AuditRecord` and are never appended to the
canonical audit file. A failed observation append is secondary evidence only: it
never changes the persisted decision, audit evidence, or ExecutionAuthorization, and
the response reports `pilotObservability: { observationRecorded: false }` instead of
claiming recorded metrics.

## Metric definitions

| Metric | Source | Definition |
| --- | --- | --- |
| `canonicalIntentCount` | canonical audit | number of canonical records (one per idempotency key) |
| `decisionCounts` | canonical audit | ALLOW / REVIEW / BLOCK counts |
| `reasonCodeCounts` | canonical audit | per-reason-code counts |
| `policyGapSignals` | canonical audit | subset of reason codes selected as policy-gap indicators: `RECIPIENT_UNKNOWN_REQUIRES_REVIEW`, `PURPOSE_NOT_ALLOWED`, `SPENDER_REVIEW_REQUIRED`, `CCTP_ROUTE_UNSUPPORTED`. `RECIPIENT_BLOCKED` is an enforced policy result, not a gap signal. |
| `evidenceCoverage` | canonical audit | counts of records with known `intentFingerprint`, `policyFingerprint`, `policyVersion`; missing legacy attribution counts as unknown, never fabricated |
| `observedEvaluationAttemptCount` | observations | total observation lines (first evaluations + replays) |
| `replayAttemptCount` | observations | observations with `replayed === true` |
| `exactReplayAttemptCount` | observations | `replayed && replayMismatch === false && policyChanged === false` |
| `replayMismatchAttemptCount` | observations | `replayed && replayMismatch === true` |
| `policyDriftAttemptCount` | observations | `replayed && policyChanged === true` |
| `unknownReplayStateAttemptCount` | observations | `replayed && (replayMismatch === null || policyChanged === null)` |
| `authorizationIssuedAttemptCount` | observations | observations with `authorizationIssued === true` |
| `p95PolicyEvaluationDurationMs` | observations | nearest-rank p95 of `policyEvaluationDurationMs` (monotonic `performance.now()` over `evaluatePolicy` only, 3-decimal precision); `null` when empty |

Replay categories may legitimately overlap (an attempt can be both a mismatch and a
policy drift); the counters are not forced to be mutually exclusive.

## System-derived NOW vs NOT automatically measured

SYSTEM-DERIVED NOW (from the two local logs):

- canonical decision counts;
- evaluation-attempt count;
- replay-attempt counts (exact / mismatch / drift / unknown state);
- p95 policy-evaluation duration;
- reason-code counts;
- policy-gap signals;
- evidence coverage.

NOT AUTOMATICALLY MEASURED:

- design partner count;
- integration time;
- partner feedback;
- production usage;
- revenue;
- independent decision reproducibility.

Exact replay consistency is NOT the same claim as independently reproducing a
historical policy decision. This phase measures idempotent replay consistency only;
the pilot target "decision reproducibility" remains PROPOSED and requires a defined
protocol.

## API

Read-only `GET /api/pilot-metrics` returns `{ metrics: PilotMetricsSummary }`
computed from the canonical audit records and evaluation observations. GET mutates
nothing, creates no observations, and executes no policy. No raw intent content or
raw observation dump is exposed. No authentication (local grant demo).
