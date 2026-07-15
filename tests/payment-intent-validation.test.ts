import { describe, expect, expectTypeOf, test } from "vitest";
import type { PaymentIntent, RouteContext } from "@/domain/payment-intent/types";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";

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
