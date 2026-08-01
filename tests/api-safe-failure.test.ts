import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildCircleRailPreview } from "@/domain/payment-intent/rail-preview";
import { buildArcTestnetSimulation } from "@/domain/payment-intent/arc-testnet-simulation";
import { buildProgrammablePaymentContext } from "@/domain/payment-intent/programmable-payment-context";
import type { AuditRecord } from "@/domain/audit/types";
import type { PaymentIntent, PolicyDecision } from "@/domain/payment-intent/types";

const auditLog = vi.hoisted(() => ({
  createOrReuseAuditRecord: vi.fn(),
  readRecentAuditRecords: vi.fn(() => [])
}));

vi.mock("@/domain/audit/audit-log", () => auditLog);

import { safeEvaluatePaymentIntent } from "@/domain/payment-intent/evaluate";

function makeAuditRecord(intent: PaymentIntent, decision: PolicyDecision): AuditRecord {
  const railPreview = buildCircleRailPreview(intent);
  const programmablePaymentContext = buildProgrammablePaymentContext(intent);

  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_api_evidence_000001",
    timestamp: "2026-07-16T12:00:00.000Z",
    intentId: intent.idempotencyKey,
    idempotencyKey: intent.idempotencyKey,
    agentId: intent.agentId,
    intent: intent.intent,
    amount: intent.amount,
    amountUSDC: intent.amount,
    currency: intent.currency,
    recipient: intent.recipient,
    recipientId: intent.recipient,
    recipientLabel: intent.recipient,
    scenario: intent.scenario,
    paymentRail: intent.paymentRail,
    rail: railPreview.rail,
    decision: decision.decision,
    riskScore: decision.riskScore,
    policyId: decision.policyId,
    matchedRules: decision.matchedRules,
    reasonCodes: decision.reasonCodes,
    reason: decision.reason,
    ...(programmablePaymentContext ? { programmablePaymentContext } : {}),
    ...(decision.spendControls ? { spendControls: decision.spendControls } : {}),
    arcTestnetSimulation: buildArcTestnetSimulation(intent),
    executionMode: railPreview.executionMode,
    railPreview
  };
}

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent_api_evidence_001",
    intent: "Propose a trusted USDC API payment",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "api-evidence-default",
    ...overrides
  };
}

beforeEach(() => {
  auditLog.createOrReuseAuditRecord.mockReset();
  auditLog.readRecentAuditRecords.mockReset();
  auditLog.readRecentAuditRecords.mockReturnValue([]);
  auditLog.createOrReuseAuditRecord.mockImplementation(async (_auditPath: string, intent: PaymentIntent, decision: PolicyDecision) =>
    makeAuditRecord(intent, decision)
  );
});

describe("safe payment intent evaluation", () => {
  test.each([
    [
      "CCTP",
      makeIntent({
        idempotencyKey: "api-cctp-evidence",
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          estimatedFee: "0.02",
          feeAsset: "USDC"
        }
      }),
      "cctpRoutePreview"
    ],
    [
      "ERC-20 authority",
      makeIntent({
        idempotencyKey: "api-erc20-evidence",
        operation: "approve",
        spender: "trusted-agent-service",
        amountBaseUnits: "80000"
      }),
      "erc20AuthorityPreview"
    ],
    [
      "Paymaster preview",
      makeIntent({
        idempotencyKey: "api-paymaster-evidence",
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          estimatedFee: "0.02",
          feeAsset: "USDC",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      "usdcPaymasterPreview"
    ]
  ])("returns stable evidence for a valid %s request", async (_label, input, previewField) => {
    const response = await safeEvaluatePaymentIntent(input);
    const body = (await response.json()) as {
      decision: string;
      reasonCodes: string[];
      auditId: string | null;
      railPreview: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.decision).toBe("ALLOW");
    expect(body.reasonCodes).toContain("RAIL_PREVIEW_ONLY");
    expect(body.auditId).toBe("audit_api_evidence_000001");
    expect(body.railPreview).toHaveProperty(previewField);
    expect(auditLog.createOrReuseAuditRecord).toHaveBeenCalledTimes(1);
  });

  test("returns the persisted x402 spend-control envelope on a successful evaluation", async () => {
    const response = await safeEvaluatePaymentIntent(makeIntent({ idempotencyKey: "api-x402-envelope" }));
    const body = (await response.json()) as {
      decision: string;
      spendControls?: {
        requestedAmount: string;
        dailyAllowedSpend: string;
        projectedDailySpend: string;
        velocityAttemptCount: number;
      };
      arcTestnetSimulation?: { broadcast: boolean; status: string };
    };

    expect(response.status).toBe(200);
    expect(body.decision).toBe("ALLOW");
    expect(body.spendControls).toMatchObject({
      requestedAmount: "0.08",
      dailyAllowedSpend: "0",
      projectedDailySpend: "0.08",
      velocityAttemptCount: 0
    });
    expect(body.arcTestnetSimulation).toMatchObject({
      broadcast: false,
      status: "not_executed"
    });
  });

  test("invalid nested route context never returns ALLOW or creates audit evidence", async () => {
    const response = await safeEvaluatePaymentIntent(
      makeIntent({
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          providerId: "forbidden"
        }
      })
    );
    const body = (await response.json()) as { decision: string; auditId: string | null; reason: string };

    expect(response.status).toBe(400);
    expect(body.decision).toBe("BLOCK");
    expect(body.auditId).toBeNull();
    expect(body.reason).not.toMatch(/stack|config|C:\\|node_modules/i);
    expect(auditLog.createOrReuseAuditRecord).not.toHaveBeenCalled();
  });

  test("storage failure remains fail-closed without partial audit evidence or internal details", async () => {
    auditLog.createOrReuseAuditRecord.mockRejectedValueOnce(new Error("C:\\secret\\policy-config.json"));

    const response = await safeEvaluatePaymentIntent(makeIntent({ idempotencyKey: "api-storage-failure" }));
    const body = (await response.json()) as { decision: string; auditId: string | null; reason: string };

    expect(response.status).toBe(500);
    expect(body.decision).toBe("REVIEW");
    expect(body.decision).not.toBe("ALLOW");
    expect(body.auditId).toBeNull();
    expect(body.reason).toBe("Internal evaluation failure. Payment must not proceed.");
    expect(JSON.stringify(body)).not.toMatch(/secret|policy-config|stack|C:\\/i);
    expect(auditLog.createOrReuseAuditRecord).toHaveBeenCalledTimes(1);
  });
});
