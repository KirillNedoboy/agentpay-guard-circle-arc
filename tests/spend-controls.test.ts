import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AuditRecord } from "@/domain/audit/types";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import { calculateSpendControls } from "@/domain/policy/spend-controls";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));
const now = new Date("2026-08-02T12:00:00.000Z");

function loadX402Intent() {
  const scenario = JSON.parse(readFileSync(join(root, "examples", "scenario-allow-api.json"), "utf8")) as Record<string, unknown>;
  delete scenario.expectedDecision;
  return validatePaymentIntent(scenario);
}

function makeAuditRecord(overrides: Partial<AuditRecord>): AuditRecord {
  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_fixture",
    timestamp: "2026-08-02T11:59:30.000Z",
    idempotencyKey: "fixture-key",
    agentId: "agent_ignyte_demo_001",
    intent: "Fixture payment intent",
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
    reason: "Fixture record",
    executionMode: "mock_preview",
    railPreview: {
      rail: "mock_x402_service",
      networkLabel: "x402-compatible paid API",
      settlementAsset: "USDC",
      executionMode: "mock_preview",
      recipientId: "trusted-x402-api.demo",
      amountUSDC: "0.10",
      explanation: "Fixture preview"
    },
    ...overrides
  };
}

describe("spend controls", () => {
  test("calculates decimal-safe daily totals, remaining budget, projected spend, and velocity", () => {
    const intent = loadX402Intent();
    const records = [
      makeAuditRecord({ auditId: "audit_1", amount: "0.10", timestamp: "2026-08-02T11:59:30.000Z" }),
      makeAuditRecord({ auditId: "audit_2", amount: "0.20", timestamp: "2026-08-02T11:59:15.000Z" }),
      makeAuditRecord({ auditId: "audit_review", amount: "3.00", decision: "REVIEW", timestamp: "2026-08-02T11:00:00.000Z" }),
      makeAuditRecord({ auditId: "audit_other_agent", amount: "4.00", agentId: "another_agent" }),
      makeAuditRecord({ auditId: "audit_yesterday", amount: "5.00", timestamp: "2026-08-01T23:59:59.000Z" })
    ];

    expect(calculateSpendControls(intent, policy, records, now)).toEqual({
      currency: "USDC",
      requestedAmount: "0.08",
      maxAmountPerPayment: "10.00",
      reviewThreshold: "0.20",
      dailyLimit: "25.00",
      dailyAllowedSpend: "0.3",
      dailyRemainingBefore: "24.7",
      projectedDailySpend: "0.38",
      velocityWindowSeconds: 60,
      velocityAttemptCount: 2,
      velocityMaxAttempts: 5
    });
  });
});
