# AgentPay Guard summary

AgentPay Guard gives autonomous USDC payment workflows a deterministic policy check and an evidence record before a future adapter can execute. It is intentionally not a payment rail.

The demo starts with an x402-style `0.08 USDC` API micropayment and exposes the policy envelope behind the decision: recipient, amount, per-request cap, daily consumption and remaining budget, projected spend, velocity, matched rules, reason codes, audit ID, and AgentPay Receipt.

The repository is a local proposal-only proof. CCTP, ERC-20 authority, Paymaster, and Arc adapter references are policy previews with no RPC call, signing, transaction, or funds movement.
