# AgentPay Guard demo script

Target duration: 60-90 seconds.

## Setup

```bash
pnpm dev
```

Open the local URL, normally `http://localhost:3000`.

## 0:00-0:12 | CitePay request

Say:

> An AI agent needs a paid source. CitePay is the illustrative request story: the source selection becomes a proposed USDC payment intent, not a live purchase.

Click **Run CitePay demo**. Point to the proposed intent fields: agent ID, amount/currency, recipient, scenario, payment rail, and idempotency key.

## 0:12-0:32 | Guard preflight

Show the selected sources and their decisions. Point out that AgentPay Guard sends each existing intent through the same local evaluation API and records matched rules, reason codes, risk, and an audit ID.

Use the quick cases for a fast proof:

- **Generic ALLOW**: a known recipient within policy;
- **CitePay REVIEW**: the premium paid-source request;
- **Hard BLOCK**: the existing denylisted recipient case.

## 0:32-0:52 | AgentPay Receipt evidence

Select **View receipt** and show the AgentPay Receipt. Point to `fundsMoved: false`, the proposal-only safety note, reason codes, matched rules, audit ID, and the optional programmable context when a programmable fixture is evaluated.

Say:

> The receipt and JSONL audit preserve why the policy decided. They are evidence artifacts, not payment or settlement receipts. Replaying an idempotency key reuses the existing audit line.

## 0:52-1:10 | Secondary proof

Expand **Policy test cases** to show the existing CCTP Fast Transfer `REVIEW`, standard CCTP `ALLOW`, unsupported-route `BLOCK`, and ERC-20 approval `REVIEW` fixtures. These previews remain local policy context: no CCTP burn/mint, Iris verification, allowance read, signing, UserOperation, or permit.

## Close

Point to the compact boundary:

```txt
Guard decision -> Future settlement adapter -> Arc / Circle Gateway / x402
```

Say exactly:

> No funds moved. AgentPay Guard is the deterministic policy and evidence layer before settlement.
