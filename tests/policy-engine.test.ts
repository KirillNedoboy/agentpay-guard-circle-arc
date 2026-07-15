import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";
import type { AuditRecord } from "@/domain/audit/types";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

function loadScenario(fileName: string) {
  const raw = readFileSync(join(root, "examples", fileName), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  delete parsed.expectedDecision;
  const intent = parsed;
  return validatePaymentIntent(intent);
}

describe("policy engine", () => {
  test("loads separate local spender policy lists", () => {
    expect(policy.allowances.reviewThreshold).toBe("5.00");
    expect(policy.spenders).toEqual({
      allowed: ["trusted-agent-service"],
      denied: ["blocked-spender"]
    });
  });

  test("blocks an approval proposal without a spender", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "approve" }), policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("ALLOWANCE_SPENDER_REQUIRED");
    expect(result.matchedRules).toContain("allowance_spender_required");
  });

  test("does not add an authority escalation for an approval exactly at the threshold", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "approve", spender: "trusted-agent-service", amount: "5.00" }), policy, []);

    expect(result.reasonCodes).not.toContain("ALLOWANCE_REVIEW_REQUIRED");
    expect(result.matchedRules).not.toContain("allowance_review_required");
  });

  test("reviews an approval proposal above the allowance threshold", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "approve", spender: "trusted-agent-service", amount: "5.01" }), policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("ALLOWANCE_REVIEW_REQUIRED");
    expect(result.matchedRules).toContain("allowance_review_required");
  });

  test("blocks a transferFrom proposal without a spender", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "transferFrom" }), policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("TRANSFER_FROM_SPENDER_REQUIRED");
    expect(result.matchedRules).toContain("transfer_from_spender_required");
  });

  test("blocks a transferFrom proposal with a denied spender", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "transferFrom", spender: "blocked-spender" }), policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("SPENDER_BLOCKED");
    expect(result.matchedRules).toContain("spender_blocked");
  });

  test("reviews a transferFrom proposal with an unknown spender", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "transferFrom", spender: "new-spender" }), policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("SPENDER_REVIEW_REQUIRED");
    expect(result.matchedRules).toContain("spender_review_required");
  });

  test("does not add an authority escalation for an allowed transferFrom spender", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "transferFrom", spender: "trusted-agent-service" }), policy, []);

    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCodes).not.toEqual(expect.arrayContaining(["SPENDER_BLOCKED", "SPENDER_REVIEW_REQUIRED"]));
  });

  test("does not add an authority escalation for a direct transfer", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "transfer" }), policy, []);

    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCodes).not.toEqual(expect.arrayContaining([expect.stringMatching(/SPENDER|ALLOWANCE/)]));
  });

  test("retains an existing hard block with an authority review condition", () => {
    const result = evaluatePolicy(
      makeAuthorityIntent({ recipient: "blocked-recipient.demo", operation: "transferFrom", spender: "new-spender" }),
      policy,
      []
    );

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["RECIPIENT_BLOCKED", "SPENDER_REVIEW_REQUIRED"]));
  });

  test("keeps authority reason codes and matched rules deduplicated", () => {
    const result = evaluatePolicy(makeAuthorityIntent({ operation: "transferFrom", spender: "new-spender" }), policy, []);

    expect(new Set(result.reasonCodes).size).toBe(result.reasonCodes.length);
    expect(new Set(result.matchedRules).size).toBe(result.matchedRules.length);
  });

  test("loads the local CCTP demo-policy configuration", () => {
    expect(policy.crossChain).toEqual({
      allowedCctpPairs: [{ sourceChain: "ethereum", destinationChain: "base" }],
      fastTransferReviewThreshold: "5.00",
      developerControlledReviewThreshold: "5.00",
      maxTotalUsdcSpend: "100.00"
    });
    expect(policy.allowances.reviewThreshold).toBe("5.00");
  });

  test("loads a separate local Paymaster demo-policy budget", () => {
    const paymasterPolicy = policy as unknown as { paymaster?: { maxTotalUsdcSpend?: string } };

    expect(paymasterPolicy.paymaster).toEqual({
      maxTotalUsdcSpend: "100.00"
    });
  });

  test("reviews a Paymaster preview without an estimated fee", () => {
    const result = evaluatePolicy(makePaymasterIntent(), policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("PAYMASTER_FEE_ESTIMATE_REQUIRED");
    expect(result.matchedRules).toContain("paymaster_fee_estimate_required");
  });

  test("keeps a user-controlled Paymaster preview under budget at its existing decision", () => {
    const result = evaluatePolicy(
      makePaymasterIntent({
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          walletControlModel: "user-controlled",
          estimatedFee: "0.02",
          feeAsset: "USDC",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      policy,
      []
    );

    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCodes).not.toEqual(
      expect.arrayContaining(["PAYMASTER_FEE_ESTIMATE_REQUIRED", "PAYMASTER_DEVELOPER_CONTROLLED_REVIEW_REQUIRED"])
    );
  });

  test("reviews a developer-controlled Paymaster preview", () => {
    const result = evaluatePolicy(
      makePaymasterIntent({
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          walletControlModel: "developer-controlled",
          estimatedFee: "0.02",
          feeAsset: "USDC",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      policy,
      []
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("PAYMASTER_DEVELOPER_CONTROLLED_REVIEW_REQUIRED");
    expect(result.matchedRules).toContain("paymaster_developer_controlled_review_required");
  });

  test("blocks when decimal-safe Paymaster total spend exceeds its separate budget", () => {
    const result = evaluatePolicy(
      makePaymasterIntent({
        amount: "0.08",
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          estimatedFee: "99.93",
          feeAsset: "USDC",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      policy,
      []
    );

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("TOTAL_USDC_BUDGET_EXCEEDED");
    expect(result.matchedRules).toContain("total_usdc_budget_exceeded");
  });

  test("does not block a Paymaster preview exactly at its total budget", () => {
    const result = evaluatePolicy(
      makePaymasterIntent({
        amount: "0.08",
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          estimatedFee: "99.92",
          feeAsset: "USDC",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      policy,
      []
    );

    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCodes).not.toContain("TOTAL_USDC_BUDGET_EXCEEDED");
  });

  test("retains an existing hard block with Paymaster review conditions", () => {
    const result = evaluatePolicy(
      makePaymasterIntent({
        recipient: "blocked-recipient.demo",
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          walletControlModel: "developer-controlled",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      policy,
      []
    );

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["RECIPIENT_BLOCKED", "PAYMASTER_FEE_ESTIMATE_REQUIRED", "PAYMASTER_DEVELOPER_CONTROLLED_REVIEW_REQUIRED"])
    );
  });

  test("does not add Paymaster rules for native gas", () => {
    const result = evaluatePolicy(
      makePaymasterIntent({
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          walletControlModel: "developer-controlled",
          gasPaymentMode: "native-gas"
        }
      }),
      policy,
      []
    );

    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCodes).not.toEqual(expect.arrayContaining([expect.stringMatching(/^PAYMASTER_/)]));
  });

  test("deduplicates the shared CCTP and Paymaster budget evidence", () => {
    const result = evaluatePolicy(
      makePaymasterIntent({
        amount: "0.08",
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          estimatedFee: "99.93",
          feeAsset: "USDC",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      policy,
      []
    );

    expect(result.reasonCodes.filter((code) => code === "TOTAL_USDC_BUDGET_EXCEEDED")).toHaveLength(1);
    expect(result.matchedRules.filter((rule) => rule === "total_usdc_budget_exceeded")).toHaveLength(1);
  });

  test("keeps a valid standard Ethereum to Base CCTP route at its existing decision", () => {
    const result = evaluatePolicy(makeCctpIntent(), policy, []);

    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCodes).not.toEqual(expect.arrayContaining([expect.stringMatching(/^CCTP_/)]));
    expect(result.matchedRules).not.toEqual(expect.arrayContaining([expect.stringMatching(/^cctp_/)]));
  });

  test("blocks a same-chain CCTP proposal", () => {
    const result = evaluatePolicy(makeCctpIntent({ routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "ethereum" } }), policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("CCTP_SOURCE_EQUALS_DESTINATION");
    expect(result.matchedRules).toContain("cctp_source_equals_destination");
    expect(result.reasonCodes).not.toContain("CCTP_ROUTE_UNSUPPORTED");
  });

  test("blocks an unsupported CCTP route", () => {
    const result = evaluatePolicy(makeCctpIntent({ routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "arbitrum" } }), policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("CCTP_ROUTE_UNSUPPORTED");
    expect(result.matchedRules).toContain("cctp_route_unsupported");
  });

  test("reviews Fast Transfer proposals above the local threshold and below the hard max", () => {
    const result = evaluatePolicy(
      makeCctpIntent({ amount: "5.01", routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "base", finalityMode: "fast-transfer" } }),
      policy,
      []
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("CCTP_FAST_TRANSFER_REVIEW_REQUIRED");
    expect(result.matchedRules).toContain("cctp_fast_transfer_review_required");
  });

  test("reviews developer-controlled CCTP proposals above the local threshold", () => {
    const result = evaluatePolicy(
      makeCctpIntent({ amount: "5.01", routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "base", walletControlModel: "developer-controlled" } }),
      policy,
      []
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("CCTP_DEVELOPER_CONTROLLED_REVIEW_REQUIRED");
    expect(result.matchedRules).toContain("cctp_developer_controlled_review_required");
  });

  test("reviews a claimed verified attestation without treating it as confirmed", () => {
    const result = evaluatePolicy(
      makeCctpIntent({ routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "base", attestationStatus: "verified" } }),
      policy,
      []
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toContain("CCTP_ATTESTATION_UNVERIFIABLE_IN_PREVIEW");
    expect(result.matchedRules).toContain("cctp_attestation_unverifiable_in_preview");
    expect(result.reason).toContain("cannot verify");
  });

  test("blocks when decimal-safe proposed amount plus fee exceeds the CCTP budget", () => {
    const result = evaluatePolicy(
      makeCctpIntent({ amount: "99.99", routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "base", estimatedFee: "0.02", feeAsset: "USDC" } }),
      policy,
      []
    );

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toContain("TOTAL_USDC_BUDGET_EXCEEDED");
    expect(result.matchedRules).toContain("total_usdc_budget_exceeded");
  });

  test("retains an existing hard block when CCTP review conditions also apply", () => {
    const result = evaluatePolicy(
      makeCctpIntent({ recipient: "blocked-recipient.demo", amount: "5.01", routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "base", finalityMode: "fast-transfer", attestationStatus: "verified" } }),
      policy,
      []
    );

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["RECIPIENT_BLOCKED", "CCTP_FAST_TRANSFER_REVIEW_REQUIRED", "CCTP_ATTESTATION_UNVERIFIABLE_IN_PREVIEW"]));
  });

  test("keeps multiple CCTP review reason codes stable and deduplicated", () => {
    const result = evaluatePolicy(
      makeCctpIntent({ amount: "5.01", routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "base", finalityMode: "fast-transfer", attestationStatus: "verified", walletControlModel: "developer-controlled" } }),
      policy,
      []
    );
    const cctpReasonCodes = result.reasonCodes.filter((code) => code.startsWith("CCTP_"));
    const cctpMatchedRules = result.matchedRules.filter((rule) => rule.startsWith("cctp_"));

    expect(result.decision).toBe("REVIEW");
    expect(cctpReasonCodes).toEqual([
      "CCTP_ATTESTATION_UNVERIFIABLE_IN_PREVIEW",
      "CCTP_FAST_TRANSFER_REVIEW_REQUIRED",
      "CCTP_DEVELOPER_CONTROLLED_REVIEW_REQUIRED"
    ]);
    expect(cctpMatchedRules).toEqual([
      "cctp_attestation_unverifiable_in_preview",
      "cctp_fast_transfer_review_required",
      "cctp_developer_controlled_review_required"
    ]);
    expect(new Set(result.reasonCodes).size).toBe(result.reasonCodes.length);
    expect(new Set(result.matchedRules).size).toBe(result.matchedRules.length);
  });

  test("allows trusted x402 API spend with stable AgentPay reason codes", () => {
    const intent = validatePaymentIntent({
      agentId: "agent_ignyte_demo_001",
      intent: "Buy premium verification data for a research task",
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "mock_x402_service",
      idempotencyKey: "ignyte-allow-x402"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["RECIPIENT_TRUSTED", "PURPOSE_ALLOWED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"])
    );
  });

  test("reviews premium dataset spend above the review threshold", () => {
    const intent = validatePaymentIntent({
      agentId: "agent_ignyte_demo_001",
      intent: "Buy high-value premium source bundle for an agent research task",
      amount: "0.25",
      currency: "USDC",
      recipient: "premium-evidence-bundle.demo",
      scenario: "data_access",
      paymentRail: "mock_gateway_nanopayment",
      idempotencyKey: "ignyte-review-premium-dataset"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["RECIPIENT_REVIEW_REQUIRED", "PURPOSE_ALLOWED", "AMOUNT_EXCEEDS_REVIEW_THRESHOLD", "RAIL_PREVIEW_ONLY"])
    );
  });

  test("blocks untrusted source spend before any rail execution", () => {
    const intent = validatePaymentIntent({
      agentId: "agent_ignyte_demo_001",
      intent: "Buy scraped unverified data cache",
      amount: "0.04",
      currency: "USDC",
      recipient: "blocked-recipient.demo",
      scenario: "data_access",
      paymentRail: "arc_settlement_preview",
      idempotencyKey: "ignyte-block-untrusted-source"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["RECIPIENT_BLOCKED", "PURPOSE_ALLOWED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"])
    );
  });

  test("allows the API nanopayment scenario", () => {
    const result = evaluatePolicy(loadScenario("scenario-allow-api.json"), policy, []);

    expect(result.decision).toBe("ALLOW");
    expect(result.riskScore).toBeLessThan(30);
    expect(result.matchedRules).toContain("recipient_allowlisted");
    expect(result.matchedRules).toContain("scenario_allowed");
  });

  test("reviews the machine-to-machine scenario", () => {
    const result = evaluatePolicy(loadScenario("scenario-review-machine.json"), policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.riskScore).toBeGreaterThanOrEqual(30);
    expect(result.matchedRules).toContain("recipient_requires_review");
  });

  test("blocks the risky autonomous spend scenario", () => {
    const result = evaluatePolicy(loadScenario("scenario-block-risky.json"), policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.matchedRules).toContain("recipient_denied");
    expect(result.matchedRules).toContain("scenario_allowed");
  });

  test("blocks invalid amount strings", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      amount: "1.2.3",
      idempotencyKey: "invalid-amount-test"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.matchedRules).toContain("amount_invalid");
  });

  test("blocks unsupported currency", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      currency: "ETH",
      idempotencyKey: "unsupported-currency-test"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.matchedRules).toContain("currency_unsupported");
  });

  test.each([
    ["0", "amount_invalid"],
    ["-1", "amount_invalid"],
    ["1.2.3", "amount_invalid"],
    ["999999999999999999999999999999.999999", "amount_above_hard_max"]
  ])("blocks invalid or unsafe amount edge case %s", (amount, expectedRule) => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      amount,
      idempotencyKey: `amount-edge-${amount}`
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.matchedRules).toContain(expectedRule);
  });

  test("allows tiny positive decimal amounts without floating-point math", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      amount: "0.000001",
      idempotencyKey: "tiny-positive-decimal"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("ALLOW");
    expect(result.matchedRules).toContain("amount_below_per_payment_limit");
  });

  test("blocks denylisted recipients", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      recipient: "blocked-recipient.demo",
      idempotencyKey: "denylisted-recipient"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("BLOCK");
    expect(result.matchedRules).toContain("recipient_denied");
  });

  test("reviews unknown recipients", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      recipient: "new-api.demo",
      idempotencyKey: "unknown-recipient"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.matchedRules).toContain("recipient_unknown");
  });

  test("reviews unknown scenarios", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      scenario: "new_scenario",
      idempotencyKey: "unknown-scenario"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.matchedRules).toContain("scenario_unknown");
  });

  test("suspicious keywords increase risk and require review", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      intent: "Pay $0.005 USDC for unverified API access",
      idempotencyKey: "suspicious-keyword"
    });

    const result = evaluatePolicy(intent, policy, []);

    expect(result.decision).toBe("REVIEW");
    expect(result.riskScore).toBeGreaterThanOrEqual(policy.decisionThresholds.reviewAt);
    expect(result.matchedRules).toContain("suspicious_keyword_detected");
  });

  test("blocks when daily spend limit would be exceeded", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      amount: "0.01",
      idempotencyKey: "daily-limit"
    });
    const existingAllowedSpend = makeAuditRecord({
      agentId: intent.agentId,
      amount: "25.00",
      decision: "ALLOW"
    });

    const result = evaluatePolicy(intent, policy, [existingAllowedSpend]);

    expect(result.decision).toBe("BLOCK");
    expect(result.matchedRules).toContain("daily_limit_exceeded");
  });

  test("reviews when velocity limit is exceeded", () => {
    const intent = validatePaymentIntent({
      ...loadScenario("scenario-allow-api.json"),
      idempotencyKey: "velocity-limit"
    });
    const recentAttempts = Array.from({ length: policy.velocity.maxAttemptsPerWindow }, (_, index) =>
      makeAuditRecord({
        auditId: `audit_velocity_${index}`,
        agentId: intent.agentId,
        idempotencyKey: `velocity-${index}`,
        timestamp: new Date().toISOString()
      })
    );

    const result = evaluatePolicy(intent, policy, recentAttempts);

    expect(result.decision).toBe("REVIEW");
    expect(result.matchedRules).toContain("velocity_limit_exceeded");
  });
});

