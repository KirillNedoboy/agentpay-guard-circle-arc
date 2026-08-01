# Reviewer One-Pager

## What is AgentPay Guard?

AgentPay Guard is a deterministic policy and audit layer for AI-agent USDC payment intents before settlement.

## What does it do?

It evaluates an intent and returns `ALLOW`, `REVIEW`, or `BLOCK`. Each successful evaluation creates or reuses an append-only JSONL AgentPay Receipt, including matched rules, reason codes, and decimal-safe spend-control evidence.

## Judge-visible proof

The primary preset evaluates a trusted `0.08 USDC` x402-style API micropayment. Its receipt displays the request amount, per-request limit, review threshold, daily spend consumed and remaining, projected daily spend, and velocity count before a preview-only future settlement handoff.

## Why Arc/Circle?

The product targets programmable USDC payments by agents: paid APIs in an x402-style flow, Circle Gateway-style routing, and Arc settlement. The current code only previews these handoffs; its optional Arc Testnet simulation is local and non-broadcast.

## What is not built?

- real payment execution or USDC movement;
- wallet connection, signing, or custody;
- private-key handling or transaction hashes;
- live x402, Circle Gateway, Arc RPC, or Circle API calls;
- AML/KYC, fraud guarantee, database, or production admin system.
