# STATE.md - Project State

## Product

AgentPay Guard - preflight policy and audit layer for AI-agent payments.

New Lepton/CitePay direction: CitePay Agent builds on AgentPay Guard as an AI paid-citation product where an agent selects paid creator/source content, turns each selection into a payment intent, and evaluates it through the existing Guard API before any payment rail is used.

## Current phase

`LEPTON_FINAL_SUBMISSION_ASSETS_READY`

## Done

- Product definition selected.
- MVP requirements drafted.
- Codex instructions prepared.
- Demo scenarios defined.
- Default policy config drafted.
- Audit log schema defined.
- Grant/post draft skeleton prepared.
- TypeScript / Next.js local app scaffold added.
- Deterministic policy engine implemented.
- JSONL audit log append/read with idempotency implemented.
- API routes implemented.
- Single-page demo UI implemented.
- Tests added for policy decisions, invalid amount, unsupported currency, idempotency, and JSONL validity.
- MVP vertical slice independently verified.
- Proof-pack README prepared.
- Grant draft prepared.
- Two-minute demo script prepared.
- Proof-pack checklist added.
- Screenshot capture instructions added.
- Launch post prepared.
- Repository hygiene verified.
- Required screenshots captured.
- Lepton/CitePay direction documented in `docs/lepton-citepay-brief.md`.
- CitePay MVP scope documented in `docs/citepay-mvp-scope.md`.
- Mock CitePay creator/source cards implemented in code.
- Deterministic agent-side paid source selection implemented.
- CitePay source selections map to existing Guard-compatible payment intents.
- CitePay UI evaluates selected source intents through the existing Guard API.
- Tests added for source relevance, budget caps, payment-intent mapping, and Guard REVIEW/BLOCK propagation.
- Deterministic Lepton/CitePay demo preset added to the local UI.
- CitePay local demo script added at `docs/citepay-demo-script.md`.
- CitePay preset screenshots captured under `screenshots/`.
- Public README updated for the Lepton/CitePay branch narrative.
- Project tracker docs aligned with the CitePay public narrative.
- Proof-pack consistency review completed for the Lepton/CitePay branch docs.
- Lepton hackathon submission draft added.
- Lepton hackathon form-answer asset added.
- Lepton hackathon demo-video script asset added.

## Not done

- GitHub repo publication.

## Current product boundary

The MVP evaluates payment intent before payment execution.

It must not move real funds.

The CitePay direction must not remove or weaken the existing AgentPay Guard MVP boundary. CitePay may prepare payment intents for evaluation, but it must not execute real payments.

## Target demo

A local web demo where the user can run the deterministic CitePay preset and inspect:

1. mock paid source selection from the preset query;
2. Guard decisions across `ALLOW`, `REVIEW`, and `BLOCK`;
3. proposed spend `0.24 USDC` versus allowed spend `0.08 USDC`;
4. recent audit records produced through the existing Guard path.

Each result must create an audit log record.

## Next safe implementation phase

Review the final form answers and demo video script, then paste the placeholders into the actual hackathon submission.

This phase should remain local and deterministic. It should not add live payment execution, wallet signing, custody, private key handling, DB/auth, or smart contracts.

## Deadline target

Builder proof should be ready by 2026-05-31.

## Risks

| Risk | Mitigation |
|---|---|
| Scope creep into live payments | Keep live Circle/x402 integration as roadmap unless explicitly requested. |
| Fake compliance claims | Use "policy/audit layer", not AML/KYC/fraud guarantee. |
| Weak demo | Ensure 3 scenarios are visible and audit log is generated. |
| Missing visual proof | Capture actual screenshots before publishing; do not use placeholders. |
| Codex context drift | Keep `AGENTS.md`, `STATE.md`, `SESSION_NOTES.md` updated. |
| CitePay scope creep | Keep CitePay as source selection plus Guard evaluation until live payments are explicitly requested. |
| Ecosystem overclaiming | Do not claim official Circle, Arc, x402, Lepton, grant, user, revenue, or traction status. |
