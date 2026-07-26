# AgentPay Guard demo script

Target duration: 60–90 seconds.

## Setup

```bash
pnpm dev
```

Open the local URL printed by Next.js, normally `http://localhost:3000`. Expand **Policy test cases**.

## 0:00–0:15 — Problem

Say:

> Autonomous agents need spend controls before programmable USDC execution. AgentPay Guard evaluates a proposed intent and records why it is allowed, reviewed, or blocked.

Point to the boundary card: no payment execution, wallet signing, or private keys.

## 0:15–0:35 — Fast Transfer review

Select **CCTP Fast Transfer review** and click **Test decision**.

Show `REVIEW`, matched rules, and reason codes. Point out the proposed Ethereum to Base route, `fast-transfer` finality, developer-controlled wallet context, `5.01 USDC` amount, `0.02 USDC` estimated fee, and `5.03 USDC` decimal-derived total.

Say:

> This is a CCTP policy preview. The evidence says the proposed route needs review; it does not burn or mint USDC or request or verify an Iris attestation.

## 0:35–0:50 — Audit and receipt

Show the selected AgentPay Receipt and expand the audit proof. Point out the optional programmable context, audit ID, reason codes, and `fundsMoved: false`.

Say:

> The audit and receipt preserve policy evidence. They are not settlement records.

## 0:50–1:10 — Allow and block

Select **CCTP standard route allow** and show `ALLOW`. Then select **CCTP unsupported route block** and show `BLOCK` with `CCTP_ROUTE_UNSUPPORTED`.

## 1:10–1:20 — Authority context

Select **ERC-20 approval review**. Show the proposed `approve` operation, trusted spender, and `5010000` six-decimal base units. State that the app did not read an allowance or sign an approval.

## Closing

Say exactly:

> No funds moved. AgentPay Guard is the deterministic policy and evidence layer before settlement.
