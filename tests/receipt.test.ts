import { describe, expect, test } from "vitest";
import { buildAgentPayReceipt } from "@/domain/payment-intent/receipt";
import type { AuditRecord } from "@/domain/audit/types";

function makeAuditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_20260707_000001",
    timestamp: "2026-07-07T10:15:30.000Z",
    intentId: "intent_demo_001",
    idempotencyKey: "demo-receipt-001",
    agentId: "agent_receipt_demo_001",
    intent: "Buy trusted verification data for an agent report",
    amount: "0.08",
    amountUSDC: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    recipientId: "trusted-x402-api.demo",
    recipientLabel: "Trusted x402 verification API",
    scenario: "api_access",
    purpose: "api_data_purchase",
    paymentRail: "mock_x402_service",
    rail: "mock_x402_service",
    decision: "ALLOW",
    riskScore: 10,
    policyId: "default-agentpay-policy-v1",
    matchedRules: ["recipient_allowlisted", "scenario_allowed", "amount_below_per_payment_limit"],
    reasonCodes: ["RECIPIENT_TRUSTED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"],
    reason: "Recipient is allowlisted, amount is below limits, and scenario is allowed.",
    executionMode: "mock_preview",
    railPreview: {
      rail: "mock_x402_service",
      networkLabel: "x402-compatible paid API",
      settlementAsset: "USDC",
      executionMode: "mock_preview",
      recipientId: "trusted-x402-api.demo",
      amountUSDC: "0.08",
      explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
    },
    ...overrides
  };
}

describe("AgentPay Receipt", () => {
  test("builds a preview-only receipt with required proof fields and no execution artifacts", () => {
    const receipt = buildAgentPayReceipt(makeAuditRecord());

    expect(receipt).toMatchObject({
      receiptType: "agentpay_receipt",
      version: "v1",
      agentIdentity: "agent_receipt_demo_001",
      requestIdentity: "demo-receipt-001",
      intentId: "intent_demo_001",
      recipientLabel: "Trusted x402 verification API",
      amountUSDC: "0.08",
      purpose: "api_data_purchase",
      decision: "ALLOW",
      reasonCodes: ["RECIPIENT_TRUSTED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"],
      executionMode: "mock_preview",
      fundsMoved: false,
      auditId: "audit_20260707_000001",
      timestamp: "2026-07-07T10:15:30.000Z",
      railPreview: {
        rail: "mock_x402_service",
        amountUSDC: "0.08",
        settlementAsset: "USDC"
      }
    });
    expect(receipt.safetyNote).toContain("preview");
    expect(receipt.safetyNote).toContain("no live");
    expect(Object.keys(receipt)).not.toEqual(expect.arrayContaining(["transactionHash", "signature", "privateKey"]));
    expect(JSON.stringify(receipt)).not.toMatch(/transactionHash|signature|privateKey|seedPhrase/i);
  });

  test("derives fallback receipt fields from an existing audit record without changing audit semantics", () => {
    const legacyLikeRecord = makeAuditRecord({
      intentId: undefined,
      amountUSDC: undefined,
      recipientLabel: undefined,
      purpose: undefined,
      rail: undefined,
      executionMode: undefined,
      railPreview: undefined as unknown as AuditRecord["railPreview"]
    });

    const receipt = buildAgentPayReceipt(legacyLikeRecord);

    expect(receipt.intentId).toBe("demo-receipt-001");
    expect(receipt.amountUSDC).toBe("0.08");
    expect(receipt.recipientLabel).toBe("trusted-x402-api.demo");
    expect(receipt.purpose).toBe("api_data_purchase");
    expect(receipt.executionMode).toBe("mock_preview");
    expect(receipt.railPreview.recipientId).toBe("trusted-x402-api.demo");
    expect(receipt.fundsMoved).toBe(false);
  });
});
