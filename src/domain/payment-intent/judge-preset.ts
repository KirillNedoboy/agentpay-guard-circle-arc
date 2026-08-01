import type { PaymentIntent } from "./types";

export const x402JudgePreset: {
  label: string;
  description: string;
  intent: PaymentIntent;
} = {
  label: "x402 API micropayment",
  description: "A trusted USDC API request evaluated before any future settlement adapter can run.",
  intent: {
    agentId: "agent_x402_judge_001",
    intent: "Pay 0.08 USDC for a trusted x402-style verification API response",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "judge-x402-micropayment-001"
  }
};
