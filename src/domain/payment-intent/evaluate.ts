import { createOrReuseAuditRecord, readRecentAuditRecords } from "@/domain/audit/audit-log";
import type { AuditRecord } from "@/domain/audit/types";
import type { ArcTestnetSimulation, CircleRailPreview, PolicyDecision } from "@/domain/payment-intent/types";
import { validatePaymentIntent, ValidationError } from "@/domain/payment-intent/validation";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import { auditLogPath, policyPath } from "@/lib/paths";

export type EvaluationResponse = PolicyDecision & {
  auditId: string;
  createdAt: string;
  executionMode: CircleRailPreview["executionMode"];
  railPreview: CircleRailPreview;
  arcTestnetSimulation: ArcTestnetSimulation;
};

export async function evaluatePaymentIntent(input: unknown): Promise<EvaluationResponse> {
  const intent = validatePaymentIntent(input);
  const policy = loadPolicyConfig(policyPath());
  const recentRecords = readRecentAuditRecords(auditLogPath(), 250);
  const decision = evaluatePolicy(intent, policy, recentRecords);
  const audit = await createOrReuseAuditRecord(auditLogPath(), intent, decision);

  return {
    decision: audit.decision,
    riskScore: audit.riskScore,
    reason: audit.reason,
    matchedRules: audit.matchedRules,
    reasonCodes: audit.reasonCodes,
    policyId: audit.policyId,
    auditId: audit.auditId,
    createdAt: audit.timestamp,
    executionMode: audit.executionMode,
    railPreview: audit.railPreview,
    arcTestnetSimulation: audit.arcTestnetSimulation!
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
