# AgentPay Guard / CitePay Hybrid Demo Redesign

Legacy design note retained for history; current standalone repo is agentpay-guard-circle-arc.

Date: 2026-06-21
Project: `/root/projects/agentpay-guard-circle-arc`
Status: Proposed design, approved in chat, not yet implemented

## 1. Goal

Redesign the current single-page demo so it simultaneously works as:

1. a product-looking first impression for hackathon reviewers;
2. a clear live demo for screen recording from a phone;
3. a trust/control interface that makes policy evaluation and audit evidence legible.

The redesign must keep the current MVP boundary intact:
- no real payment execution;
- no wallet signing;
- no custody;
- no live Circle/x402/Arc transaction integration.

## 2. Problem with the current UI

The current page is functional but visually reads as a stack of internal-tool panels:
- top: policy scenario validator;
- middle: CitePay source-selection flow;
- bottom: audit log.

This weakens the story because the page does not immediately answer:
- what the product is;
- what the user should watch in the demo;
- why the result is trustworthy.

The first-screen hierarchy is too form-heavy and not strong enough for recording or judging.

## 3. Design objective

The redesigned page must answer three questions in the first 5–8 seconds:

1. **What is this?**
   - An agent payment safety layer.
2. **What happens in this demo?**
   - An AI agent selects paid sources and Guard evaluates each proposed spend.
3. **Why should I trust it?**
   - The page shows allow/review/block decisions plus matched rules and audit evidence.

## 4. Primary product narrative

The primary narrative becomes:

`Agent request -> paid source candidates -> Guard decisions -> audit evidence`

The old three fixed policy scenarios remain in the product, but move to a secondary role as a validator/test mode rather than the main above-the-fold story.

## 5. Target audience behavior

### Hackathon reviewer
Needs to understand value and novelty in under 1 minute.

### Demo viewer on phone
Needs a large, visually guided flow with obvious interaction points.

### Technical reviewer
Needs visible proof that the system is deterministic, policy-driven, and audit-backed.

## 6. Information architecture

## A. Hero section

Purpose:
- immediately frame the product;
- make the page worth recording;
- show the value before the form details.

Content:
- eyebrow label, e.g. `AI PAYMENT SAFETY LAYER`;
- strong headline: `AgentPay Guard`;
- one-line supporting statement explaining the preflight policy/audit role;
- a short boundary statement: no payment execution, no wallet signing, no private keys.

Add a **live summary strip** in or directly under the hero with four compact metrics:
- proposed spend;
- allowed spend;
- review count;
- blocked count.

These metrics should update from the CitePay flow and become the first “proof of action” users see.

## B. Main demo narrative

Purpose:
- make the CitePay flow the centerpiece;
- turn the current experience from a generic form into a guided demo.

Desktop layout recommendation:
- 3 columns or 3 visually separated stages:
  1. Agent request
  2. Selected paid sources
  3. Guard decisions / result state

Mobile layout recommendation:
- same order, stacked vertically as a guided story.

### Stage 1 — Agent request
Contains:
- preset identity;
- user question;
- budget cap;
- primary CTA.

Behavior:
- `Load preset` stays visible but becomes a smaller secondary action;
- the main CTA must clearly read as the live demo trigger.

### Stage 2 — Selected paid sources
Contains:
- chosen sources with title, creator, short reason/relevance, amount;
- skipped sources in a visually lower-priority region.

Behavior:
- selected sources should feel like purchase candidates, not static catalog cards;
- highlight only what the viewer needs to understand the spend decision.

### Stage 3 — Guard decisions
Contains:
- allow/review/block state per selected source;
- risk framing;
- audit IDs;
- matched policy rules.

Behavior:
- the decision state should be visually strongest here;
- the result should read like a control checkpoint, not just output text.

## C. Trust / evidence section

Purpose:
- prove the system is not hand-wavy;
- show that decisions are deterministic and logged.

Content:
- matched rules block;
- audit IDs / machine-readable identifiers;
- recent audit log table;
- optional compact explanation of what the audit log proves.

This section should sit below the main demo narrative, not compete with it above the fold.

## D. Secondary validator mode

Purpose:
- preserve the original Guard proof and deterministic policy examples.

Content:
- the three predefined scenarios:
  - ALLOW
  - REVIEW
  - BLOCK
- editable payment-intent fields;
- evaluate button;
- decision display.

Positioning:
- move this below the main product demo or collapse it as `Policy test cases` / `Validator mode`.
- It must no longer be the first thing a viewer sees.

## 7. Visual direction

Borrow the **design grammar** from modern AI/developer-infra references such as Lazyweb patterns without cloning their exact branding.

### Core visual principles
- off-white or white background;
- near-black text;
- one disciplined accent color for product emphasis/CTA;
- status colors reserved for allow/review/block only;
- border-led separation instead of shadow-led separation;
- sharper corners and cleaner grid geometry;
- stronger typography hierarchy;
- monospace treatment for machine-readable data.

