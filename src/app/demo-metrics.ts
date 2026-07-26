import {
  citePayDemoPreset,
  citePayMockSources,
  selectCitePaySources
} from "@/domain/citepay/source-selection";
import type { CitePaySelectedSource, CitePaySelectionResult } from "@/domain/citepay/types";
import type { AuditRecord } from "@/domain/audit/types";
import { buildCircleRailPreview, mapScenarioToPaymentPurpose } from "@/domain/payment-intent/rail-preview";
import type { CircleRailPreview, PaymentIntent, ProgrammablePaymentContext } from "@/domain/payment-intent/types";
import { addDecimalStrings } from "@/lib/decimal";

export type DemoEvaluationResult = {
  decision: "ALLOW" | "REVIEW" | "BLOCK";
};

export type DemoEvaluatedSource = {
  source: Pick<CitePaySelectedSource["source"], "id" | "price">;
  result: DemoEvaluationResult;
};

export type DemoSummary = {
  proposedSpend: string;
  allowedSpend: string;
  reviewCount: number;
  blockedCount: number;
  approvedCount: number;
  selectedCount: number;
};

export type RailPreviewRow = [label: string, value: string];
export type ProgrammableEvidenceRow = [label: string, value: string];
export type ReasonCodeRow = [label: "Reason codes", value: string];
export type CctpRouteExplanation = {
  label: "Preview only";
  steps: string[];
};
export type ProposedIntentRow = [label: string, value: string];
export type QuickCaseDefinition = {
  id: "allow" | "review" | "block";
  label: string;
  description: string;
  intent: PaymentIntent;
};
export type SettlementBoundary = {
  label: "Future / not executed in MVP";
  stages: ["Guard decision", "Future settlement adapter", "Arc / Circle Gateway / x402"];
};
export type StructuredAuditPreview = {
  intentId: string;
  recipientLabel: string;
  amountUSDC: string;
  purpose: string;
  rail: string;
  decision: string;
  matchedRules: string[];
  reasonCodes: string[];
  executionMode: string;
  railPreview: CircleRailPreview;
  programmablePaymentContext?: ProgrammablePaymentContext;
};

type ScenarioInput = {
  expectedDecision: string;
  intent: PaymentIntent;
};

export function buildQuickCaseDefinitions(scenarios: readonly ScenarioInput[]): QuickCaseDefinition[] {
  if (!scenarios.length) {
    return [];
  }

  const citePaySelection = selectCitePaySources({
    agentId: citePayDemoPreset.agentId,
    query: citePayDemoPreset.query,
    budget: citePayDemoPreset.budget,
    sources: citePayMockSources
  });
  const citePayReviewRecipient = citePaySelection.selected.find(
    (item) => item.source.id === "premium-evidence-bundle"
  )?.source.recipient;
  const allow = scenarios.find((scenario) => scenario.expectedDecision === "ALLOW" && !scenario.intent.routeContext)
    ?? scenarios.find((scenario) => scenario.expectedDecision === "ALLOW");
  const review = scenarios.find(
    (scenario) =>
      scenario.expectedDecision === "REVIEW" &&
      (!citePayReviewRecipient || scenario.intent.recipient === citePayReviewRecipient)
  ) ?? scenarios.find((scenario) => scenario.expectedDecision === "REVIEW");
  const block = scenarios.find((scenario) => scenario.expectedDecision === "BLOCK");
  const fallbackIntent = scenarios[0].intent;

  return [
    {
      id: "allow",
      label: "Generic ALLOW",
      description: "Known recipient and amount within policy.",
      intent: allow?.intent ?? fallbackIntent
    },
    {
      id: "review",
      label: "CitePay REVIEW",
      description: "Premium paid-source request held for review.",
      intent: review?.intent ?? fallbackIntent
    },
    {
      id: "block",
      label: "Hard BLOCK",
      description: "Existing denylisted recipient case.",
      intent: block?.intent ?? fallbackIntent
    }
  ];
}

export function buildProposedIntentRows(intent: PaymentIntent | null | undefined): ProposedIntentRow[] {
  if (!intent) {
    return [];
  }

  return [
    ["Agent ID", intent.agentId],
    ["Amount", `${intent.amount} ${intent.currency}`],
    ["Recipient", intent.recipient],
    ["Scenario", intent.scenario],
    ["Payment rail", intent.paymentRail],
    ...(intent.idempotencyKey ? ([["Idempotency key", intent.idempotencyKey]] as ProposedIntentRow[]) : [])
  ];
}

export function buildSettlementBoundary(): SettlementBoundary {
  return {
    label: "Future / not executed in MVP",
    stages: ["Guard decision", "Future settlement adapter", "Arc / Circle Gateway / x402"]
  };
}

export function buildDemoSummary(
  selection: CitePaySelectionResult | null,
  evaluations: DemoEvaluatedSource[]
): DemoSummary {
  const proposedSpend = selection?.totalProposedSpend ?? "0";
  const allowedAmounts = evaluations.filter((item) => item.result.decision === "ALLOW").map((item) => item.source.price);
  const reviewCount = evaluations.filter((item) => item.result.decision === "REVIEW").length;
  const blockedCount = evaluations.filter((item) => item.result.decision === "BLOCK").length;
  const approvedCount = evaluations.filter((item) => item.result.decision === "ALLOW").length;

  return {
    proposedSpend,
    allowedSpend: addDecimalStrings(allowedAmounts) ?? "0",
    reviewCount,
    blockedCount,
    approvedCount,
    selectedCount: selection?.selected.length ?? 0
  };
}

