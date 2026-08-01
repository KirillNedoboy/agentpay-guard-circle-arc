# Project State

## Product

AgentPay Guard is a deterministic policy-and-evidence control plane before AI-agent USDC payments. It evaluates an intent, returns `ALLOW`, `REVIEW`, or `BLOCK`, and creates an append-only receipt before any future x402, Circle Gateway, or Arc settlement adapter can run.

## Current phase

`HACKATHON_READY_POLICY_ENVELOPE`

## Done

- Next.js / React / TypeScript / Vitest app and local APIs.
- Deterministic policy engine with decimal-string money handling.
- Append-only JSONL audit log with idempotency by `idempotencyKey`.
- Typed `spendControls` evidence derived from policy and recent audit receipts: request limit, review threshold, daily consumed / remaining / projected spend, and velocity window.
- One-click trusted `0.08 USDC` x402-style API micropayment judge preset.
- Judge-facing UI shows the decision, matched rules, receipt trace, policy envelope, and explicit preview-only adapter handoff.
- CitePay source-selection flow remains available as a collapsed secondary illustration.
- Arc Testnet simulation remains local and non-broadcast; health endpoint and `pnpm smoke` remain available.

## Boundary

The MVP does not move funds, sign transactions, connect wallets, store private keys, call live Circle Gateway APIs, call live Arc services, run live x402 buyer/seller flows, create transaction hashes, add DB/auth/smart contracts, or perform AML/KYC or fraud prevention.

## Final-submission note

The repository, live demo, public deck, and video assets are preserved. The current deck and video should be refreshed separately before final submission if they describe older CitePay-led functionality; this implementation does not modify or republish media.

## Next safe step

Inspect the focused diff and run the full validation set before committing:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm smoke
```
