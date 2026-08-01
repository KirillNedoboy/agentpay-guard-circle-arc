import { describe, expect, test } from "vitest";
import {
  buildAuditPreview,
  buildDemoSummary,
  buildRailPreviewRows,
  buildReasonCodeRows,
  buildSimulationRows,
  buildSpendControlRows
} from "@/app/demo-metrics";
import type { AuditRecord } from "@/domain/audit/types";

describe("buildDemoSummary", () => {
  test("returns zeroed summary before any selection or evaluations", () => {
    expect(buildDemoSummary(null, [])).toEqual({
      proposedSpend: "0",
      allowedSpend: "0",
      reviewCount: 0,
      blockedCount: 0,
      approvedCount: 0,
      selectedCount: 0
    });
  });

  test("aggregates spend and decision counts from selected sources", () => {
    expect(
      buildDemoSummary(
        {
          selected: [{ source: { id: "s1", price: "0.25" } }, { source: { id: "s2", price: "0.80" } }, { source: { id: "s3", price: "0.35" } }],
          skipped: [],
          totalProposedSpend: "1.40"
        } as never,
        [
          { source: { id: "s1", price: "0.25" }, result: { decision: "ALLOW" } },
          { source: { id: "s2", price: "0.80" }, result: { decision: "REVIEW" } },
          { source: { id: "s3", price: "0.35" }, result: { decision: "BLOCK" } }
        ] as never
      )
    ).toEqual({
      proposedSpend: "1.40",
      allowedSpend: "0.25",
      reviewCount: 1,
      blockedCount: 1,
      approvedCount: 1,
      selectedCount: 3
    });
  });
});

describe("buildRailPreviewRows", () => {
  test("returns compact UI rows for preview-only rail evidence", () => {
    expect(
      buildRailPreviewRows({
        rail: "mock_gateway_nanopayment",
        networkLabel: "Circle Gateway Nanopayment preview",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "premium-evidence-bundle.demo",
        amountUSDC: "0.25",
        explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
      })
    ).toEqual([
      ["Rail", "Circle Gateway Nanopayment preview"],
      ["Asset", "USDC"],
      ["Mode", "mock_preview"],
      ["Recipient", "premium-evidence-bundle.demo"],
      ["Amount", "0.25 USDC"]
    ]);
  });

  test("returns no rows when the API response has no rail preview", () => {
    expect(buildRailPreviewRows(undefined)).toEqual([]);
  });
});

describe("buildReasonCodeRows", () => {
  test("returns explicit reason code rows for policy evidence", () => {
    expect(buildReasonCodeRows(["RECIPIENT_TRUSTED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"])).toEqual([
      ["Reason codes", "RECIPIENT_TRUSTED, AMOUNT_WITHIN_LIMIT, RAIL_PREVIEW_ONLY"]
    ]);
  });

  test("returns no rows when reason codes are absent", () => {
    expect(buildReasonCodeRows(undefined)).toEqual([]);
  });
});

