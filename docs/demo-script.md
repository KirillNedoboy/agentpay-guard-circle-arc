# AgentPay Guard demo script

## 0:00–0:15 — problem

> An AI agent can create a USDC payment request faster than a human can inspect it. A wallet can sign a request, but it does not explain whether the spend is trusted, within policy, or auditable.

Show the title and the persistent boundary: **No funds moved. Settlement was not executed.**

## 0:15–0:35 — proposed intent

Click **Run demo**. Explain that the CitePay research agent selects paid evidence sources and turns each into a USDC payment intent. Point to proposed spend and the selected source list.

## 0:35–0:55 — deterministic decision

Show the three outcomes:

- Trusted Arc Testnet verification API: `ALLOW`.
- Premium evidence bundle and telemetry attestation: `REVIEW`.
- Untrusted scrape cache: `BLOCK`.

> Guard checks explicit recipient, scenario, amount, risk, velocity, and idempotency rules. The result is explainable; there is no opaque score deciding a payment.

## 0:55–1:10 — Arc Testnet simulation

Show stage 04. Explain that only the `ALLOW` intent on the Arc route enters a deterministic Arc Testnet USDC simulation. Read the `not_broadcast` badge.

> The simulation uses Arc Testnet's documented chain and USDC contract metadata. It does not call RPC, connect a wallet, sign, or broadcast.

## 1:10–1:25 — evidence

Open the decision proof and audit history.

> Every successful evaluation has an idempotent JSONL receipt. It shows the policy decision and simulation status, but never claims a transaction happened.

## Close

> AgentPay Guard is the preflight firewall and evidence layer for agentic USDC spend. It controls the decision before a future settlement adapter is allowed to act.
