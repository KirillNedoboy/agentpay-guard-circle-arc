# Submission answers

## One-liner

AgentPay Guard is a deterministic preflight firewall and evidence layer for AI-agent USDC payment intents before settlement.

## 30-second pitch

Autonomous agents can request USDC payments for data, APIs, and services, but a wallet cannot explain whether the request should happen. AgentPay Guard evaluates a proposed payment against deterministic policy, returns ALLOW, REVIEW, or BLOCK, and writes an auditable receipt. In the demo, an approved CitePay research intent reaches a non-broadcast Arc Testnet USDC simulation boundary; reviewed and blocked intents do not.

## Why Arc?

Arc Testnet gives the future settlement boundary a stablecoin-native reference: USDC is the gas token and the network exposes documented EVM and USDC configuration. AgentPay Guard uses those official parameters in a local simulation today. It does not call Arc or submit a transaction.

## What is live versus preview-only?

Live in the local app: intent validation, deterministic policy, source selection, JSONL audit receipts, idempotent replay, and the Arc route simulation result. Preview-only: the Arc handoff itself. There is no connected wallet, RPC request, signature, broadcast, transaction hash, or Circle service call.

## Primary track

Agentic Economy. The product controls how an autonomous agent can propose and justify stablecoin spend. It does not currently implement a DeFi protocol or execution flow.

## Limitations

The audit log is local and file-based. REVIEW does not include an operator queue. Real testnet settlement needs a separately approved user-confirmed wallet flow and must not be inferred from this demo.
