# AgentPay Guard — Arc submission package

## Canonical links

- Repository: https://github.com/KirillNedoboy/agentpay-guard-circle-arc
- Live demo: http://138.124.108.146:3200
- Demo video: https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4
- Reviewer one-pager: https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/reviewer-one-pager.md

## One-line description

AgentPay Guard is a deterministic policy and evidence layer that evaluates proposed AI-agent USDC payment intents before a future Arc, Circle Gateway, or x402 settlement adapter.

## Judge path

```text
CitePay request → proposed USDC intent → Guard preflight
→ ALLOW / REVIEW / BLOCK → matched rules → audit evidence → AgentPay Receipt
```

## Current proof

- 10 test files, 142 passing tests.
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.
- Production service: `agentpay-guard.service`.
- Public demo verified at `http://138.124.108.146:3200`.
- Demo video is served from the public GitHub Raw URL above.

## Honest boundary

This MVP does not move funds, connect wallets, sign transactions, store keys, call live Circle or Arc services, execute CCTP, create permits or UserOperations, read balances or allowances, or claim settlement/finality. All protocol-facing values are proposal-only evidence.

## Manual submission checklist

- [ ] Paste repository URL.
- [ ] Paste live demo URL.
- [ ] Paste demo video URL.
- [ ] Attach or link screenshots from `screenshots/`.
- [ ] Use the description from `docs/submission-answers.md`.
- [ ] Verify the current Arc form fields and deadline in the authenticated Encode dashboard before submitting.