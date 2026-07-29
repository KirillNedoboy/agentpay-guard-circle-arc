import { describe, expect, test } from "vitest";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import {
  citePayDemoPreset,
  citePayMockSources,
  mapSourceToPaymentIntent,
  selectCitePaySources
} from "@/domain/citepay/source-selection";
import { addDecimalStrings } from "@/lib/decimal";

const policy = loadPolicyConfig("data/policies.default.json");

describe("CitePay source selection", () => {
  test("selects paid sources by deterministic query relevance", () => {
    const result = selectCitePaySources({
      agentId: "agent_ignyte_demo_001",
      query: "Need verification data and premium evidence for an agent research task",
      budget: "0.35",
      sources: citePayMockSources
    });

    expect(result.selected.map((item) => item.source.id)).toEqual([
      "trusted-x402-verification-api",
      "premium-evidence-bundle"
    ]);
    expect(result.skipped.find((item) => item.source.id === "market-data-note")?.reason).toBe("not_relevant");
  });

  test("skips relevant sources that exceed the decimal-string budget cap", () => {
    const result = selectCitePaySources({
      agentId: "agent_ignyte_demo_001",
      query: "Need verification data and premium evidence for an agent research task",
      budget: "0.10",
      sources: citePayMockSources
    });

    expect(result.selected.map((item) => item.source.id)).toEqual(["trusted-x402-verification-api"]);
    expect(result.totalProposedSpend).toBe("0.08");
    expect(result.skipped.find((item) => item.source.id === "premium-evidence-bundle")?.reason).toBe("budget_cap");
  });

  test("maps selected sources to existing Guard-compatible payment intents", () => {
    const source = citePayMockSources.find((item) => item.id === "trusted-x402-verification-api");
    expect(source).toBeDefined();

    const intent = mapSourceToPaymentIntent({
      agentId: "agent_citepay_demo_001",
      query: "Need verification data",
      source: source!,
      selectionRank: 1
    });

    expect(intent).toEqual({
      agentId: "agent_citepay_demo_001",
      intent: "Pay 0.08 USDC to access Verity API for Trusted Arc Testnet verification API in an AgentPay Guard flow about: Need verification data",
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "arc_settlement_preview",
      idempotencyKey: "agentpay-agent_citepay_demo_001-trusted-x402-verification-api-1"
    });
  });

  test("preserves REVIEW and BLOCK decisions from the existing Guard policy", () => {
    const reviewSource = citePayMockSources.find((item) => item.id === "premium-evidence-bundle");
    const blockedSource = citePayMockSources.find((item) => item.id === "untrusted-scrape-cache");
    expect(reviewSource).toBeDefined();
    expect(blockedSource).toBeDefined();

    const reviewIntent = mapSourceToPaymentIntent({
      agentId: "agent_citepay_demo_001",
      query: "Need telemetry attestation",
      source: reviewSource!,
      selectionRank: 1
    });
    const blockedIntent = mapSourceToPaymentIntent({
      agentId: "agent_citepay_demo_001",
      query: "Need private scrape cache",
      source: blockedSource!,
      selectionRank: 2
    });

    expect(evaluatePolicy(reviewIntent, policy, []).decision).toBe("REVIEW");
    expect(evaluatePolicy(blockedIntent, policy, []).decision).toBe("BLOCK");
  });

  test("demo preset selects paid sources with visible Guard outcomes and skipped sources", () => {
    const result = selectCitePaySources({
      agentId: citePayDemoPreset.agentId,
      query: citePayDemoPreset.query,
      budget: citePayDemoPreset.budget,
      sources: citePayMockSources
    });

    expect(citePayDemoPreset.query).toBe(
      "Research agent needs premium verification data, high-value evidence, telemetry attestation, and scraped cache context before publishing a thesis"
    );
    expect(citePayDemoPreset.budget).toBe("0.40");
    expect(result.totalProposedSpend).toBe("0.4");
    expect(result.selected.map((item) => item.source.id)).toEqual([
      "trusted-x402-verification-api",
      "premium-evidence-bundle",
      "untrusted-scrape-cache",
      "telemetry-attestation-note"
    ]);
    expect(result.skipped.find((item) => item.source.id === "market-data-note")?.reason).toBe("not_relevant");

    const evaluated = result.selected.map((item) => ({
      sourceId: item.source.id,
      decision: evaluatePolicy(item.paymentIntent, policy, []).decision,
      amount: item.source.price
    }));

    expect(evaluated.map((item) => [item.sourceId, item.decision])).toEqual([
      ["trusted-x402-verification-api", "ALLOW"],
      ["premium-evidence-bundle", "REVIEW"],
      ["untrusted-scrape-cache", "BLOCK"],
      ["telemetry-attestation-note", "REVIEW"]
    ]);
    expect(addDecimalStrings(evaluated.filter((item) => item.decision === "ALLOW").map((item) => item.amount))).toBe("0.08");
  });
});
