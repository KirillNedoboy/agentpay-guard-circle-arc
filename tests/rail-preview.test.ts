import { describe, expect, test } from "vitest";
import { buildCircleRailPreview } from "@/domain/payment-intent/rail-preview";
import type { PaymentIntent } from "@/domain/payment-intent/types";

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    agentId: "agent_ignyte_demo_001",
    intent: "Buy premium verification data for a research task",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "rail-preview-test",
    ...overrides
  };
}

describe("Circle and Arc rail preview", () => {
  test("creates a CCTP route preview for a standard Ethereum to Base proposal", () => {
    const preview = buildCircleRailPreview(
      makeIntent({
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          finalityMode: "standard",
          attestationStatus: "not_requested",
          walletControlModel: "user-controlled"
        }
      })
    );

    expect(preview.cctpRoutePreview).toEqual({
      mode: "cctp_route_preview",
      sourceChain: "Ethereum",
      destinationChain: "Base",
      asset: "native USDC (proposed)",
      finalityMode: "standard",
      attestation: "not requested",
      walletControlModel: "user-controlled",
      proposedAmountUSDC: "0.08"
    });
    expect(preview.explanation).toBe(
      "Preview only. No funds moved, no CCTP burn or mint occurred, no Iris attestation was requested, and no Circle API was called."
    );
  });

  test("distinguishes Fast Transfer context and calculates proposed spend with decimal strings", () => {
    const preview = buildCircleRailPreview(
      makeIntent({
        amount: "99.99",
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          finalityMode: "fast-transfer",
          estimatedFee: "0.02",
          feeAsset: "USDC"
        }
      })
    );

    expect(preview.cctpRoutePreview).toMatchObject({
      finalityMode: "fast-transfer",
      estimatedFeeUSDC: "0.02",
      totalProposedSpendUSDC: "100.01"
    });
  });

  test("labels a claimed verified attestation as unverified by the app", () => {
    const preview = buildCircleRailPreview(
      makeIntent({
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          attestationStatus: "verified"
        }
      })
    );

    expect(preview.cctpRoutePreview?.attestation).toBe("claimed verified (unverified by this app)");
  });

  test("does not fabricate execution evidence in a CCTP route preview", () => {
    const preview = buildCircleRailPreview(
      makeIntent({
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          attestationStatus: "pending"
        }
      })
    );
    const output = JSON.stringify(preview);

    expect(output).not.toMatch(/transactionHash|txHash|signature|burned|minted|settled|completed/i);
    expect(preview.explanation).toContain("No funds moved");
    expect(preview.explanation).toContain("no Circle API was called");
  });

  test("generates a mock x402 paid API preview without execution data", () => {
    const preview = buildCircleRailPreview(makeIntent());

    expect(preview).toEqual({
      rail: "mock_x402_service",
      networkLabel: "x402-compatible paid API",
      settlementAsset: "USDC",
      executionMode: "mock_preview",
      recipientId: "trusted-x402-api.demo",
      amountUSDC: "0.08",
      explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
    });
    expect(Object.keys(preview)).not.toEqual(expect.arrayContaining(["transactionHash", "txHash", "signature", "privateKey"]));
    expect(preview.cctpRoutePreview).toBeUndefined();
  });

  test("generates an Arc settlement preview with USDC as the settlement asset", () => {
    const preview = buildCircleRailPreview(
      makeIntent({
        amount: "0.25",
        paymentRail: "arc_settlement_preview",
        recipient: "premium-evidence-bundle.demo"
      })
    );

    expect(preview.rail).toBe("arc_settlement_preview");
    expect(preview.networkLabel).toBe("Arc settlement preview");
    expect(preview.settlementAsset).toBe("USDC");
    expect(preview.executionMode).toBe("mock_preview");
    expect(preview.amountUSDC).toBe("0.25");
  });

  test("keeps unknown rails live-disabled instead of pretending to execute", () => {
    const preview = buildCircleRailPreview(makeIntent({ paymentRail: "future_live_circle_api" }));

    expect(preview.rail).toBe("mock_agent_wallet");
    expect(preview.networkLabel).toBe("Circle Agent Wallet preview");
    expect(preview.executionMode).toBe("live_disabled");
    expect(preview.explanation).toContain("Live payment rail is disabled");
  });
});
