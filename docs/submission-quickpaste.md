# AgentPay Guard quickpaste

## Title

AgentPay Guard

## Short summary

AgentPay Guard is a local deterministic policy and evidence layer for proposed AI-agent USDC payment intents. It validates the intent, returns `ALLOW`, `REVIEW`, or `BLOCK`, stores idempotent JSONL audit evidence, and renders a proposal-only receipt with `fundsMoved: false`. It does not execute payment.

## Full description

The project adds a control point before a future settlement adapter. It evaluates generic USDC intents and optional programmable-money context: CCTP route policy, ERC-20 authority proposal context, and a Paymaster fee-budget preview. The UI shows matched rules, reason codes, proposal route/authority/fee fields, audit evidence, and AgentPay Receipt output.

The validator demonstrates CCTP Fast Transfer `REVIEW`, standard CCTP `ALLOW`, unsupported CCTP `BLOCK`, and ERC-20 approval `REVIEW`, alongside the existing generic and CitePay flows. Amount-plus-fee totals use decimal-string arithmetic; audit records retain optional normalized proposal context and replay the same idempotency key without a duplicate line.

All protocol-facing values remain preview-only. CCTP context does not burn or mint USDC or verify Iris. ERC-20 context does not read allowance/balance data or sign an approval. Paymaster context does not create a UserOperation or permit, contact a bundler or EntryPoint, or pay gas. The app does not move funds, connect wallets, sign transactions, store keys, create transaction hashes, or report settlement/finality confirmation.

## Proof

- 10 test files, 138 passing tests.
- Real local screenshots document generic and programmable policy cases.
- Validation: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Repository

https://github.com/KirillNedoboy/agentpay-guard-circle-arc
