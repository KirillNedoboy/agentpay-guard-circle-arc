# AgentPay Guard Hybrid Demo Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved hybrid redesign so the first screen communicates product value, the CitePay flow becomes the primary live demo, trust evidence is clearer, and validator mode moves to a secondary role.

**Architecture:** Keep business logic and API behavior unchanged. Recompose the single-page client UI around a new hero, live summary strip, narrative-first CitePay flow, evidence section, and lower-priority validator section. Add a small pure helper module for summary/status derivation so the most important new UI state is covered by tests first.

**Tech Stack:** Next.js App Router, React 19 client component, TypeScript, Vitest, CSS in `src/app/globals.css`

---

## File map

- Modify: `src/app/demo-client.tsx` — restructure section order, add hero/summary/evidence/secondary validator UI
- Create: `src/app/demo-metrics.ts` — pure helpers for live summary counters and decision-driven presentation metadata
- Create: `tests/demo-metrics.test.ts` — regression coverage for summary math and counts
- Modify: `src/app/globals.css` — rewrite layout, hierarchy, status styling, responsive behavior for phone recording
- Optional modify: `src/app/layout.tsx` — only if metadata text needs alignment after implementation

### Task 1: Add test-covered demo summary helpers

**Files:**
- Create: `tests/demo-metrics.test.ts`
- Create: `src/app/demo-metrics.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
        { selected: [{ source: { id: "s1" } }, { source: { id: "s2" } }, { source: { id: "s3" } }], skipped: [], totalProposedSpend: "1.40" } as any,
        [
          { source: { id: "s1" }, result: { decision: "ALLOW" } },
          { source: { id: "s2" }, result: { decision: "REVIEW" } },
          { source: { id: "s3" }, result: { decision: "BLOCK" } }
        ] as any
      )
    ).toEqual({
      proposedSpend: "1.40",
      allowedSpend: "0",
      reviewCount: 1,
      blockedCount: 1,
      approvedCount: 1,
      selectedCount: 3
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/demo-metrics.test.ts`
Expected: FAIL because `@/app/demo-metrics` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/demo-metrics.ts` with a pure `buildDemoSummary()` helper that:
- takes the current CitePay selection and evaluation list;
- returns `proposedSpend`, `allowedSpend`, `reviewCount`, `blockedCount`, `approvedCount`, `selectedCount`;
- sums only `ALLOW` prices into `allowedSpend` using `addDecimalStrings`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/demo-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/demo-metrics.test.ts src/app/demo-metrics.ts
git commit -m "test: cover demo summary helpers"
```

### Task 2: Rebuild page hierarchy around the approved narrative

**Files:**
- Modify: `src/app/demo-client.tsx`

- [ ] **Step 1: Refactor JSX structure**

Reorder the page into:
1. hero
2. architecture strip
3. live summary strip
4. main CitePay narrative (`Agent request`, `Selected candidates`, `Guard decisions`)
5. trust/evidence section with audit log
6. secondary `Validator mode`

- [ ] **Step 2: Add hero and boundary messaging**

Render:
- eyebrow like `AI payment safety layer`
- headline `AgentPay Guard`
- concise product statement
- explicit boundary/trust card with no execution/signing/keys copy

- [ ] **Step 3: Add live summary strip**

Use `buildDemoSummary()` to render compact metrics:
- proposed spend
- allowed spend
- review count
- blocked count

- [ ] **Step 4: Recompose main demo narrative**

Keep existing CitePay logic, but present it as three stages:
- `Agent request`
- `Selected paid sources`
- `Guard decisions`

Show skipped sources in a lower-priority area.

- [ ] **Step 5: Move validator to secondary placement**

Keep existing scenario selector + editable intent form + evaluate button + decision result, but move it below trust/evidence as `Validator mode` / `Policy test cases`.

- [ ] **Step 6: Keep behavior stable**

Preserve:
- `Load preset`
- `runCitePayFlow()`
- `evaluate()`
- audit refresh
- decision rendering

### Task 3: Apply the hybrid visual system and mobile-first spacing

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Update design tokens**

Shift to:
- brighter off-white background
- near-black text
- single disciplined accent
- border-led panels
- status colors reserved for `ALLOW / REVIEW / BLOCK`

- [ ] **Step 2: Style new hierarchy**

Add CSS for:
- hero grid
- summary strip cards
- stage cards
- trust note / evidence cards
- validator collapse-like secondary framing
- mono styling for audit IDs / rules / flow labels

- [ ] **Step 3: Improve result scanning**

Ensure per-source decision cards and top-level validator decision use strong status chips / contrast without overusing color.

- [ ] **Step 4: Tune responsive behavior**

At mobile widths:
- stack narrative stages vertically in story order;
- keep CTA and summary obvious;
- avoid dense two-column forms where readability suffers.

### Task 4: Verify behavior, build, and deployed UI

**Files:**
- Modify if needed: `src/app/demo-client.tsx`, `src/app/globals.css`

- [ ] **Step 1: Run targeted tests**

Run: `pnpm test`
Expected: all tests pass including the new helper test.

- [ ] **Step 2: Run static verification**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm build
```
Expected: all three commands succeed.

- [ ] **Step 3: Restart deployed service if build artifacts changed**

Run:
```bash
systemctl restart citepay-agent.service
systemctl is-active citepay-agent.service
```
Expected: `active`.

- [ ] **Step 4: Verify live app in browser**

Open `http://138.124.108.146` and confirm:
- hero is above the fold;
- summary strip is visible;
- CitePay narrative appears before validator mode;
- audit evidence remains accessible.

- [ ] **Step 5: Capture refreshed screenshots**

Capture at least:
- first screen / hero
- main CitePay flow with decisions
- trust/evidence section

- [ ] **Step 6: Commit**

```bash
git add src/app/demo-client.tsx src/app/demo-metrics.ts src/app/globals.css tests/demo-metrics.test.ts
git commit -m "feat: implement hybrid demo redesign"
```
