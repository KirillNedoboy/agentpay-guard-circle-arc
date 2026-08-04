# AgentPay Guard demo script

Target length: 60–75 seconds.

1. Open AgentPay Guard. Say: “This is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc.”
2. Point to the boundary: no funds move, no wallet signing, no private keys.
3. Click **Run x402 policy proof**. The fixed intent is `0.08 USDC` to `trusted-x402-api.demo` for API access.
4. Show `ALLOW`, the matched rules, reason codes, audit ID, and decimal-safe envelope: per-request limit, daily spend, remaining budget, projected daily spend, and velocity window.
5. Click **View receipt**. Show the AgentPay Receipt, `fundsMoved: false`, append-only JSONL audit evidence, and local Arc Testnet adapter preview with `broadcast: false`.
6. Point to the future settlement boundary. Say that an authorised x402, Circle Gateway, or Arc adapter would be separate work; this repository executes none.
7. Briefly show the visible CCTP, ERC-20, and Paymaster validator fixtures. CitePay remains a collapsed illustrative local source-selection flow.

Do not describe the existing video as an x402-first recording. It is retained as a public reference pending manual review or replacement.
