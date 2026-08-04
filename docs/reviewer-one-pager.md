# AgentPay Guard — reviewer one-pager

## Product

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc. It evaluates a payment intent, returns `ALLOW`, `REVIEW`, or `BLOCK`, and produces audit evidence before a future settlement adapter executes.

## The reviewer proof

Click **Run x402 policy proof**. A trusted `0.08 USDC` API micropayment intent produces an `ALLOW` decision with matched rules, reason codes, an append-only audit ID, and a decimal-safe spending envelope: per-request limit, daily allowed/remaining spend, projected spend, and velocity count.

The linked AgentPay Receipt makes the boundary machine-readable: `fundsMoved: false`. The optional Arc Testnet evidence is a local deterministic preview with `broadcast: false`; it makes no RPC call.

## Why this is Arc/Circle relevant

Autonomous agents need a deterministic decision before a programmable-money adapter acts. The demo models USDC/x402-style API access first, then keeps CCTP, ERC-20 authority, and Paymaster contexts available as additional policy inputs. No protocol confirmation is claimed.

## Scope

Implemented: deterministic policy rules, decimal-safe money arithmetic, idempotent JSONL evidence, receipt construction, and preview-only protocol context.

Excluded: wallets, signing, custody, private keys, real USDC movement, live Arc/Circle/x402/CCTP calls, smart contracts, databases, auth, AML/KYC, and transaction hashes.

## Links

- Repository: https://github.com/KirillNedoboy/agentpay-guard-circle-arc
- Live demo: https://138-124-108-146.nip.io (manually redeploy merged `main` before final submission)
- YouTube: https://youtu.be/Zj_sK3MY9kQ
- Fallback MP4: https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4
- Deck: https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/agentpay-guard-deck.pdf
