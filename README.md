# AgentPay Guard

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc. It evaluates a payment intent, returns `ALLOW`, `REVIEW`, or `BLOCK`, and writes an auditable receipt before a future settlement adapter executes.

The repository is a proposal-only hackathon proof. It does not move USDC, connect a wallet, sign, store keys, call a live Arc/Circle/x402 service, or create a transaction hash.

## Start with the one-minute proof

1. Open the local demo and click **Run x402 policy proof**.
2. Inspect the trusted `0.08 USDC` x402-style API intent, `ALLOW` result, matched rules, reason codes, daily controls, and velocity count.
3. Open the linked AgentPay Receipt and confirm `fundsMoved: false`, append-only audit evidence, and `broadcast: false` future-adapter simulation.
4. Use the visible CCTP, ERC-20, and Paymaster fixtures for additional deterministic policy contexts. CitePay is a collapsed local source-selection example, not the product or payment rail.

## What is implemented

- Decimal-string policy evaluation for amount, recipient, scenario, daily budget, suspicious terms, and velocity.
- `ALLOW` / `REVIEW` / `BLOCK` decisions with matched rules and reason codes.
- A judge-facing x402-style USDC API micropayment preset.
- A typed spend-control envelope: per-request limit, daily allowed/remaining spend, projected spend, and velocity window.
- Append-only JSONL audit evidence with idempotency by `idempotencyKey`.
- AgentPay Receipt evidence with `fundsMoved: false`.
- Preview-only CCTP, ERC-20 authority, Paymaster, and Arc Testnet future-adapter context. The Arc evidence is a local deterministic simulation with `broadcast: false`; it makes no RPC call.

## Boundary

The policy result is intentionally before payment execution:

```txt
Agent payment intent
  -> AgentPay Guard policy and evidence
  -> ALLOW / REVIEW / BLOCK + receipt
  -> future x402 / Circle Gateway / Arc settlement adapter
```

No adapter executes in this repository. An `ALLOW` only means the local policy would permit a separately authorised future adapter to be considered.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. For an isolated smoke check, run the app with an external audit path:

```bash
AGENTPAY_AUDIT_LOG_PATH=/tmp/agentpay-guard/audit-log.jsonl pnpm dev
SMOKE_BASE_URL=http://127.0.0.1:3000 pnpm smoke
```

On PowerShell, set the two environment variables with `$env:NAME = "value"` before running the commands. Without `AGENTPAY_AUDIT_LOG_PATH`, the MVP uses `data/audit-log.jsonl`.

## Verify

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm smoke
```

`pnpm smoke` requires a running local server. It submits deterministic `ALLOW`, `REVIEW`, and `BLOCK` intents and verifies audit IDs, spend controls, and a non-broadcast adapter preview.

## Public review assets

- Repository: [KirillNedoboy/agentpay-guard-circle-arc](https://github.com/KirillNedoboy/agentpay-guard-circle-arc)
- Live demo: [138-124-108-146.nip.io](https://138-124-108-146.nip.io) — published separately; manually redeploy merged `main` before final Encode submission.
- YouTube demo: [youtu.be/Zj_sK3MY9kQ](https://youtu.be/Zj_sK3MY9kQ)
- Fallback MP4: [agentpay-guard-demo-en.mp4](https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4)
- Reviewer one-pager: [docs/reviewer-one-pager.md](https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/reviewer-one-pager.md)
- Judge one-pager: [docs/judge-one-pager.md](https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/judge-one-pager.md)
- Deck: [PDF](https://github.com/KirillNedoboy/agentpay-guard-circle-arc/blob/main/docs/agentpay-guard-deck.pdf) and [source](docs/agentpay-guard-deck.md)

The existing video links are preserved but have not been re-recorded for this x402-first click path. Review or replace the media manually before final submission.

## Project structure

```txt
src/domain/payment-intent  intent validation, rails, receipt, judge preset
src/domain/policy          deterministic engine and spend controls
src/domain/audit           append-only JSONL evidence and idempotency
src/domain/citepay         secondary local source-selection story
src/app                    Next.js UI and API routes
```

See [architecture](docs/architecture.md), [demo script](docs/demo-script.md), [submission answers](docs/submission-answers.md), and the [reconciliation report](docs/reconciliation-report.md).