function makeCctpIntent(overrides: Record<string, unknown> = {}) {
  return validatePaymentIntent({
    agentId: "agent_cctp_policy_001",
    intent: "Propose a USDC CCTP route for a trusted API payment",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "cctp-policy-test",
    routeContext: {
      transferMode: "cctp",
      sourceChain: "ethereum",
      destinationChain: "base",
      finalityMode: "standard",
      attestationStatus: "not_requested",
      walletControlModel: "user-controlled"
    },
    ...overrides
  });
}

function makePaymasterIntent(overrides: Record<string, unknown> = {}) {
  return validatePaymentIntent({
    agentId: "agent_paymaster_policy_001",
    intent: "Propose a USDC Paymaster preview for a trusted API payment",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "paymaster-policy-test",
    routeContext: {
      transferMode: "single-chain",
      sourceChain: "ethereum",
      destinationChain: "ethereum",
      gasPaymentMode: "usdc-paymaster-preview"
    },
    ...overrides
  });
}

function makeAuthorityIntent(overrides: Record<string, unknown> = {}) {
  return validatePaymentIntent({
    agentId: "agent_authority_policy_001",
    intent: "Propose a USDC ERC-20 authority operation for a trusted service",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "authority-policy-test",
    ...overrides
  });
}

function makeAuditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_test_000001",
    timestamp: new Date().toISOString(),
    idempotencyKey: "audit-test",
    agentId: "agent_market_data_001",
    intent: "Pay $1 USDC for market data API access",
    amount: "1.00",
    currency: "USDC",
    recipient: "market-data-api.demo",
    scenario: "api_access",
    paymentRail: "x402_gateway_nanopayment",
    decision: "ALLOW",
    riskScore: 10,
    policyId: "default-agentpay-policy-v1",
    matchedRules: ["recipient_allowlisted"],
    reasonCodes: ["RECIPIENT_TRUSTED", "PURPOSE_ALLOWED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"],
    reason: "test record",
    executionMode: "mock_preview",
    railPreview: {
      rail: "mock_x402_service",
      networkLabel: "x402-compatible paid API",
      settlementAsset: "USDC",
      executionMode: "mock_preview",
      recipientId: "market-data-api.demo",
      amountUSDC: "1.00",
      explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
    },
    ...overrides
  };
}
