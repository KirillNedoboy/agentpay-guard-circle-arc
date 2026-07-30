# Reviewer One-Pager

## What is AgentPay Guard?

AgentPay Guard is a deterministic policy and evidence layer for proposed AI-agent USDC payments.

**Live demo:** http://138.124.108.146:3200

## Reviewer path

```txt
CitePay request -> proposed payment intent -> Guard preflight
-> ALLOW / REVIEW / BLOCK -> explanation -> audit / AgentPay Receipt
-> future settlement adapter
```

CitePay is the illustrative local entry story. It reuses the existing Guard API and does not execute a purchase.

## What the MVP shows

- strict validation and deterministic policy precedence;
- risk score, reason, matched rules, reason codes, and audit ID;
- append-only JSONL evidence with idempotent replay;
- AgentPay Receipt with `fundsMoved: false`;
- generic quick `ALLOW`, CitePay premium-source `REVIEW`, and hard `BLOCK` cases;
- proposal-only CCTP, ERC-20 authority, and Paymaster previews.

## Why Arc/Circle?

The product demonstrates the control point before future USDC settlement paths such as x402, Circle Gateway, or Arc. The current app does not call those services.

## Safety boundary

No live payment, RPC, wallet, private key, signing, permit, UserOperation, CCTP burn/mint, Iris verification, transaction hash, balance/allowance read, or settlement confirmation is produced.

## Future work

Settlement adapters, review queues, policy management, and integrations require separate scope.
