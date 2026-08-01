# Submission answers

## One-liner

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc.

## 30-second pitch

Autonomous agents can request USDC payment for APIs, data, and services, but a wallet cannot explain whether the request should happen. AgentPay Guard evaluates a payment intent against deterministic recipient, amount, budget, and velocity policy; it returns `ALLOW`, `REVIEW`, or `BLOCK` and creates an auditable AgentPay Receipt. The primary demo evaluates a trusted x402-style `0.08 USDC` API micropayment, reveals its policy envelope, and hands it only to a preview of a future x402, Circle Gateway, or Arc adapter.

## Why Arc?

Arc provides a relevant stablecoin-native settlement target for future agent payments. AgentPay Guard provides the control and evidence layer before that target; the optional Arc Testnet simulation uses documented metadata locally and does not call Arc or submit a transaction.

## What is live versus preview-only?

Implemented locally: input validation, deterministic policy, decimal-string spend controls, append-only JSONL receipts, idempotent replay, the x402-style judge preset, and optional CitePay source selection / Arc Testnet simulation. Preview-only: any x402, Circle Gateway, or Arc settlement handoff. There is no connected wallet, signing, custody, RPC request, broadcast, transaction hash, or Circle service call.

## Primary track

Agentic Economy. The product controls how an autonomous agent can propose and justify stablecoin spend before settlement.

## Limitations

The audit log is local and file-based. `REVIEW` has no operator queue. Real testnet settlement needs a separately approved, user-confirmed wallet flow and must not be inferred from this demo.
