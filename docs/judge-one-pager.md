# AgentPay Guard — judge one-pager

## What is it?

AgentPay Guard is a deterministic preflight layer for AI-agent USDC spend. It decides whether a proposed payment is allowed, requires review, or must be blocked before a payment adapter can receive it.

## Who needs it?

Builders of agents that purchase data, APIs, compute, or services with stablecoins. They need a control point between an agent's intent and a wallet or settlement rail.

## Why now?

Agents can assemble payment requests faster than people can inspect them. A payment rail answers how to transfer value; Guard records whether the request should be allowed in the first place.

## Why Arc?

The demo uses Arc Testnet's documented USDC-native configuration to show the handoff that a future settlement adapter would need. Arc's USDC gas model is relevant to predictable agent payment costs, but this repository does not execute an Arc transaction.

## What works?

The CitePay flow selects sources, creates payment intents, evaluates deterministic policy, writes idempotent JSONL receipts, and produces simulation-only Arc Testnet evidence for the approved intent.

## What does the demo prove?

It proves that an agent can propose multiple USDC spends while Guard creates explainable `ALLOW`, `REVIEW`, and `BLOCK` outcomes. Only `ALLOW` reaches the simulation boundary; the interface states that no funds moved.

## Strongest differentiator

Guard treats explainability and evidence as part of the payment decision, rather than an afterthought after a wallet has already approved a transaction.

## Future work

User-confirmed wallet connection, real RPC simulation, and testnet broadcast require a separately approved scope. No wallet or transaction path is included here.
