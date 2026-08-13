import { describe, expect, test } from "vitest";
import { fingerprintIntent } from "@/domain/payment-intent/intent-fingerprint";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";
import type { PaymentIntent } from "@/domain/payment-intent/types";

function makeIntent(overrides: Record<string, unknown> = {}): PaymentIntent {
  return validatePaymentIntent({
    agentId: "agent_fp_001",
    intent: "Buy premium verification data for a research task",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "intent-fp-key-001",
    ...overrides
  });
}

describe("intent fingerprint", () => {
  test("same validated intent produces the same fingerprint", () => {
    expect(fingerprintIntent(makeIntent())).toBe(fingerprintIntent(makeIntent()));
  });

  test("object-key insertion order does not matter", () => {
    const intent = makeIntent();
    const reordered = validatePaymentIntent({
      idempotencyKey: "intent-fp-key-001",
      paymentRail: "mock_x402_service",
      scenario: "api_access",
      recipient: "trusted-x402-api.demo",
      currency: "USDC",
      amount: "0.08",
      intent: "Buy premium verification data for a research task",
      agentId: "agent_fp_001"
    });

    expect(fingerprintIntent(intent)).toBe(fingerprintIntent(reordered));
  });

  test("changing the recipient changes the fingerprint", () => {
    expect(fingerprintIntent(makeIntent())).not.toBe(fingerprintIntent(makeIntent({ recipient: "market-data-api.demo" })));
  });

  test("changing the amount changes the fingerprint", () => {
    expect(fingerprintIntent(makeIntent())).not.toBe(fingerprintIntent(makeIntent({ amount: "0.09" })));
  });

  test("changing the agentId changes the fingerprint", () => {
    expect(fingerprintIntent(makeIntent())).not.toBe(fingerprintIntent(makeIntent({ agentId: "agent_fp_002" })));
  });

  test("changing a routeContext field changes the fingerprint", () => {
    const withRoute = makeIntent({
      routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "base" }
    });
    const changedRoute = makeIntent({
      routeContext: { transferMode: "cctp", sourceChain: "ethereum", destinationChain: "arbitrum" }
    });

    expect(fingerprintIntent(withRoute)).not.toBe(fingerprintIntent(changedRoute));
  });

  test("produces the sha256 format", () => {
    expect(fingerprintIntent(makeIntent())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("optional fields participate only when present", () => {
    const base = fingerprintIntent(makeIntent());
    const withOperation = fingerprintIntent(makeIntent({ operation: "approve", spender: "trusted-agent-service" }));

    expect(base).not.toBe(withOperation);
    expect(fingerprintIntent(makeIntent({ operation: "approve", spender: "trusted-agent-service" }))).toBe(withOperation);
  });

  test("derived policy fields are not part of the fingerprint", () => {
    const intent = makeIntent();
    const fingerprint = fingerprintIntent(intent);
    const extended = { ...intent, riskScore: 90, decision: "BLOCK", auditId: "audit_x" } as unknown as PaymentIntent;

    expect(fingerprintIntent(extended)).toBe(fingerprint);
  });
});
