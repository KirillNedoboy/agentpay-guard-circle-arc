import { describe, expect, test } from "vitest";
import { buildPilotMetrics, PILOT_POLICY_GAP_REASON_CODES } from "@/domain/observability/pilot-metrics";
import type { AuditRecord } from "@/domain/audit/types";
import type { EvaluationObservation } from "@/domain/observability/evaluation-observation";

function makeAuditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_metrics_000001",
    timestamp: "2026-08-13T12:00:00.000Z",
    idempotencyKey: "metrics-key-001",
    agentId: "agent_metrics_001",
    intent: "Canonical metrics fixture intent",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    decision: "ALLOW",
    riskScore: 10,
    policyId: "default-agentpay-policy-v1",
    policyVersion: "2",
    policyFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    intentFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    executionStatus: "not_executed",
    matchedRules: ["recipient_allowlisted"],
    reasonCodes: ["RECIPIENT_TRUSTED", "PURPOSE_ALLOWED", "RAIL_PREVIEW_ONLY"],
    reason: "fixture",
    executionMode: "mock_preview",
    railPreview: {
      rail: "mock_x402_service",
      networkLabel: "x402-compatible paid API",
      settlementAsset: "USDC",
      executionMode: "mock_preview",
      recipientId: "trusted-x402-api.demo",
      amountUSDC: "0.08",
      explanation: "Preview only."
    },
    ...overrides
  };
}

function makeObservation(overrides: Partial<EvaluationObservation> = {}): EvaluationObservation {
  return {
    eventType: "agentpay_evaluation_observed",
    timestamp: "2026-08-13T12:00:00.000Z",
    auditId: "audit_metrics_000001",
    decision: "ALLOW",
    replayed: false,
    replayMismatch: false,
    policyChanged: false,
    authorizationIssued: true,
    policyEvaluationDurationMs: 1,
    ...overrides
  };
}

