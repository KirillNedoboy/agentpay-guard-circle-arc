import type { PaymentIntent } from "./types";

export function createX402JudgePreset(): PaymentIntent {
  return {
    agentId: "agent_ignyte_demo_001",
    intent: "Buy premium verification data from a trusted x402 API for an agent research task",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "judge-x402-api-micropayment-001"
  };
}
