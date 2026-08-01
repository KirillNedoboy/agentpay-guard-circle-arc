import type { CitePaySelectedSource, CitePaySelectionResult } from "@/domain/citepay/types";
import type { AuditRecord } from "@/domain/audit/types";
import { buildCircleRailPreview, mapScenarioToPaymentPurpose } from "@/domain/payment-intent/rail-preview";
import type { ArcTestnetSimulation, CircleRailPreview } from "@/domain/payment-intent/types";
import type { SpendControls } from "@/domain/policy/spend-controls";
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
export type ReasonCodeRow = [label: "Reason codes", value: string];
export type SimulationRow = [label: string, value: string];
export type SpendControlRow = [label: string, value: string];
export type StructuredAuditPreview = {
  intentId: string;
  recipientLabel: string;
  amountUSDC: string;
  purpose: string;
  rail: string;
  decision: string;
  reasonCodes: string[];
  executionMode: string;
  railPreview: CircleRailPreview;
  spendControls?: SpendControls;
};

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

export function buildReasonCodeRows(reasonCodes: string[] | undefined): ReasonCodeRow[] {
  if (!reasonCodes?.length) {
    return [];
  }

  return [["Reason codes", reasonCodes.join(", ")]];
}

export function buildSimulationRows(simulation: ArcTestnetSimulation | undefined): SimulationRow[] {
  if (!simulation) {
    return [];
  }

  return [
    ["Status", simulation.status],
    ["Network", `${simulation.network.name} (${simulation.network.chainId})`],
    ["Asset", `${simulation.asset.symbol} (${simulation.asset.decimals} decimals)`],
    ["Amount", `${simulation.amountUSDC} ${simulation.asset.symbol}`],
    ["Broadcast", simulation.broadcast ? "broadcast" : "not broadcast"],
    ["Verification", simulation.verificationStatus]
  ];
}

export function buildSpendControlRows(controls: SpendControls | undefined): SpendControlRow[] {
  if (!controls) {
    return [];
  }

  const amount = (value: string) => `${value} ${controls.currency}`;
  return [
    ["Request", amount(controls.requestedAmount)],
    ["Per-request limit", amount(controls.maxAmountPerPayment)],
    ["Review threshold", amount(controls.reviewThreshold)],
    ["Daily spend", `${controls.dailyAllowedSpend} / ${controls.dailyLimit} ${controls.currency}`],
    ["Daily remaining", controls.dailyRemainingBeforeRequest === null ? "unavailable" : amount(controls.dailyRemainingBeforeRequest)],
    ["Projected spend", controls.projectedDailySpend === null ? "unavailable" : `${controls.projectedDailySpend} / ${controls.dailyLimit} ${controls.currency}`],
    ["Velocity", `${controls.velocityAttempts} / ${controls.velocityMaxAttempts} in ${controls.velocityWindowSeconds}s`]
  ];
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

  const preview: StructuredAuditPreview = {
    intentId: record.intentId ?? record.idempotencyKey,
    recipientLabel: record.recipientLabel ?? record.recipient,
    amountUSDC: record.amountUSDC ?? record.amount,
    purpose: record.purpose ?? mapScenarioToPaymentPurpose(record.scenario),
    rail: record.rail ?? railPreview.rail,
    decision: record.decision,
    reasonCodes: record.reasonCodes ?? [],
    executionMode: record.executionMode ?? railPreview.executionMode,
    railPreview
  };

  if (record.spendControls) {
    preview.spendControls = record.spendControls;
  }

  return preview;
}