describe("pilot metrics", () => {
  test("canonical sources drive decision counts, reason codes, and evidence coverage", () => {
    const records = [
      makeAuditRecord({ decision: "ALLOW" }),
      makeAuditRecord({ auditId: "audit_metrics_000002", decision: "ALLOW" }),
      makeAuditRecord({ auditId: "audit_metrics_000003", decision: "REVIEW", reasonCodes: ["RECIPIENT_REVIEW_REQUIRED"] }),
      makeAuditRecord({ auditId: "audit_metrics_000004", decision: "BLOCK", reasonCodes: ["RECIPIENT_BLOCKED"] })
    ];
    const metrics = buildPilotMetrics(records, []);

    expect(metrics.canonicalIntentCount).toBe(4);
    expect(metrics.decisionCounts).toEqual({ ALLOW: 2, REVIEW: 1, BLOCK: 1 });
    expect(metrics.reasonCodeCounts).toEqual({
      RECIPIENT_TRUSTED: 2,
      PURPOSE_ALLOWED: 2,
      RAIL_PREVIEW_ONLY: 2,
      RECIPIENT_REVIEW_REQUIRED: 1,
      RECIPIENT_BLOCKED: 1
    });
    expect(metrics.evidenceCoverage).toEqual({ intentFingerprintKnown: 4, policyFingerprintKnown: 4, policyVersionKnown: 4 });
    expect(metrics.observedEvaluationAttemptCount).toBe(0);
    expect(metrics.p95PolicyEvaluationDurationMs).toBeNull();
  });

  test("policy gap signals contain only the selected gap codes", () => {
    const records = [
      makeAuditRecord({ decision: "REVIEW", reasonCodes: ["RECIPIENT_UNKNOWN_REQUIRES_REVIEW"] }),
      makeAuditRecord({ auditId: "audit_metrics_000002", decision: "BLOCK", reasonCodes: ["RECIPIENT_BLOCKED", "CCTP_ROUTE_UNSUPPORTED"] }),
      makeAuditRecord({ auditId: "audit_metrics_000003", decision: "REVIEW", reasonCodes: ["SPENDER_REVIEW_REQUIRED", "PURPOSE_NOT_ALLOWED"] })
    ];
    const metrics = buildPilotMetrics(records, []);

    expect(PILOT_POLICY_GAP_REASON_CODES).toEqual([
      "RECIPIENT_UNKNOWN_REQUIRES_REVIEW",
      "PURPOSE_NOT_ALLOWED",
      "SPENDER_REVIEW_REQUIRED",
      "CCTP_ROUTE_UNSUPPORTED"
    ]);
    expect(metrics.policyGapSignals).toEqual({
      RECIPIENT_UNKNOWN_REQUIRES_REVIEW: 1,
      PURPOSE_NOT_ALLOWED: 1,
      SPENDER_REVIEW_REQUIRED: 1,
      CCTP_ROUTE_UNSUPPORTED: 1
    });
    expect(metrics.policyGapSignals).not.toHaveProperty("RECIPIENT_BLOCKED");
  });

  test("evidence coverage counts missing legacy attribution as unknown", () => {
    const records = [
      makeAuditRecord(),
      makeAuditRecord({ auditId: "audit_metrics_000002", policyVersion: null, policyFingerprint: null, intentFingerprint: null })
    ];
    const metrics = buildPilotMetrics(records, []);

    expect(metrics.evidenceCoverage).toEqual({ intentFingerprintKnown: 1, policyFingerprintKnown: 1, policyVersionKnown: 1 });
  });

  test("replay counters come from observations, including the overlap case", () => {
    const observations = [
      makeObservation({ auditId: "o_first", replayed: false, replayMismatch: false, policyChanged: false, authorizationIssued: true }),
      makeObservation({ auditId: "o_exact", replayed: true, replayMismatch: false, policyChanged: false, authorizationIssued: true }),
      makeObservation({ auditId: "o_mismatch", replayed: true, replayMismatch: true, policyChanged: false, authorizationIssued: false }),
      makeObservation({ auditId: "o_drift", replayed: true, replayMismatch: false, policyChanged: true, authorizationIssued: false }),
      makeObservation({ auditId: "o_both", replayed: true, replayMismatch: true, policyChanged: true, authorizationIssued: false }),
      makeObservation({ auditId: "o_unknown", replayed: true, replayMismatch: null, policyChanged: null, authorizationIssued: false })
    ];
    const metrics = buildPilotMetrics([], observations);

    expect(metrics.observedEvaluationAttemptCount).toBe(6);
    expect(metrics.replayAttemptCount).toBe(5);
    expect(metrics.exactReplayAttemptCount).toBe(1);
    expect(metrics.replayMismatchAttemptCount).toBe(2);
    expect(metrics.policyDriftAttemptCount).toBe(2);
    expect(metrics.unknownReplayStateAttemptCount).toBe(1);
    expect(metrics.authorizationIssuedAttemptCount).toBe(2);
  });

  test("p95 uses nearest-rank over sorted durations", () => {
    const durations = [1, 2, 3, 4, 5, 10, 20, 30, 40, 100];
    const observations = durations.map((duration, index) =>
      makeObservation({ auditId: `audit_dur_${index}`, policyEvaluationDurationMs: duration })
    );
    const shuffled = [...observations].sort(() => 0.5 - Math.random());
    const metrics = buildPilotMetrics([], shuffled);

    expect(metrics.p95PolicyEvaluationDurationMs).toBe(100);
  });

  test("p95 is null for empty observations", () => {
    expect(buildPilotMetrics([], []).p95PolicyEvaluationDurationMs).toBeNull();
  });

  test("summary carries the v1 schema and no reproducibility claim", () => {
    const metrics = buildPilotMetrics([], []);
    expect(metrics.schemaVersion).toBe("v1");
    expect(metrics).not.toHaveProperty("decisionReproducibilityRate");
  });
});
