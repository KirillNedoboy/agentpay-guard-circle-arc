# AgentPay Guard — judge one-pager

AgentPay Guard answers a narrow question: should an autonomous agent be allowed to spend USDC before a payment adapter runs?

The first click runs a trusted `0.08 USDC` x402-style API micropayment. The result is deterministic: `ALLOW`, `REVIEW`, or `BLOCK`, together with matched rules, reason codes, a decimal-safe spending envelope, and an append-only audit receipt.

The demo is specific to programmable money without pretending to settle it. CCTP, ERC-20 authority, and Paymaster fixtures remain visible as policy contexts; the future adapter preview states `fundsMoved: false` and `broadcast: false`.

Try it: [live demo](https://138-124-108-146.nip.io) (redeploy merged `main` manually before final submission), [repository](https://github.com/KirillNedoboy/agentpay-guard-circle-arc), [YouTube](https://youtu.be/Zj_sK3MY9kQ), [fallback MP4](https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4).