export function buildRailPreviewRows(preview: CircleRailPreview | undefined): RailPreviewRow[] {
  if (!preview) {
    return [];
  }

  return [
    ["Rail", preview.networkLabel],
    ["Asset", preview.settlementAsset],
    ["Mode", preview.executionMode],
    ["Recipient", preview.recipientId],
    ["Amount", `${preview.amountUSDC} ${preview.settlementAsset}`]
  ];
}

export function buildProgrammableEvidenceRows(
  preview: CircleRailPreview | undefined,
  context?: ProgrammablePaymentContext
): ProgrammableEvidenceRow[] {
  if (!preview && !context) {
    return [];
  }

  const cctp = preview?.cctpRoutePreview;
  const authority = preview?.erc20AuthorityPreview;
  const paymaster = preview?.usdcPaymasterPreview;
  const rows: ProgrammableEvidenceRow[] = [];
  const operation = context?.operation ?? authority?.operation;
  const spender = context?.spender ?? authority?.spender;
  const amountBaseUnits = context?.amountBaseUnits ?? authority?.suppliedAmountBaseUnits ?? authority?.derivedAmountBaseUnits;
  const transferMode = context?.transferMode ?? (cctp ? "cctp" : undefined);
  const sourceChain = cctp?.sourceChain ?? context?.sourceChain;
  const destinationChain = cctp?.destinationChain ?? context?.destinationChain;
  const finalityMode = cctp?.finalityMode ?? context?.finalityMode;
  const attestation = cctp?.attestation ?? context?.attestationStatus?.replaceAll("_", " ");
  const walletControlModel = cctp?.walletControlModel ?? paymaster?.walletControlModel ?? context?.walletControlModel;
  const proposedAmount = cctp?.proposedAmountUSDC ?? paymaster?.proposedAmountUSDC;
  const estimatedFee = cctp?.estimatedFeeUSDC ?? paymaster?.estimatedFeeUSDC ?? context?.estimatedFee;
  const totalProposedSpend = cctp?.totalProposedSpendUSDC ?? paymaster?.totalProposedSpendUSDC ?? context?.totalProposedSpendUSDC;
  const gasPaymentMode = context?.gasPaymentMode ?? paymaster?.gasPaymentMode;

  if (operation) {
    rows.push(["Operation", operation]);
  }
  if (spender) {
    rows.push(["Spender", spender]);
  }
  if (amountBaseUnits) {
    rows.push(["Amount base units", amountBaseUnits]);
  }
  if (transferMode) {
    rows.push(["Transfer mode", transferMode]);
  }
  if (sourceChain && destinationChain) {
    rows.push(["Route", `${sourceChain} → ${destinationChain}`]);
  }
  if (finalityMode && finalityMode !== "not specified") {
    rows.push(["Finality", finalityMode]);
  }
  if (attestation) {
    rows.push(["Attestation", attestation]);
  }
  if (walletControlModel) {
    rows.push(["Wallet control", walletControlModel]);
  }
  if (proposedAmount) {
    rows.push(["Proposed amount", `${proposedAmount} USDC`]);
  }
  if (estimatedFee) {
    rows.push(["Estimated fee", `${estimatedFee} USDC`]);
  }
  if (totalProposedSpend) {
    rows.push(["Total proposed spend", `${totalProposedSpend} USDC`]);
  }
  if (gasPaymentMode) {
    rows.push(["Gas payment", gasPaymentMode]);
  }

  return rows;
}

export function buildCctpRouteExplanation(preview: CircleRailPreview | undefined): CctpRouteExplanation | null {
  const cctp = preview?.cctpRoutePreview;
  if (!cctp) {
    return null;
  }

  return {
    label: "Preview only",
    steps: [
      `Proposed ${cctp.sourceChain} USDC`,
      "CCTP burn — not executed",
      "Iris attestation — not requested / not verified here",
      `Proposed ${cctp.destinationChain} USDC mint — not executed`
    ]
  };
}

export function buildReasonCodeRows(reasonCodes: string[] | undefined): ReasonCodeRow[] {
  if (!reasonCodes?.length) {
    return [];
  }

  return [["Reason codes", reasonCodes.join(", ")]];
}

export function buildAuditPreview(record: AuditRecord | undefined): StructuredAuditPreview | null {
  if (!record) {
    return null;
  }

  const railPreview =
    record.railPreview ??
    buildCircleRailPreview({
      agentId: record.agentId,
      intent: record.intent,
      amount: record.amount,
      currency: record.currency,
      recipient: record.recipient,
      scenario: record.scenario,
      paymentRail: record.paymentRail,
      idempotencyKey: record.idempotencyKey
    });

  return {
    intentId: record.intentId ?? record.idempotencyKey,
    recipientLabel: record.recipientLabel ?? record.recipient,
    amountUSDC: record.amountUSDC ?? record.amount,
    purpose: record.purpose ?? mapScenarioToPaymentPurpose(record.scenario),
    rail: record.rail ?? railPreview.rail,
    decision: record.decision,
    matchedRules: record.matchedRules ?? [],
    reasonCodes: record.reasonCodes ?? [],
    executionMode: record.executionMode ?? railPreview.executionMode,
    railPreview,
    ...(record.programmablePaymentContext ? { programmablePaymentContext: record.programmablePaymentContext } : {})
  };
}
