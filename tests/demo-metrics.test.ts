import { describe, expect, test } from "vitest";
import {
  buildAuditPreview,
  buildCctpRouteExplanation,
  buildDemoSummary,
  buildProgrammableEvidenceRows,
  buildRailPreviewRows,
  buildReasonCodeRows
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

describe("buildProgrammableEvidenceRows", () => {
  test("returns ordered CCTP route, fee, and wallet proposal evidence", () => {
    expect(
      buildProgrammableEvidenceRows(
        {
          rail: "mock_x402_service",
          networkLabel: "x402-compatible paid API",
          settlementAsset: "USDC",
          executionMode: "mock_preview",
          recipientId: "trusted-x402-api.demo",
          amountUSDC: "5.01",
          explanation: "Preview only.",
          cctpRoutePreview: {
            mode: "cctp_route_preview",
            sourceChain: "Ethereum",
            destinationChain: "Base",
            asset: "native USDC (proposed)",
            finalityMode: "fast-transfer",
            attestation: "not requested",
            walletControlModel: "developer-controlled",
            proposedAmountUSDC: "5.01",
            estimatedFeeUSDC: "0.02",
            totalProposedSpendUSDC: "5.03"
          }
        },
        {
          transferMode: "cctp",
          gasPaymentMode: "native-gas"
        }
      )
    ).toEqual([
      ["Transfer mode", "cctp"],
      ["Route", "Ethereum → Base"],
      ["Finality", "fast-transfer"],
      ["Attestation", "not requested"],
      ["Wallet control", "developer-controlled"],
      ["Proposed amount", "5.01 USDC"],
      ["Estimated fee", "0.02 USDC"],
      ["Total proposed spend", "5.03 USDC"],
      ["Gas payment", "native-gas"]
    ]);
  });

  test("returns authority evidence from ERC-20 preview context", () => {
    expect(
      buildProgrammableEvidenceRows({
        rail: "mock_x402_service",
        networkLabel: "x402-compatible paid API",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "trusted-x402-api.demo",
        amountUSDC: "5.01",
        explanation: "Preview only.",
        erc20AuthorityPreview: {
          mode: "erc20_authority_preview",
          operation: "approve",
          spender: "trusted-agent-service",
          suppliedAmountBaseUnits: "5010000",
          explanation: "Authority preview only."
        }
      })
    ).toEqual([
      ["Operation", "approve"],
      ["Spender", "trusted-agent-service"],
      ["Amount base units", "5010000"]
    ]);
  });

  test("omits execution-only language from evidence rows", () => {
    const rows = buildProgrammableEvidenceRows(undefined);

    expect(rows).toEqual([]);
    expect(JSON.stringify(rows)).not.toMatch(/transactionHash|txHash|completed|settled|confirmed/i);
  });
});

describe("buildCctpRouteExplanation", () => {
  test("explains the proposed CCTP lane without tracker semantics", () => {
    expect(
      buildCctpRouteExplanation({
        rail: "mock_x402_service",
        networkLabel: "x402-compatible paid API",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "trusted-x402-api.demo",
        amountUSDC: "0.08",
        explanation: "Preview only.",
        cctpRoutePreview: {
          mode: "cctp_route_preview",
          sourceChain: "Ethereum",
          destinationChain: "Base",
          asset: "native USDC (proposed)",
          finalityMode: "standard",
          attestation: "not requested",
          proposedAmountUSDC: "0.08"
        }
      })
    ).toEqual({
      label: "Preview only",
      steps: [
        "Proposed Ethereum USDC",
        "CCTP burn — not executed",
        "Iris attestation — not requested / not verified here",
        "Proposed Base USDC mint — not executed"
      ]
    });
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
      matchedRules: ["recipient_requires_review"],
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

  test("includes audit policy matches and programmable context when present", () => {
    const preview = buildAuditPreview({
      eventType: "agent_payment_guard_evaluated",
      auditId: "audit_programmable_000001",
      timestamp: "2026-07-16T12:00:00.000Z",
      idempotencyKey: "audit-programmable",
      agentId: "agent_cctp_demo_001",
      intent: "Propose standard CCTP USDC route",
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "mock_x402_service",
      decision: "ALLOW",
      riskScore: 10,
      policyId: "default-agentpay-policy-v1",
      matchedRules: ["recipient_allowlisted", "scenario_allowed"],
      reasonCodes: ["RAIL_PREVIEW_ONLY"],
      reason: "Policy allows the proposal.",
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
      programmablePaymentContext: {
        transferMode: "cctp",
        sourceChain: "ethereum",
        destinationChain: "base",
        estimatedFee: "0.01",
        totalProposedSpendUSDC: "0.09"
      }
    });

    expect(preview).toMatchObject({
      matchedRules: ["recipient_allowlisted", "scenario_allowed"],
      programmablePaymentContext: {
        transferMode: "cctp",
        totalProposedSpendUSDC: "0.09"
      }
    });
  });

  test("returns null when there is no recent audit record", () => {
    expect(buildAuditPreview(undefined)).toBeNull();
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
