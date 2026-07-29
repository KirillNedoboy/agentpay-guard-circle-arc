export type Decision = "ALLOW" | "REVIEW" | "BLOCK";

export type CircleRail =
  | "mock_agent_wallet"
  | "mock_gateway_nanopayment"
  | "mock_x402_service"
  | "arc_settlement_preview";

export type PaymentPurpose =
  | "premium_research_source"
  | "api_data_purchase"
  | "agent_to_agent_service"
  | "verification_or_attestation"
  | "unknown";

export type CircleRailPreview = {
  rail: CircleRail;
  networkLabel: string;
  settlementAsset: "USDC";
  executionMode: "mock_preview" | "sandbox_ready" | "live_disabled";
  recipientId: string;
  amountUSDC: string;
  explanation: string;
};

export type { ArcTestnetSimulation } from "./arc-testnet-simulation";

export type PaymentIntent = {
  agentId: string;
  intent: string;
  amount: string;
  currency: string;
  recipient: string;
  scenario: string;
  paymentRail: string;
  idempotencyKey: string;
};

export type PolicyDecision = {
  decision: Decision;
  riskScore: number;
  reason: string;
  matchedRules: string[];
  reasonCodes: string[];
  policyId: string;
};
