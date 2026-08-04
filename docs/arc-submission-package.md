# AgentPay Guard — Arc submission package

## Canonical assets

- Repository: https://github.com/KirillNedoboy/agentpay-guard-circle-arc
- Live demo: https://138-124-108-146.nip.io
- YouTube: https://youtu.be/Zj_sK3MY9kQ
- Fallback MP4: https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4
- Reviewer one-pager: https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/reviewer-one-pager.md
- Deck source: https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/agentpay-guard-deck.md
- Deck PDF: https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/agentpay-guard-deck.pdf

## Submission framing

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc. A judge can click one trusted x402-style `0.08 USDC` API intent and immediately inspect the decision, decimal-safe spend controls, matched rules, audit record, receipt, and future-adapter boundary.

The public repository implements policy and evidence, not settlement. `fundsMoved` is always `false`; the local Arc Testnet preview has `broadcast: false`; no live Arc, Circle, x402, CCTP, RPC, wallet, signing, custody, or transaction capability is present.

## Manual release actions before final Encode submission

1. Merge the reviewed integration PR into `main`.
2. Redeploy the live demo from merged `main`; do not deploy this branch automatically.
3. Review the YouTube and MP4 content against the x402-first click path. Preserve the links, but re-record if the media does not match this implementation.
4. Open the production demo and perform the click path in `docs/demo-script.md`.
