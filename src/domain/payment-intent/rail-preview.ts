import { addDecimalStrings } from "@/lib/decimal";
import { toUsdcBaseUnits } from "@/lib/usdc-base-units";
import type {
  CctpAttestationStatus,
  CctpRoutePreview,
  Erc20AuthorityPreview,
  CircleRail,
  CircleRailPreview,
  PaymentIntent,
  PaymentPurpose
} from "./types";

const previewOnlyExplanation =
  "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail.";

const cctpPreviewOnlyExplanation =
  "Preview only. No funds moved, no CCTP burn or mint occurred, no Iris attestation was requested, and no Circle API was called.";

const erc20AuthorityPreviewOnlyExplanation =
  "Authority preview only. This app did not read an allowance or balance, sign an approval, or submit an ERC-20 transaction.";

const railLabels: Record<CircleRail, string> = {
  mock_agent_wallet: "Circle Agent Wallet preview",
  mock_gateway_nanopayment: "Circle Gateway Nanopayment preview",
  mock_x402_service: "x402-compatible paid API",
  arc_settlement_preview: "Arc settlement preview"
};

function normalizeRail(paymentRail: string): CircleRail {
  if (paymentRail === "mock_x402_service" || paymentRail === "x402_gateway_nanopayment") {
    return "mock_x402_service";
  }
  if (paymentRail === "mock_gateway_nanopayment" || paymentRail === "future_x402_gateway_citation_payment") {
    return "mock_gateway_nanopayment";
  }
  if (paymentRail === "arc_settlement_preview") {
    return "arc_settlement_preview";
  }
  if (paymentRail === "mock_agent_wallet") {
    return "mock_agent_wallet";
  }
  return "mock_agent_wallet";
}

function formatChainLabel(chain: string): string {
  return chain
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatAttestationStatus(status: CctpAttestationStatus | undefined): string {
  if (status === "not_requested") {
    return "not requested";
  }
  if (status === "pending") {
    return "pending";
  }
  if (status === "verified") {
    return "claimed verified (unverified by this app)";
  }
  return "not specified";
}

function buildCctpRoutePreview(intent: PaymentIntent): CctpRoutePreview | undefined {
  const routeContext = intent.routeContext;
  if (routeContext?.transferMode !== "cctp") {
    return undefined;
  }

  const cctpRoutePreview: CctpRoutePreview = {
    mode: "cctp_route_preview",
    sourceChain: formatChainLabel(routeContext.sourceChain),
    destinationChain: formatChainLabel(routeContext.destinationChain),
    asset: "native USDC (proposed)",
    finalityMode: routeContext.finalityMode ?? "not specified",
    attestation: formatAttestationStatus(routeContext.attestationStatus),
    proposedAmountUSDC: intent.amount
  };

  if (routeContext.walletControlModel) {
    cctpRoutePreview.walletControlModel = routeContext.walletControlModel;
  }
  if (routeContext.estimatedFee) {
    cctpRoutePreview.estimatedFeeUSDC = routeContext.estimatedFee;
    const totalProposedSpend = addDecimalStrings([intent.amount, routeContext.estimatedFee]);
    if (totalProposedSpend) {
      cctpRoutePreview.totalProposedSpendUSDC = totalProposedSpend;
    }
  }

  return cctpRoutePreview;
}

function buildErc20AuthorityPreview(intent: PaymentIntent): Erc20AuthorityPreview | undefined {
  if (!intent.operation && !intent.spender && !intent.amountBaseUnits) {
    return undefined;
  }

  const erc20AuthorityPreview: Erc20AuthorityPreview = {
    mode: "erc20_authority_preview",
    explanation: erc20AuthorityPreviewOnlyExplanation
  };
  const derivedAmountBaseUnits = toUsdcBaseUnits(intent.amount);

  if (intent.operation) {
    erc20AuthorityPreview.operation = intent.operation;
  }
  if (intent.spender) {
    erc20AuthorityPreview.spender = intent.spender;
  }
  if (derivedAmountBaseUnits) {
    erc20AuthorityPreview.derivedAmountBaseUnits = derivedAmountBaseUnits;
    erc20AuthorityPreview.derivedAmountBaseUnitsDisplay = `${intent.amount} USDC = ${derivedAmountBaseUnits} base units (6 decimals)`;
  }
  if (intent.amountBaseUnits) {
    erc20AuthorityPreview.suppliedAmountBaseUnits = intent.amountBaseUnits;
  }

  return erc20AuthorityPreview;
}

export function mapScenarioToPaymentPurpose(scenario: string): PaymentPurpose {
  if (scenario === "api_access") {
    return "api_data_purchase";
  }
  if (scenario === "data_access") {
    return "premium_research_source";
  }
  if (scenario === "machine_to_machine") {
    return "verification_or_attestation";
  }
  if (scenario === "compute_access") {
    return "agent_to_agent_service";
  }
  return "unknown";
}

export function buildCircleRailPreview(intent: PaymentIntent): CircleRailPreview {
  const rail = normalizeRail(intent.paymentRail);
  const isKnownPreviewRail =
    intent.paymentRail === "mock_x402_service" ||
    intent.paymentRail === "x402_gateway_nanopayment" ||
    intent.paymentRail === "mock_gateway_nanopayment" ||
    intent.paymentRail === "future_x402_gateway_citation_payment" ||
    intent.paymentRail === "arc_settlement_preview" ||
    intent.paymentRail === "mock_agent_wallet";

  const cctpRoutePreview = buildCctpRoutePreview(intent);
  const erc20AuthorityPreview = buildErc20AuthorityPreview(intent);

  return {
    rail,
    networkLabel: railLabels[rail],
    settlementAsset: "USDC",
    executionMode: isKnownPreviewRail ? "mock_preview" : "live_disabled",
    recipientId: intent.recipient,
    amountUSDC: intent.amount,
    explanation: cctpRoutePreview
      ? cctpPreviewOnlyExplanation
      : isKnownPreviewRail
        ? previewOnlyExplanation
        : "Live payment rail is disabled. This response is an adapter boundary preview, not a production integration.",
    ...(cctpRoutePreview ? { cctpRoutePreview } : {}),
    ...(erc20AuthorityPreview ? { erc20AuthorityPreview } : {})
  };
}
