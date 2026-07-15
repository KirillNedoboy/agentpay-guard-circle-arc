import { describe, expect, expectTypeOf, test, vi } from "vitest";
import type { PaymentIntent, RouteContext } from "@/domain/payment-intent/types";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";

const auditLog = vi.hoisted(() => ({
  createOrReuseAuditRecord: vi.fn(),
  readRecentAuditRecords: vi.fn(() => [])
}));

vi.mock("@/domain/audit/audit-log", () => auditLog);

const legacyIntent: PaymentIntent = {
  agentId: "agent_market_data_001",
  intent: "Pay 0.005 USDC for market data API access",
  amount: "0.005",
  currency: "USDC",
  recipient: "market-data-api.demo",
  scenario: "api_access",
  paymentRail: "x402_gateway_nanopayment",
  idempotencyKey: "legacy-intent-without-programmable-context"
};

const cctpRouteContext: RouteContext = {
  transferMode: "cctp",
  sourceChain: "ethereum",
  destinationChain: "base"
};

describe("payment intent programmable-money context types", () => {
  test("keeps legacy payment intents valid without optional context", () => {
    expectTypeOf(legacyIntent).toMatchTypeOf<PaymentIntent>();
    expectTypeOf(cctpRouteContext).toMatchTypeOf<RouteContext>();
    expect(validatePaymentIntent(legacyIntent)).toEqual(legacyIntent);
  });
});

function createIntent(overrides: Record<string, unknown> = {}) {
  return {
    ...legacyIntent,
    idempotencyKey: "programmable-context-validation",
    ...overrides
  };
}

describe("payment intent programmable-money context validation", () => {
  test("accepts and preserves a valid CCTP context", () => {
    const input = createIntent({
      operation: "transfer",
      spender: "trusted-spender.demo",
      amountBaseUnits: "25000000",
      routeContext: {
        transferMode: "cctp",
        sourceChain: "ethereum",
        destinationChain: "base",
        finalityMode: "standard",
        attestationStatus: "not_requested",
        walletControlModel: "user-controlled",
        estimatedFee: "0.01",
        feeAsset: "USDC",
        gasPaymentMode: "native-gas"
      }
    });

    expect(validatePaymentIntent(input)).toMatchObject(input);
  });

  test.each(["sourceChain", "destinationChain"])("rejects an empty %s", (field) => {
    expect(() =>
      validatePaymentIntent(
        createIntent({
          routeContext: {
            transferMode: "cctp",
            sourceChain: "ethereum",
            destinationChain: "base",
            [field]: " "
          }
        })
      )
    ).toThrow(`${field} must be a non-empty string.`);
  });

  test.each([
    ["operation", "swap"],
    ["transferMode", "bridge"],
    ["finalityMode", "instant"],
    ["attestationStatus", "confirmed"],
    ["walletControlModel", "shared"],
    ["gasPaymentMode", "sponsored"]
  ])("rejects invalid %s enum value", (field, value) => {
    const routeContext = {
      transferMode: "cctp",
      sourceChain: "ethereum",
      destinationChain: "base"
    } as Record<string, unknown>;
    const input = createIntent(field === "operation" ? { operation: value } : { routeContext: { ...routeContext, [field]: value } });

    expect(() => validatePaymentIntent(input)).toThrow(`${field} has an unsupported value.`);
  });

  test.each(["-0.01", "0.0.1", "1e-3"])("rejects invalid estimated fee %s", (estimatedFee) => {
    expect(() =>
      validatePaymentIntent(
        createIntent({
          routeContext: {
            transferMode: "cctp",
            sourceChain: "ethereum",
            destinationChain: "base",
            estimatedFee
          }
        })
      )
    ).toThrow("estimatedFee must be a non-negative decimal string.");
  });

  test("rejects a non-USDC fee asset", () => {
    expect(() =>
      validatePaymentIntent(
        createIntent({
          routeContext: {
            transferMode: "cctp",
            sourceChain: "ethereum",
            destinationChain: "base",
            feeAsset: "ETH"
          }
        })
      )
    ).toThrow("feeAsset must be USDC.");
  });

  test("rejects an empty spender when supplied", () => {
    expect(() => validatePaymentIntent(createIntent({ spender: " " }))).toThrow("spender must be a non-empty string.");
  });

  test.each(["-1", "1.5", "01", "1e6"])("rejects invalid amount base units %s", (amountBaseUnits) => {
    expect(() => validatePaymentIntent(createIntent({ amountBaseUnits }))).toThrow(
      "amountBaseUnits must be a non-negative integer string."
    );
  });

  test("rejects unknown nested route context fields", () => {
    expect(() =>
      validatePaymentIntent(
        createIntent({
          routeContext: {
            transferMode: "cctp",
            sourceChain: "ethereum",
            destinationChain: "base",
            providerId: "forbidden"
          }
        })
      )
    ).toThrow("routeContext contains an unsupported field: providerId.");
  });

  test("rejects a route context that is not a plain object", () => {
    expect(() => validatePaymentIntent(createIntent({ routeContext: [] }))).toThrow("routeContext must be a plain object.");
  });

  test("fails closed through the API without creating an audit record", async () => {
    const { safeEvaluatePaymentIntent } = await import("@/domain/payment-intent/evaluate");
    const response = await safeEvaluatePaymentIntent(
      createIntent({
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          providerId: "forbidden"
        }
      })
    );
    const body = (await response.json()) as { decision: string; auditId: string | null; matchedRules: string[] };

    expect(response.status).toBe(400);
    expect(body.decision).toBe("BLOCK");
    expect(body.decision).not.toBe("ALLOW");
    expect(body.matchedRules).toEqual(["request_validation_failed"]);
    expect(body.auditId).toBeNull();
    expect(auditLog.createOrReuseAuditRecord).not.toHaveBeenCalled();
  });
});