describe("buildAuditPreview", () => {
  test("maps the existing audit record shape to TZ-relevant structured preview fields", () => {
    const preview = buildAuditPreview({
      eventType: "agent_payment_guard_evaluated",
      auditId: "audit_20260630_000001",
      timestamp: "2026-06-30T06:00:00.000Z",
      idempotencyKey: "ignyte-review-premium-dataset-001",
      agentId: "agent_ignyte_demo_001",
      intent: "Buy high-value premium evidence bundle before publishing an agent-generated thesis",
      amount: "0.25",
      currency: "USDC",
      recipient: "premium-evidence-bundle.demo",
      scenario: "data_access",
      paymentRail: "mock_gateway_nanopayment",
      decision: "REVIEW",
      riskScore: 60,
      policyId: "default-agentpay-policy-v1",
      matchedRules: ["recipient_requires_review"],
      reasonCodes: ["RECIPIENT_REVIEW_REQUIRED", "AMOUNT_EXCEEDS_REVIEW_THRESHOLD", "RAIL_PREVIEW_ONLY"],
      reason: "Recipient requires operator review.",
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_gateway_nanopayment",
        networkLabel: "Circle Gateway Nanopayment preview",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "premium-evidence-bundle.demo",
        amountUSDC: "0.25",
        explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
      }
    });

    expect(preview).toEqual({
      intentId: "ignyte-review-premium-dataset-001",
      recipientLabel: "premium-evidence-bundle.demo",
      amountUSDC: "0.25",
      purpose: "premium_research_source",
      rail: "mock_gateway_nanopayment",
      decision: "REVIEW",
      reasonCodes: ["RECIPIENT_REVIEW_REQUIRED", "AMOUNT_EXCEEDS_REVIEW_THRESHOLD", "RAIL_PREVIEW_ONLY"],
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_gateway_nanopayment",
        networkLabel: "Circle Gateway Nanopayment preview",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "premium-evidence-bundle.demo",
        amountUSDC: "0.25",
        explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
      }
    });
    expect(JSON.stringify(preview)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase/i);
  });

  test("returns null when there is no recent audit record", () => {
    expect(buildAuditPreview(undefined)).toBeNull();
  });

  test("keeps policy-envelope evidence in the structured audit preview", () => {
    const preview = buildAuditPreview({
      eventType: "agent_payment_guard_evaluated",
      auditId: "audit_20260801_000001",
      timestamp: "2026-08-01T12:00:00.000Z",
      idempotencyKey: "judge-x402-micropayment-001",
      agentId: "agent_x402_judge_001",
      intent: "Pay 0.08 USDC for a trusted x402-style verification API response",
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "mock_x402_service",
      decision: "ALLOW",
      riskScore: 10,
      policyId: "default-agentpay-policy-v1",
      matchedRules: ["recipient_allowlisted"],
      reasonCodes: ["RECIPIENT_TRUSTED", "RAIL_PREVIEW_ONLY"],
      reason: "Recipient is allowlisted.",
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
      spendControls: {
        currency: "USDC",
        requestedAmount: "0.08",
        maxAmountPerPayment: "10.00",
        reviewThreshold: "0.20",
        dailyLimit: "25.00",
        dailyAllowedSpend: "0",
        dailyRemainingBeforeRequest: "25",
        projectedDailySpend: "0.08",
        velocityWindowSeconds: 60,
        velocityAttempts: 0,
        velocityMaxAttempts: 5
      }
    });

    expect(preview?.spendControls).toMatchObject({
      requestedAmount: "0.08",
      dailyRemainingBeforeRequest: "25",
      velocityAttempts: 0
    });
  });

  test("maps legacy audit records that do not yet store rail preview fields", () => {
    const preview = buildAuditPreview({
      auditId: "audit_20260527_000001",
      timestamp: "2026-05-27T20:25:26.560Z",
      idempotencyKey: "legacy-demo-allow",
      agentId: "agent_market_data_001",
      intent: "Pay $0.005 USDC for market data API access",
      amount: "0.005",
      currency: "USDC",
      recipient: "market-data-api.demo",
      scenario: "api_access",
      paymentRail: "x402_gateway_nanopayment",
      decision: "ALLOW",
      riskScore: 10,
      policyId: "default-agentpay-policy-v1",
      matchedRules: ["recipient_allowlisted"],
      reason: "Recipient is allowlisted."
    } as AuditRecord);

    expect(preview).toMatchObject({
      intentId: "legacy-demo-allow",
      recipientLabel: "market-data-api.demo",
      amountUSDC: "0.005",
      purpose: "api_data_purchase",
      rail: "mock_x402_service",
      decision: "ALLOW",
      reasonCodes: [],
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_x402_service",
        amountUSDC: "0.005",
        recipientId: "market-data-api.demo"
      }
    });
  });
});

describe("buildSimulationRows", () => {
  test("keeps simulated Arc Testnet evidence separate from transaction evidence", () => {
    expect(
      buildSimulationRows({
        status: "simulated",
        broadcast: false,
        verificationStatus: "not_broadcast",
        route: {
          networkName: "Arc Testnet",
          chainId: 5042002,
          rpcUrl: "https://rpc.testnet.arc.io",
          explorerUrl: "https://testnet.arcscan.app",
          assetSymbol: "USDC",
          assetContractAddress: "0x3600000000000000000000000000000000000000",
          assetDecimals: 6
        },
        network: {
          name: "Arc Testnet",
          chainId: 5042002,
          rpcUrl: "https://rpc.testnet.arc.io",
          explorerUrl: "https://testnet.arcscan.app"
        },
        asset: {
          symbol: "USDC",
          contractAddress: "0x3600000000000000000000000000000000000000",
          decimals: 6
        },
        recipientId: "trusted-x402-api.demo",
        amountUSDC: "0.08",
        reason: "Arc Testnet USDC route simulation completed. Settlement was not executed and no funds moved."
      })
    ).toEqual([
      ["Status", "simulated"],
      ["Network", "Arc Testnet (5042002)"],
      ["Asset", "USDC (6 decimals)"],
      ["Amount", "0.08 USDC"],
      ["Broadcast", "not broadcast"],
      ["Verification", "not_broadcast"]
    ]);
  });
});

describe("buildSpendControlRows", () => {
  test("formats a deterministic x402 policy envelope without numeric coercion", () => {
    expect(
      buildSpendControlRows({
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
      })
    ).toEqual([
      ["Request", "0.08 USDC"],
      ["Per-request limit", "10.00 USDC"],
      ["Review threshold", "0.20 USDC"],
      ["Daily spend", "0.105 / 25.00 USDC"],
      ["Daily remaining", "24.895 USDC"],
      ["Projected spend", "0.185 / 25.00 USDC"],
      ["Velocity", "3 / 5 in 60s"]
    ]);
  });
});
