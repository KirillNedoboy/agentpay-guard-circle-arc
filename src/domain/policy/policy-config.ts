import { readFileSync } from "node:fs";

/**
 * One allowlisted x402 exact-payment requirement entry (I2 execution gate
 * allowlist). Values are the officially verified Circle Gateway / Arc Testnet
 * facts pinned in docs/grants/circle-grants-2026/integration-feasibility.md
 * (S13/S17/S20/S21/S24/S25): Arc Testnet USDC ERC-20 interface at 6 decimals
 * (`0x3600000000000000000000000000000000000000` — NOT the 18-decimal Arc
 * native gas USDC), Gateway EIP-712 domain `GatewayWalletBatched` v1 with the
 * Arc Testnet GatewayWallet verifying contract
 * (`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`), official
 * `maxTimeoutSeconds` 604900, `assetTransferMethod` "eip3009" and
 * `paymentFlow` "authorization".
 *
 * This section is execution-eligibility policy only: it feeds the policy
 * fingerprint and the x402 execution security gate. It NEVER changes the
 * ordinary ALLOW/REVIEW/BLOCK decision rules.
 */
export type X402ExecutionPolicyEntry = {
  /** CAIP-2 EVM network identifier, e.g. "eip155:5042002" (Arc Testnet). */
  network: string;
  /** x402 scheme; the bounded slice implements "exact" only. */
  scheme: "exact";
  /** EVM token contract address (casing preserved; compared case-insensitively). */
  asset: string;
  /** Asset symbol for evidence; the bounded slice pins "USDC". */
  assetSymbol: "USDC";
  /** Token decimals for atomic-unit conversion; Arc USDC ERC-20 interface = 6. */
  assetDecimals: 6;
  /** Upper bound on the requirement's maxTimeoutSeconds (official Gateway value 604900). */
  maxTimeoutSeconds: number;
  /** Gateway EIP-712 domain the requirement must match exactly (S17). */
  eip712: {
    /** EIP-712 domain name, e.g. "GatewayWalletBatched" (exact string). */
    name: string;
    /** EIP-712 domain version, e.g. "1" (exact string). */
    version: string;
    /** EIP-712 verifying contract (GatewayWallet; compared case-insensitively). */
    verifyingContract: string;
  };
  /** Effective assetTransferMethod; the approved path is "eip3009". */
  assetTransferMethod: "eip3009";
  /** Effective paymentFlow; the approved path is "authorization". */
  paymentFlow: "authorization";
};

export type PolicyConfig = {
  policyId: string;
  policyVersion: string;
  currency: {
    supported: string[];
  };
  authorization: {
    ttlSeconds: number;
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
  paymaster: {
    maxTotalUsdcSpend: string;
  };
  allowances: {
    reviewThreshold: string;
  };
  spenders: {
    allowed: string[];
    denied: string[];
  };
  /**
   * x402 execution eligibility allowlist (I2). Explicit network allowlist:
   * only requirements matching an entry may become eligible for a future
   * external signer request. Arc Testnet only for this bounded slice — no
   * mainnet or other testnets are allowlisted. No operator-controlled real
   * payTo address is stored here; payTo lives in the trusted adapter
   * configuration (X402RecipientBinding), never in global policy.
   */
  x402Execution: {
    allowedRequirements: X402ExecutionPolicyEntry[];
  };
};

export function loadPolicyConfig(path: string): PolicyConfig {
  return JSON.parse(readFileSync(path, "utf8")) as PolicyConfig;
}
