import type { AuditRecord } from "@/domain/audit/types";
import type { EvaluationObservation } from "./evaluation-observation";

export const PILOT_POLICY_GAP_REASON_CODES = [
  "RECIPIENT_UNKNOWN_REQUIRES_REVIEW",
  "PURPOSE_NOT_ALLOWED",
  "SPENDER_REVIEW_REQUIRED",
  "CCTP_ROUTE_UNSUPPORTED"
] as const;

export type PilotMetricsSummary = {
  schemaVersion: "v1";
  canonicalIntentCount: number;
  decisionCounts: { ALLOW: number; REVIEW: number; BLOCK: number };
  observedEvaluationAttemptCount: number;
  replayAttemptCount: number;
  exactReplayAttemptCount: number;
  replayMismatchAttemptCount: number;
  policyDriftAttemptCount: number;
  unknownReplayStateAttemptCount: number;
  authorizationIssuedAttemptCount: number;
  p95PolicyEvaluationDurationMs: number | null;
  reasonCodeCounts: Record<string, number>;
  policyGapSignals: Record<string, number>;
  evidenceCoverage: {
    intentFingerprintKnown: number;
    policyFingerprintKnown: number;
    policyVersionKnown: number;
  };
};

function nearestRankP95(durationsMs: number[]): number | null {
  if (durationsMs.length === 0) {
    return null;
  }
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[rank - 1];
}

export function buildPilotMetrics(
  auditRecords: AuditRecord[],
  observations: EvaluationObservation[]
): PilotMetricsSummary {
  const decisionCounts = { ALLOW: 0, REVIEW: 0, BLOCK: 0 };
  const reasonCodeCounts: Record<string, number> = {};
  let intentFingerprintKnown = 0;
  let policyFingerprintKnown = 0;
  let policyVersionKnown = 0;

  for (const record of auditRecords) {
    if (record.decision === "ALLOW" || record.decision === "REVIEW" || record.decision === "BLOCK") {
      decisionCounts[record.decision] += 1;
    }
    for (const code of record.reasonCodes ?? []) {
      reasonCodeCounts[code] = (reasonCodeCounts[code] ?? 0) + 1;
    }
    if (record.intentFingerprint !== null) {
      intentFingerprintKnown += 1;
    }
    if (record.policyFingerprint !== null) {
      policyFingerprintKnown += 1;
    }
    if (record.policyVersion !== null) {
      policyVersionKnown += 1;
    }
  }

  const policyGapSignals: Record<string, number> = {};
  for (const code of PILOT_POLICY_GAP_REASON_CODES) {
    if (reasonCodeCounts[code] !== undefined) {
      policyGapSignals[code] = reasonCodeCounts[code];
    }
  }

  let replayAttemptCount = 0;
  let exactReplayAttemptCount = 0;
  let replayMismatchAttemptCount = 0;
  let policyDriftAttemptCount = 0;
  let unknownReplayStateAttemptCount = 0;
  let authorizationIssuedAttemptCount = 0;
  const durations: number[] = [];

  for (const observation of observations) {
    if (observation.replayed) {
      replayAttemptCount += 1;
      if (observation.replayMismatch === false && observation.policyChanged === false) {
        exactReplayAttemptCount += 1;
      }
      if (observation.replayMismatch === true) {
        replayMismatchAttemptCount += 1;
      }
      if (observation.policyChanged === true) {
        policyDriftAttemptCount += 1;
      }
      if (observation.replayMismatch === null || observation.policyChanged === null) {
        unknownReplayStateAttemptCount += 1;
      }
    }
    if (observation.authorizationIssued) {
      authorizationIssuedAttemptCount += 1;
    }
    if (Number.isFinite(observation.policyEvaluationDurationMs) && observation.policyEvaluationDurationMs >= 0) {
      durations.push(observation.policyEvaluationDurationMs);
    }
  }

  return {
    schemaVersion: "v1",
    canonicalIntentCount: auditRecords.length,
    decisionCounts,
    observedEvaluationAttemptCount: observations.length,
    replayAttemptCount,
    exactReplayAttemptCount,
    replayMismatchAttemptCount,
    policyDriftAttemptCount,
    unknownReplayStateAttemptCount,
    authorizationIssuedAttemptCount,
    p95PolicyEvaluationDurationMs: nearestRankP95(durations),
    reasonCodeCounts,
    policyGapSignals,
    evidenceCoverage: {
      intentFingerprintKnown,
      policyFingerprintKnown,
      policyVersionKnown
    }
  };
}
