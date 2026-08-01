# AgentPay Guard demo script

## 0:00–0:15 — problem and boundary

> An AI agent can request a USDC API payment faster than a person can inspect it. A settlement rail can move value, but it does not decide whether the request is trusted, within budget, or explainable.

Show the title and the persistent boundary: **No payment execution. No wallet signing. No transaction broadcast.**

## 0:15–0:35 — one-click judge proof

Click **Run x402 policy proof**. Explain that this is a trusted `0.08 USDC` x402-style API micropayment and that AgentPay Guard evaluates it before a future adapter can receive it.

## 0:35–0:55 — deterministic policy envelope

Point to the `ALLOW` decision, matched rules, and reason codes. Then show the policy envelope: per-request limit, daily spend already consumed, daily remaining, projected daily spend after this request, and the velocity window.

> These are deterministic decimal-string calculations from policy and recent receipts, not an opaque AI risk score.

## 0:55–1:05 — receipt and handoff boundary

Point to the audit trace and the handoff: **AgentPay Receipt → Future settlement adapter → x402 / Circle Gateway / Arc**.

> The handoff is preview-only. No funds moved, nothing was signed, and nothing was broadcast.

## 1:05–1:20 — optional evidence

Open **Receipt and audit log** to show the machine-readable receipt, including `spendControls`, and explain that repeating the same idempotency key reuses the same record. If time permits, open the optional CitePay flow to show the local ALLOW / REVIEW / BLOCK source-selection illustration and non-broadcast Arc Testnet simulation.

## Close

> AgentPay Guard is the deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc.