### Explicit style choices
- reduce soft rounded “default SaaS” feel;
- minimize decorative gradients and visual noise;
- avoid multiple accent colors competing at once;
- avoid making every card equally loud.

## 8. Typography system

### Headlines
- stronger, more product-like;
- geometric sans or equivalent clean modern sans.

### Body copy
- compact and highly legible.

### Labels and machine data
Use monospace or mono-accent styling for:
- audit IDs;
- policy rules;
- payment rail labels;
- flow labels;
- system metadata.

### Hierarchy goals
The viewer should instantly distinguish:
- product statement;
- live demo inputs;
- decisions;
- evidence.

## 9. Color system

Recommended structure:
- background: white / off-white;
- text: near-black;
- muted copy: neutral gray;
- accent: one brand-like highlight color;
- allow/review/block: dedicated status colors only.

Rules:
- do not use the accent color for everything;
- do not style neutral product areas like status chips;
- keep the decision colors semantically stable across the page.

## 10. Component-level redesign guidance

### Hero card / boundary notice
Current boundary note remains useful but should feel more intentional.

Change:
- convert it from a floating aside into a crisp trust/boundary card;
- keep the “no payment execution / no wallet signing / no private keys” language.

### Architecture strip
Current architecture strip is conceptually correct.

Change:
- make it more product-grade and pipeline-like;
- reduce its visual bulk while keeping it legible.

### Source cards
Current source cards are informative but too similar in importance.

Change:
- selected-source cards should become more structured and outcome-aware;
- catalog cards should be lower priority than selected candidates.

### Decision surfaces
Current decision block is too detached from the CitePay flow.

Change:
- decisions should appear closer to the selected sources they govern;
- per-source status should be fast to scan.

### Audit log
Current table is useful but visually plain.

Change:
- keep table structure;
- improve spacing, hierarchy, and machine-readable styling;
- emphasize that this is proof, not just history.

## 11. Interaction model

### Primary CTA path
The most important path should be:
1. land on page;
2. understand the story from the hero;
3. load or confirm preset;
4. run the demo;
5. inspect decisions and audit evidence.

### Secondary CTA path
Advanced users can open/use validator mode for the fixed ALLOW/REVIEW/BLOCK scenarios.

### Video-recording friendliness
The page should support a 45–90 second phone recording with minimal scrolling and minimal explanation.

This means:
- the key narrative must sit high on the page;
- actions must be obvious;
- results must appear in a visually satisfying, easy-to-point-at way.

## 12. Responsive behavior

### Desktop
- hero + summary above fold;
- main narrative grouped tightly;
- evidence below;
- secondary validator later.

### Mobile
- preserve the narrative order;
- prioritize summary, CTA, and decisions;
- reduce dense side-by-side grids;
- keep tap targets obvious.

This matters because the user intends to record the demo from a phone.

## 13. Content strategy

The copy must become more concise and more product-facing.

### Should feel like
- “This is a real product concept”;
- “This is a controlled agent payment workflow”;
- “This is trustworthy because the logic and audit are visible.”

### Should avoid feeling like
- internal QA screen;
- generic form demo;
- compliance jargon wall;
- unfinished prototype language.

## 14. Error handling and empty states

### Empty state before running demo
Must still tell the story clearly:
- no selected sources yet;
- no decisions yet;
- summary values default to zero but still present.

### Submission/loading states
Must look intentional:
- CTA shows clear progress state;
- sections do not jump or collapse unexpectedly.

### Audit table empty state
Keep explicit message so the page still looks controlled, not broken.

## 15. Testing / verification expectations after implementation

The redesign is complete only if all of the following are true:

1. The existing product behavior still works:
   - CitePay preset flow;
   - Guard decisions;
   - audit refresh;
   - validator scenarios.
2. The page remains responsive on mobile widths.
3. The first screen better communicates product + demo + trust.
4. New screenshots are captured for:
   - hero / first screen;
   - main CitePay flow with decisions;
   - trust/evidence layer.
5. A fresh browser verification confirms the new hierarchy is visible on the live deployed app.

## 16. Out of scope for this redesign

- changing the policy engine logic;
- adding real payments;
- adding authentication;
- adding a database;
- changing MVP product boundaries;
- adding external design dependencies purely for trend-chasing.

## 17. Recommended implementation order

1. Rework page structure and section order.
2. Introduce the new hero and live summary strip.
3. Rebuild the CitePay block as the primary story.
4. Move validator mode to secondary placement.
5. Tighten typography, spacing, borders, and color hierarchy.
6. Verify mobile recording friendliness.
7. Re-capture screenshots and re-check the live demo.

## 18. Decision

Recommended direction:
**Hero + main demo narrative + trust evidence + secondary validator mode**

This is the best fit for the stated hybrid goal:
- product feel;
- demo clarity;
- operator trust evidence.
