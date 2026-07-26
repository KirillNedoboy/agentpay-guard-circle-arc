# CitePay local demo script

## Status

Current additive local flow. Use this as the CitePay-specific companion to `docs/demo-script.md`.

## Run

```bash
pnpm dev
```

Open the local URL, normally `http://localhost:3000`, and click **Run CitePay demo**.

## Click path

1. Review the CitePay request, budget, and proposed payment intent fields.
2. Run the full source-selection flow.
3. Inspect selected and skipped sources, proposed spend, and each Guard decision.
4. Select a decision to view its AgentPay Receipt and audit-backed evidence.
5. Use **Generic ALLOW**, **CitePay REVIEW**, and **Hard BLOCK** for a compact three-case proof.
6. Expand the validator for CCTP and ERC-20 proposal previews.

## Narration

> CitePay is the user story, not a marketplace. The agent asks for paid evidence, local selection maps each source to a proposed USDC payment intent, and AgentPay Guard decides whether it is allowed, reviewed, or blocked before settlement.

Point to the receipt and audit evidence:

> The decision, reason codes, matched rules, audit ID, and `fundsMoved: false` are preserved as proposal-only evidence. No wallet or payment rail is called.

Close with:

> No funds moved. AgentPay Guard is the deterministic policy and evidence layer before settlement.

## Not implemented

- live payments or creator payouts;
- wallet custody, signing, permits, or UserOperations;
- live Circle Gateway, Arc, x402, CCTP, Iris, RPC, bundler, or EntryPoint calls;
- accounts, marketplace behavior, database, or policy editing UI.
