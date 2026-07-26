# PROJECT.md

## Name

AgentPay Guard

## Category

Web3/backend MVP, AI-agent payments, stablecoin commerce, policy/audit infrastructure.

## Positioning

AgentPay Guard is a preflight policy and audit layer for autonomous AI-agent payments.

It checks payment intent before a payment rail is used.

## Core insight

Autonomous payments create a new control problem:

> The easier it becomes for agents and machines to spend USDC, the more important it becomes to decide whether a payment should happen before it is signed or authorized.

## MVP proof

The MVP proves:

- a CitePay paid-source request becomes a proposed USDC payment intent;
- there is a local payment-intent evaluation flow;
- decisions are deterministic and explainable;
- every decision is auditable;
- the product can sit before x402 / Gateway / Arc payment execution.

## Implemented narrative flow

```txt
CitePay request
  -> proposed USDC payment intent
  -> AgentPay Guard preflight
  -> ALLOW / REVIEW / BLOCK
  -> explanation and matched rules
  -> append-only audit evidence / AgentPay Receipt
  -> future settlement adapter
```

CitePay is an illustrative local demo entry point. It reuses the existing Guard API and source-selection data; it is not a marketplace and does not execute a payment.

## Safety boundary

The current product does not move funds, connect wallets, store keys, sign or submit transactions, call RPC or live Circle/Arc/x402 services, execute CCTP, verify Iris, create permits/UserOperations, or report settlement state.

## What success looks like

A reviewer opens the repo and understands in under 60 seconds:

- what this is;
- what problem it solves;
- how it works;
- why Arc/Circle are relevant;
- how to run the demo;
- what the audit log proves.
