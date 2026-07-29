import { describe, expect, test } from "vitest";
import { simulateArcTestnetSettlement } from "@/domain/payment-intent/arc-testnet-simulation";
import type { PaymentIntent, PolicyDecision } from "@/domain/payment-intent/types";

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    agentId: "agent_ignyte_demo_001",
    intent: "Pay for trusted verification data before publishing research.",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "arc_settlement_preview",
    idempotencyKey: "arc-simulation-test",
    ...overrides
  };
}

const allowDecision: PolicyDecision = {
  decision: "ALLOW",
  riskScore: 10,
  reason: "Trusted request is within policy.",
  matchedRules: ["recipient_allowlisted"],
  reasonCodes: ["ALLOWLISTED_RECIPIENT"],
  policyId: "default-agentpay-policy-v1"
};

describe("Arc Testnet simulation", () => {
  test("simulates an approved Arc USDC intent without broadcast or transaction evidence", () => {
    const simulation = simulateArcTestnetSettlement({ intent: makeIntent(), decision: allowDecision });

    expect(simulation).toMatchObject({
      status: "simulated",
      broadcast: false,
      verificationStatus: "not_broadcast",
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
      amountUSDC: "0.08",
      recipientId: "trusted-x402-api.demo"
    });
    expect(simulation.reason).toContain("Settlement was not executed");
    expect(JSON.stringify(simulation)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase/i);
  });

  test("does not simulate REVIEW or BLOCK decisions", () => {
    const simulation = simulateArcTestnetSettlement({
      intent: makeIntent(),
      decision: { ...allowDecision, decision: "REVIEW" }
    });

    expect(simulation).toMatchObject({
      status: "not_eligible",
      broadcast: false,
      verificationStatus: "not_broadcast"
    });
    expect(simulation.reason).toContain("ALLOW");
  });

  test("rejects a non-Arc route or a non-USDC asset as not eligible", () => {
    const simulation = simulateArcTestnetSettlement({
      intent: makeIntent(),
      decision: allowDecision,
      route: {
        ...simulateArcTestnetSettlement({ intent: makeIntent(), decision: allowDecision }).route,
        chainId: 1,
        assetSymbol: "EURC"
      }
    });

    expect(simulation).toMatchObject({ status: "not_eligible", broadcast: false });
    expect(simulation.reason).toContain("Arc Testnet USDC");
  });

  test("reports an unavailable simulation adapter without falling through to settlement", () => {
    const simulation = simulateArcTestnetSettlement({
      intent: makeIntent(),
      decision: allowDecision,
      adapterAvailable: false
    });

    expect(simulation).toMatchObject({
      status: "not_executed",
      broadcast: false,
      verificationStatus: "not_broadcast"
    });
    expect(simulation.reason).toContain("unavailable");
  });
});
