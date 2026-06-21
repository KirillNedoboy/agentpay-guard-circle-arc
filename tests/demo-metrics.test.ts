import { describe, expect, test } from "vitest";
import { buildDemoSummary } from "@/app/demo-metrics";

describe("buildDemoSummary", () => {
  test("returns zeroed summary before any selection or evaluations", () => {
    expect(buildDemoSummary(null, [])).toEqual({
      proposedSpend: "0",
      allowedSpend: "0",
      reviewCount: 0,
      blockedCount: 0,
      approvedCount: 0,
      selectedCount: 0
    });
  });

  test("aggregates spend and decision counts from selected sources", () => {
    expect(
      buildDemoSummary(
        {
          selected: [{ source: { id: "s1", price: "0.25" } }, { source: { id: "s2", price: "0.80" } }, { source: { id: "s3", price: "0.35" } }],
          skipped: [],
          totalProposedSpend: "1.40"
        } as never,
        [
          { source: { id: "s1", price: "0.25" }, result: { decision: "ALLOW" } },
          { source: { id: "s2", price: "0.80" }, result: { decision: "REVIEW" } },
          { source: { id: "s3", price: "0.35" }, result: { decision: "BLOCK" } }
        ] as never
      )
    ).toEqual({
      proposedSpend: "1.40",
      allowedSpend: "0.25",
      reviewCount: 1,
      blockedCount: 1,
      approvedCount: 1,
      selectedCount: 3
    });
  });
});
