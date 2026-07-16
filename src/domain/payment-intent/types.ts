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

export type TransferMode = "single-chain" | "cctp" | "gateway";

export type CctpFinalityMode = "standard" | "fast-transfer";

export type CctpAttestationStatus = "not_requested" | "pending" | "verified";

export type WalletControlModel = "user-controlled" | "developer-controlled";

export type PaymentOperation = "transfer" | "approve" | "transferFrom";

export type GasPaymentMode = "native-gas" | "usdc-paymaster-preview";

export type RouteContext = {
  transferMode: TransferMode;
  sourceChain: string;
  destinationChain: string;
  finalityMode?: CctpFinalityMode;
  attestationStatus?: CctpAttestationStatus;
  walletControlModel?: WalletControlModel;
  estimatedFee?: string;
  feeAsset?: "USDC";
  gasPaymentMode?: GasPaymentMode;
};

export type CctpRoutePreview = {
  mode: "cctp_route_preview";
  sourceChain: string;
  destinationChain: string;
  asset: "native USDC (proposed)";
  finalityMode: CctpFinalityMode | "not specified";
  attestation: string;
  walletControlModel?: WalletControlModel;
  proposedAmountUSDC: string;
  estimatedFeeUSDC?: string;
  totalProposedSpendUSDC?: string;
};

export type Erc20AuthorityPreview = {
  mode: "erc20_authority_preview";
  operation?: PaymentOperation;
  spender?: string;
  derivedAmountBaseUnits?: string;
  derivedAmountBaseUnitsDisplay?: string;
  suppliedAmountBaseUnits?: string;
  explanation: string;
};

export type UsdcPaymasterPreview = {
  mode: "usdc_paymaster_preview";
  gasPaymentMode: "usdc-paymaster-preview";
  proposedAmountUSDC: string;
  estimatedFeeUSDC?: string;
  totalProposedSpendUSDC?: string;
  walletControlModel?: WalletControlModel;
  explanation: string;
};

export type ProgrammablePaymentContext = {
  operation?: PaymentOperation;
  spender?: string;
  amountBaseUnits?: string;
  transferMode?: TransferMode;
  sourceChain?: string;
  destinationChain?: string;
  finalityMode?: CctpFinalityMode;
  attestationStatus?: CctpAttestationStatus;
  walletControlModel?: WalletControlModel;
  estimatedFee?: string;
  feeAsset?: "USDC";
  gasPaymentMode?: GasPaymentMode;
  totalProposedSpendUSDC?: string;
};

export type CircleRailPreview = {
  rail: CircleRail;
  networkLabel: string;
  settlementAsset: "USDC";
  executionMode: "mock_preview" | "sandbox_ready" | "live_disabled";
  recipientId: string;
  amountUSDC: string;
  explanation: string;
  cctpRoutePreview?: CctpRoutePreview;
  erc20AuthorityPreview?: Erc20AuthorityPreview;
  usdcPaymasterPreview?: UsdcPaymasterPreview;
};

export type PaymentIntent = {
  agentId: string;
  intent: string;
  amount: string;
  currency: string;
  recipient: string;
  scenario: string;
  paymentRail: string;
  idempotencyKey: string;
  operation?: PaymentOperation;
  spender?: string;
  amountBaseUnits?: string;
  routeContext?: RouteContext;
};

export type PolicyDecision = {
  decision: Decision;
  riskScore: number;
  reason: string;
  matchedRules: string[];
  reasonCodes: string[];
  policyId: string;
};
