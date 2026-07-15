import { readFileSync } from "node:fs";

export type PolicyConfig = {
  policyId: string;
  currency: {
    supported: string[];
  };
  limits: {
    maxAmountPerPayment: string;
    dailyLimitPerAgent: string;
    reviewThreshold: string;
  };
  velocity: {
    windowSeconds: number;
    maxAttemptsPerWindow: number;
  };
  allowedScenarios: string[];
  allowlistedRecipients: string[];
  reviewRecipients: string[];
  deniedRecipients: string[];
  suspiciousKeywords: string[];
  riskWeights: {
    unknownRecipient: number;
    unknownScenario: number;
    reviewRecipient: number;
    suspiciousKeyword: number;
    velocityExceeded: number;
    amountAboveHalfLimit: number;
    amountAboveReviewThreshold: number;
  };
  decisionThresholds: {
    reviewAt: number;
    blockAt: number;
  };
  crossChain: {
    allowedCctpPairs: Array<{
      sourceChain: string;
      destinationChain: string;
    }>;
    fastTransferReviewThreshold: string;
    developerControlledReviewThreshold: string;
    maxTotalUsdcSpend: string;
  };
  allowances: {
    reviewThreshold: string;
  };
  spenders: {
    allowed: string[];
    denied: string[];
  };
};

export function loadPolicyConfig(path: string): PolicyConfig {
  return JSON.parse(readFileSync(path, "utf8")) as PolicyConfig;
}
