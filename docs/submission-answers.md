# AgentPay Guard submission answers

## Project name

AgentPay Guard

## One-liner

Deterministic policy and evidence layer for proposed AI-agent USDC payment intents before a future settlement adapter.

## Problem

An agent can form a payment request faster than an operator can assess whether the recipient, purpose, amount, route, authority, and fee context are acceptable. A payment rail alone does not retain the policy reasoning behind that decision.

## Solution

AgentPay Guard strictly validates a proposed intent, applies deterministic local policy, returns `ALLOW`, `REVIEW`, or `BLOCK`, and writes or reuses append-only JSONL evidence by idempotency key. The demo preserves that evidence in an AgentPay Receipt with `fundsMoved: false`.

## Implemented now

- Generic USDC recipient, scenario, amount, daily-limit, velocity, and suspicious-keyword policy.
- CCTP route-policy preview for proposed Ethereum to Base transfers, including Fast Transfer, wallet-control, estimated-fee, and decimal-safe total context.
- ERC-20 authority proposal context for `approve` and `transferFrom`, spender policy, and informational six-decimal USDC base units.
- Separate Paymaster fee-budget preview for `usdc-paymaster-preview`; it has no UserOperation, permit, bundler, EntryPoint, or gas-payment behavior.
- Append-only JSONL audit records, idempotent replay, optional `programmablePaymentContext`, and AgentPay Receipt evidence.
- Validator scenarios for generic `ALLOW`/`REVIEW`/`BLOCK`, CCTP Fast Transfer `REVIEW`, standard CCTP `ALLOW`, unsupported CCTP `BLOCK`, and ERC-20 approval `REVIEW`.

## Preview-only boundary

CCTP data is policy preview, not CCTP integration. ERC-20 operation/spender data is proposal context, not an allowance or balance read. Paymaster data is fee-budget preview, not a UserOperation. The app does not move funds, connect wallets, sign, hold keys, create permits or transactions, verify Iris, read balances, or confirm settlement/finality.

It also does not claim live Circle, Arc, Gateway, x402, CCTP, Encode, or Ignyte integration; production compliance; AML/KYC; custody; or an official partnership.

## Validation

The current proof has 10 test files and 138 passing tests.

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## Repository

https://github.com/KirillNedoboy/agentpay-guard-circle-arc
