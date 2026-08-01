# AgentPay Guard — judge one-pager

## What is it?

AgentPay Guard is a deterministic policy-and-evidence control plane for AI-agent USDC payment intents. Before any future x402, Circle Gateway, or Arc settlement adapter can act, it returns `ALLOW`, `REVIEW`, or `BLOCK` and creates an auditable receipt.

## Judge path

Click **Run x402 policy proof**. A trusted `0.08 USDC` x402-style API micropayment is evaluated against a known recipient, amount controls, daily budget, projected daily spend, and a velocity window. The UI then shows the decision, matched rules, reason codes, and the spend-control evidence attached to its AgentPay Receipt.

## Why this matters

Autonomous agents can request payment for APIs, data, compute, and services faster than a person can inspect each request. A payment rail moves value; Guard supplies the deterministic control point and evidence needed before the rail is allowed to do so.

## Arc and Circle relevance

The receipt exposes a preview-only handoff to future x402, Circle Gateway, and Arc adapters. The optional CitePay flow retains a local Arc Testnet USDC simulation using documented network metadata, but this repository does not call RPC, a Circle service, or a live x402 endpoint.

## What is built

- deterministic recipient, scenario, amount, daily-limit, and velocity policy;
- decimal-string spend-control calculations;
- append-only JSONL AgentPay Receipts with idempotency;
- x402-style USDC API micropayment judge preset;
- optional CitePay source-selection flow and local Arc Testnet simulation evidence.

## Boundary

No funds move. There is no wallet connection, signing, custody, private key, transaction hash, broadcast, or official Arc/Circle integration claim. `ALLOW` means a future settlement adapter may be considered; it never means that payment occurred.
