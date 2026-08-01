import { describe, expect, test } from "vitest";
import type { AuditRecord } from "@/domain/audit/types";
import { buildSpendControls } from "@/domain/policy/spend-controls";
import type { PolicyConfig } from "@/domain/policy/policy-config";
import type { PaymentIntent } from "@/domain/payment-intent/types";

const policy: PolicyConfig = {
  policyId: "test-policy",
  currency: { supported: ["USDC"] },
  limits: {
    maxAmountPerPayment: "10.00",
    dailyLimitPerAgent: "25.00",
    reviewThreshold: "0.20"
  },
  velocity: { windowSeconds: 60, maxAttemptsPerWindow: 5 },
  allowedScenarios: ["api_access"],
  allowlistedRecipients: ["trusted-x402-api.demo"],
  reviewRecipients: [],
  deniedRecipients: [],
  suspiciousKeywords: [],
  riskWeights: {
    unknownRecipient: 35,
    unknownScenario: 30,
    reviewRecipient: 25,
    suspiciousKeyword: 30,
    velocityExceeded: 30,
    amountAboveHalfLimit: 20,
    amountAboveReviewThreshold: 25
  },
  decisionThresholds: { reviewAt: 30, blockAt: 70 }
};

const intent: PaymentIntent = {
  agentId: "agent_x402_judge_001",
  intent: "Pay 0.08 USDC for a trusted x402-style verification API response",
  amount: "0.08",
  currency: "USDC",
  recipient: "trusted-x402-api.demo",
  scenario: "api_access",
  paymentRail: "mock_x402_service",
  idempotencyKey: "judge-x402-micropayment-001"
};

function auditRecord(overrides: Partial<AuditRecord>): AuditRecord {
  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_test_000001",
    timestamp: "2026-08-01T11:59:30.000Z",
    idempotencyKey: "prior-attempt",
    agentId: intent.agentId,
    intent: "Prior payment attempt",
    amount: "0.10",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    decision: "ALLOW",
    riskScore: 10,
    policyId: policy.policyId,
    matchedRules: [],
    reasonCodes: [],
    reason: "test record",
    executionMode: "mock_preview",
    railPreview: {
      rail: "mock_x402_service",
      networkLabel: "x402-compatible paid API",
      settlementAsset: "USDC",
      executionMode: "mock_preview",
      recipientId: "trusted-x402-api.demo",
      amountUSDC: "0.10",
      explanation: "Preview only."
    },
    ...overrides
  };
}

describe("buildSpendControls", () => {
  test("builds decimal-safe daily budget and velocity evidence for an x402 micropayment", () => {
    const controls = buildSpendControls({
      intent,
      policy,
      recentAuditRecords: [
        auditRecord({ amount: "0.10", decision: "ALLOW" }),
        auditRecord({ auditId: "audit_test_000002", amount: "0.005", decision: "ALLOW" }),
        auditRecord({ auditId: "audit_test_000003", amount: "0.25", decision: "REVIEW" }),
        auditRecord({ auditId: "audit_test_000004", timestamp: "2026-08-01T11:57:00.000Z", decision: "BLOCK" }),
        auditRecord({ auditId: "audit_test_000005", timestamp: "2026-07-31T11:59:30.000Z", amount: "8.00", decision: "ALLOW" })
      ],
      now: new Date("2026-08-01T12:00:00.000Z")
    });

    expect(controls).toEqual({
      currency: "USDC",
      requestedAmount: "0.08",
      maxAmountPerPayment: "10.00",
      reviewThreshold: "0.20",
      dailyLimit: "25.00",
      dailyAllowedSpend: "0.105",
      dailyRemainingBeforeRequest: "24.895",
      projectedDailySpend: "0.185",
      velocityWindowSeconds: 60,
      velocityAttempts: 3,
      velocityMaxAttempts: 5
    });
  });
});
