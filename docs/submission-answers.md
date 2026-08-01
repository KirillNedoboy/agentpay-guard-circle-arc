# Encode Club × Arc × Circle submission answers

## Project name

AgentPay Guard

## Track

Agentic Economy

## One-sentence description

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc: it evaluates a payment intent, returns `ALLOW` / `REVIEW` / `BLOCK`, and creates an auditable receipt before any future settlement adapter executes.

## What is built

The application evaluates a USDC payment intent with deterministic policy rules and decimal-string money arithmetic. Its primary judge path is a trusted `0.08 USDC` x402-style API micropayment context. The result shows recipient, amount, daily budget, per-request limit, projected spend, velocity, matched rules, reason codes, append-only JSONL audit evidence, and an AgentPay Receipt.

The application also preserves proposal-only CCTP route, ERC-20 authority, and USDC Paymaster preview contexts. These are local policy inputs and evidence, not protocol confirmations.

## Arc/Circle relevance

Autonomous agents need a control point before programmable-money execution. AgentPay Guard models that control point for USDC/x402-style API payments and exposes where a separately authorised future Arc, Circle Gateway, or x402 adapter would sit after the policy receipt.

## What it does not do

No wallet connection, signing, private keys, custody, real USDC movement, live Arc/Circle/x402/CCTP API call, RPC call, smart contract, database, auth, transaction hash, AML/KYC, fraud guarantee, official integration, or partnership claim.

The Arc Testnet item in the receipt is a local deterministic preview only: `broadcast: false`, `status: "not_executed"`.

## Demo path

Open the demo, click **Run x402 policy proof**, inspect the `ALLOW` envelope, then click **View receipt**. CCTP, ERC-20, and Paymaster fixtures are visible below; the CitePay flow is a secondary local illustration.

## Links

- Repository: https://github.com/KirillNedoboy/agentpay-guard-circle-arc
- Live demo: https://138-124-108-146.nip.io
- YouTube demo: https://youtu.be/Zj_sK3MY9kQ
- Fallback MP4: https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4
- Reviewer one-pager: https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/reviewer-one-pager.md
- Deck: https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/agentpay-guard-deck.pdf

The live demo must be manually redeployed from merged `main` before final submission. The current public video links are preserved, but their x402-first alignment requires manual review or re-recording.
