# Submission quick-paste

**AgentPay Guard** is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc. It evaluates a payment intent, returns `ALLOW` / `REVIEW` / `BLOCK`, and writes an auditable receipt before a future settlement adapter executes.

The first demo click runs a trusted `0.08 USDC` x402-style API micropayment. It shows per-request and daily controls, projected spend, velocity, matched rules, reason codes, append-only JSONL evidence, and an AgentPay Receipt with `fundsMoved: false`.

This is proposal-only. No wallet, signing, private keys, custody, real USDC movement, live Arc/Circle/x402 call, RPC call, transaction hash, or settlement exists. The local Arc adapter evidence has `broadcast: false`.

Repository: https://github.com/KirillNedoboy/agentpay-guard-circle-arc

Demo: https://138-124-108-146.nip.io

YouTube: https://youtu.be/Zj_sK3MY9kQ

Fallback MP4: https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4
