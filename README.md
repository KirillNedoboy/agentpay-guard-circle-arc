# AgentPay Guard

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc.

## 30-second pitch

An agent can request paid API access in seconds, but a wallet cannot explain whether the spend is trusted, within budget, or repeatable. AgentPay Guard evaluates the intent with deterministic rules, returns `ALLOW`, `REVIEW`, or `BLOCK`, and creates an append-only AgentPay Receipt. The primary demo is a trusted `0.08 USDC` x402-style API micropayment: it shows the per-request limit, daily budget, projected spend, velocity window, matched rules, and a preview-only future settlement handoff.

Primary hackathon track: **Agentic Economy**.

## What the demo proves

1. An AI agent proposes a trusted x402-style USDC API micropayment.
2. Guard checks recipient, amount, per-request limit, daily budget, velocity, and deterministic policy.
3. The interface shows `ALLOW`, `REVIEW`, or `BLOCK`, matched rules, and a receipt-backed policy envelope.
4. The receipt is handed only to a future x402, Circle Gateway, or Arc adapter preview; nothing is settled.

The primary screen follows: `Agent intent → policy envelope → ALLOW / REVIEW / BLOCK → AgentPay Receipt → future settlement adapter preview`.

## Judge path

Click **Run x402 policy proof**. The deterministic preset is:

| Payment intent | Decision | Result |
|---|---|---|
| Trusted x402-style verification API, `0.08 USDC` | `ALLOW` | AgentPay Receipt with per-request, daily-budget, projected-spend, and velocity evidence; mock rail preview only |

The CitePay source-selection and Arc Testnet simulation remain available as an optional illustrative secondary flow. They are not the primary product label or judge path.

## Arc and USDC status

AgentPay Guard uses a local deterministic simulation, not a live Arc integration. The simulation is fixed to the documented Arc Testnet values:

- network: Arc Testnet, chain ID `5042002`;
- asset: USDC, ERC-20 interface `0x3600000000000000000000000000000000000000`, 6 decimals;
- RPC reference: `https://rpc.testnet.arc.io`;
- explorer reference: `https://testnet.arcscan.app`.

Sources: [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc) and [Arc Testnet contract addresses](https://docs.arc.io/arc/references/contract-addresses).

| Status | Capability |
|---|---|
| Implemented | Policy evaluation, decimal-safe spend controls, JSONL receipts, idempotency, x402-style judge preset, CitePay selection, Arc Testnet simulation, health endpoint |
| Preview-only | x402-style, Circle Gateway, and Arc settlement handoff descriptions; Arc Testnet route validation and non-broadcast simulation evidence |
| Future | Wallet connection, user confirmation, RPC simulation, transaction broadcast, Circle App Kit, live payment rails |

## Safety boundary

This repository does not move funds, connect a wallet, sign a transaction, hold a private key, call Circle or Arc services, create a transaction hash, or claim an official partnership. `ALLOW` means the intent may enter a future settlement adapter; it does not mean a payment occurred.

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm dev
```

Open `http://localhost:3000`, then select **Run x402 policy proof**.

In a second terminal, with the app running:

```bash
pnpm smoke
```

The smoke command checks health plus `ALLOW`, `REVIEW`, and `BLOCK` evaluation results. It writes three local JSONL audit records by design; it never broadcasts a transaction.

## Documentation

- [Judge one-pager](docs/judge-one-pager.md)
- [Demo script](docs/demo-script.md)
- [Submission answers](docs/submission-answers.md)
- [Architecture](docs/architecture.md)
- [Integration status](docs/integration-status.md)
- [Proof-pack checklist](docs/proof-pack-checklist.md)
- [Deployment guide](docs/deployment.md)

## Limits

The audit log is file-based and process-local. `REVIEW` has no operator queue yet. The x402/Circle/Arc handoff is intentionally preview-only; the Arc Testnet adapter is a local simulation contract, not `eth_call`, a wallet flow, or payment settlement.
