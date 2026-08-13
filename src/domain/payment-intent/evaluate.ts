import { createOrReuseAuditRecordWithEvidence, readRecentAuditRecords } from "@/domain/audit/audit-log";
import type { AuditRecord } from "@/domain/audit/types";
import { buildReplayEvidence, type ReplayEvidence } from "@/domain/audit/replay-evidence";
import { buildExecutionAuthorization, type ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import { fingerprintIntent } from "@/domain/payment-intent/intent-fingerprint";
import type { ArcTestnetSimulation, CircleRailPreview, PolicyDecision } from "@/domain/payment-intent/types";
import { validatePaymentIntent, ValidationError } from "@/domain/payment-intent/validation";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import type { SpendControls } from "@/domain/policy/spend-controls";
import { calculateSpendControls } from "@/domain/policy/spend-controls";
import { auditLogPath, policyPath } from "@/lib/paths";

export type EvaluationResponse = Omit<PolicyDecision, "policyVersion" | "policyFingerprint"> & {
  policyVersion: string | null;
  policyFingerprint: string | null;
  executionStatus: "not_executed";
  auditId: string;
  createdAt: string;
  executionMode: CircleRailPreview["executionMode"];
  railPreview: CircleRailPreview;
  spendControls?: SpendControls;
  arcTestnetSimulation?: ArcTestnetSimulation;
  executionAuthorization?: ExecutionAuthorization;
  replayEvidence: ReplayEvidence;
};

export async function evaluatePaymentIntent(input: unknown): Promise<EvaluationResponse> {
  const intent = validatePaymentIntent(input);
  const policy = loadPolicyConfig(policyPath());
  const recentRecords = readRecentAuditRecords(auditLogPath(), 250);
  const spendControls = calculateSpendControls(intent, policy, recentRecords);
  const decision = evaluatePolicy(intent, policy, recentRecords, spendControls);
  const { record: audit, replayed } = await createOrReuseAuditRecordWithEvidence(auditLogPath(), intent, decision);
  const currentIntentFingerprint = fingerprintIntent(intent);
  const replayEvidence = buildReplayEvidence(audit, currentIntentFingerprint, policy, replayed);
  const executionAuthorization =
    replayEvidence.replayMismatch === false && replayEvidence.policyChanged === false
      ? buildExecutionAuthorization(audit, policy)
      : null;

  return {
    decision: audit.decision,
    riskScore: audit.riskScore,
    reason: audit.reason,
    matchedRules: audit.matchedRules,
    reasonCodes: audit.reasonCodes,
    policyId: audit.policyId,
    policyVersion: audit.policyVersion ?? null,
    policyFingerprint: audit.policyFingerprint ?? null,
    executionStatus: audit.executionStatus ?? "not_executed",
    auditId: audit.auditId,
    createdAt: audit.timestamp,
    executionMode: audit.executionMode,
    railPreview: audit.railPreview,
    ...(audit.spendControls ? { spendControls: audit.spendControls } : {}),
    ...(audit.arcTestnetSimulation ? { arcTestnetSimulation: audit.arcTestnetSimulation } : {}),
    ...(executionAuthorization ? { executionAuthorization } : {}),
    replayEvidence
  };
}

export async function safeEvaluatePaymentIntent(input: unknown): Promise<Response> {
  try {
    const result = await evaluatePaymentIntent(input);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json(
        {
          decision: "BLOCK",
          riskScore: 100,
          reason: error.message,
          matchedRules: ["request_validation_failed"],
          policyId: "unloaded",
          policyVersion: null,
          policyFingerprint: null,
          executionStatus: "not_executed",
          auditId: null,
          createdAt: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    return Response.json(
      {
        decision: "REVIEW",
        riskScore: 100,
        reason: "Internal evaluation failure. Payment must not proceed.",
        matchedRules: ["internal_evaluation_failure"],
        policyId: "unloaded",
        policyVersion: null,
        policyFingerprint: null,
        executionStatus: "not_executed",
        auditId: null,
        createdAt: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

export function getRecentAuditRecords(limit = 25): AuditRecord[] {
  return readRecentAuditRecords(auditLogPath(), limit);
}
