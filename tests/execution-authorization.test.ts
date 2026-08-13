import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import type { AuditRecord } from "@/domain/audit/types";

const policy = loadPolicyConfig(join(process.cwd(), "data", "policies.default.json"));

function makeAuditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_20260707_000001",
    timestamp: "2026-07-07T10:15:30.000Z",
    intentId: "intent_demo_001",
    idempotencyKey: "demo-auth-001",
    agentId: "agent_auth_demo_001",
    intent: "Buy trusted verification data for an agent report",
    amount: "0.08",
    amountUSDC: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    recipientId: "trusted-x402-api.demo",
    recipientLabel: "trusted-x402-api.demo",
    scenario: "api_access",
    purpose: "api_data_purchase",
    paymentRail: "mock_x402_service",
    rail: "mock_x402_service",
    decision: "ALLOW",
    riskScore: 10,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyFingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    executionStatus: "not_executed",
    matchedRules: ["recipient_allowlisted", "scenario_allowed", "amount_below_per_payment_limit"],
    reasonCodes: ["RECIPIENT_TRUSTED", "PURPOSE_ALLOWED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"],
    reason: "Recipient is allowlisted, amount is below limits, and scenario is allowed.",
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe("ExecutionAuthorization envelope", () => {
  test("ALLOW creates an authorization with the full typed shape", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization).not.toBeNull();
    expect(authorization).toMatchObject({
      authorizationType: "execution_authorization",
      version: "v1",
      scope: "single_intent",
      decision: "ALLOW",
      asset: "USDC",
      executionScope: ["prepare", "simulate"],
      executionStatus: "not_executed",
      fundsMoved: false,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion
    });
    expect(authorization?.authorizationId).toMatch(/^auth_[0-9a-f]{64}$/);
  });

  test("binds the exact proposed amount, not the policy cap", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.maxAmountUSDC).toBe("0.08");
    expect(authorization?.maxAmountUSDC).not.toBe(policy.limits.maxAmountPerPayment);
  });

  test("REVIEW produces no authorization", () => {
    expect(buildExecutionAuthorization(makeAuditRecord({ decision: "REVIEW" }), policy)).toBeNull();
  });

  test("BLOCK produces no authorization", () => {
    expect(buildExecutionAuthorization(makeAuditRecord({ decision: "BLOCK" }), policy)).toBeNull();
  });

  test("authorizationId is deterministic for the same audit and policy", () => {
    const first = buildExecutionAuthorization(makeAuditRecord(), policy);
    const second = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(first?.authorizationId).toBe(second?.authorizationId);

    const differentAudit = buildExecutionAuthorization(makeAuditRecord({ auditId: "audit_20260707_000002" }), policy);
    const differentAmount = buildExecutionAuthorization(makeAuditRecord({ amount: "0.09", amountUSDC: "0.09" }), policy);
    expect(first?.authorizationId).not.toBe(differentAudit?.authorizationId);
    expect(first?.authorizationId).not.toBe(differentAmount?.authorizationId);
  });

  test("timestamps are deterministic from persisted evidence and the policy TTL", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.issuedAt).toBe("2026-07-07T10:15:30.000Z");
    expect(authorization?.expiresAt).toBe("2026-07-07T10:20:30.000Z");

    const later = buildExecutionAuthorization(makeAuditRecord({ timestamp: "2026-07-07T11:00:00.000Z" }), policy);
    expect(later?.issuedAt).toBe("2026-07-07T11:00:00.000Z");
    expect(later?.expiresAt).toBe("2026-07-07T11:05:00.000Z");
  });

  test("policy attribution matches the persisted evidence exactly", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.policyVersion).toBe(policy.policyVersion);
    expect(authorization?.policyFingerprint).toBe("sha256:0000000000000000000000000000000000000000000000000000000000000000");
    expect(authorization?.policyId).toBe(policy.policyId);
  });

  test("legacy ALLOW without policy attribution produces no authorization", () => {
    expect(buildExecutionAuthorization(makeAuditRecord({ policyVersion: null }), policy)).toBeNull();
    expect(buildExecutionAuthorization(makeAuditRecord({ policyFingerprint: null }), policy)).toBeNull();
  });

  test("carries programmable payment context when persisted", () => {
    const authorization = buildExecutionAuthorization(
      makeAuditRecord({
        programmablePaymentContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          finalityMode: "standard",
          attestationStatus: "not_requested",
          estimatedFee: "0.02",
          feeAsset: "USDC",
          gasPaymentMode: "native-gas",
          totalProposedSpendUSDC: "0.1"
        }
      }),
      policy
    );

    expect(authorization?.programmablePaymentContext).toEqual({
      transferMode: "cctp",
      sourceChain: "ethereum",
      destinationChain: "base",
      finalityMode: "standard",
      attestationStatus: "not_requested",
      estimatedFee: "0.02",
      feeAsset: "USDC",
      gasPaymentMode: "native-gas",
      totalProposedSpendUSDC: "0.1"
    });
  });

  test("does not carry programmable payment context when absent", () => {
    expect(buildExecutionAuthorization(makeAuditRecord(), policy)).not.toHaveProperty("programmablePaymentContext");
  });

  test("does not mutate the audit record or policy config", () => {
    const audit = deepFreeze(makeAuditRecord());
    const frozenPolicy = deepFreeze(policy);
    const beforeAudit = JSON.stringify(audit);
    const beforePolicy = JSON.stringify(policy);

    const authorization = buildExecutionAuthorization(audit, frozenPolicy);

    expect(JSON.stringify(audit)).toBe(beforeAudit);
    expect(JSON.stringify(frozenPolicy)).toBe(beforePolicy);
    expect(authorization).not.toBeNull();
  });

  test("security invariants: exact binding and no execution capability", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.recipient).toBe("trusted-x402-api.demo");
    expect(authorization?.agentId).toBe("agent_auth_demo_001");
    expect(authorization?.maxAmountUSDC).toBe("0.08");
    expect(authorization?.idempotencyKey).toBe("demo-auth-001");
    expect(authorization?.auditId).toBe("audit_20260707_000001");
    expect(authorization?.executionScope).toEqual(["prepare", "simulate"]);
    expect(authorization?.executionScope).not.toEqual(expect.arrayContaining(["execute", "submit", "broadcast", "sign", "settle", "verify"]));
    expect(authorization?.fundsMoved).toBe(false);
    expect(authorization?.executionStatus).toBe("not_executed");
    expect(JSON.stringify(authorization)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase|settlementStatus/i);
  });
});
