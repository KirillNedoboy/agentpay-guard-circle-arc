# AgentPay Guard quickpaste

## Title

AgentPay Guard

## Short summary

AgentPay Guard is a local deterministic policy and evidence layer for proposed AI-agent USDC payment intents. It validates the intent, returns `ALLOW`, `REVIEW`, or `BLOCK`, stores idempotent JSONL audit evidence, and renders a proposal-only receipt with `fundsMoved: false`. It does not execute payment.

## Full description

The project adds a control point before a future settlement adapter. The reviewer path starts with a CitePay paid-source request, turns it into a proposed USDC payment intent, and shows AgentPay Guard's `ALLOW`, `REVIEW`, or `BLOCK` decision with matched rules, reason codes, audit evidence, and AgentPay Receipt output. CitePay is an illustrative local flow, not a marketplace or live payment product.

The app also evaluates generic USDC intents and optional programmable-money context: CCTP route policy, ERC-20 authority proposal context, and a Paymaster fee-budget preview.

The validator demonstrates CCTP Fast Transfer `REVIEW`, standard CCTP `ALLOW`, unsupported CCTP `BLOCK`, and ERC-20 approval `REVIEW`, alongside the existing generic and CitePay flows. Amount-plus-fee totals use decimal-string arithmetic; audit records retain optional normalized proposal context and replay the same idempotency key without a duplicate line.

All protocol-facing values remain preview-only. CCTP context does not burn or mint USDC or verify Iris. ERC-20 context does not read allowance/balance data or sign an approval. Paymaster context does not create a UserOperation or permit, contact a bundler or EntryPoint, or pay gas. The app does not move funds, connect wallets, sign transactions, store keys, create transaction hashes, or report settlement/finality confirmation.

## Proof

- 10 test files, 142 passing tests.
- Real local screenshots document generic and programmable policy cases.
- Validation: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Live demo

https://138-124-108-146.nip.io

## Repository

https://github.com/KirillNedoboy/agentpay-guard-circle-arc
