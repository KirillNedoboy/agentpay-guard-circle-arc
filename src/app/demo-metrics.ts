import type { CitePaySelectedSource, CitePaySelectionResult } from "@/domain/citepay/types";
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
