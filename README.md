# AgentPay Guard

AgentPay Guard is a preflight firewall and evidence layer that lets AI agents propose USDC spend on Arc without making opaque payment decisions.

## 30-second pitch

An agent can select a paid source and prepare a payment intent in seconds. A wallet alone cannot explain whether that spend is trusted, within budget, or repeatable. AgentPay Guard evaluates the intent with deterministic rules, returns `ALLOW`, `REVIEW`, or `BLOCK`, and stores an append-only receipt. The approved CitePay demo intent then enters an Arc Testnet USDC simulation boundary. It is never broadcast.

Primary hackathon track: **Agentic Economy**.

## What the demo proves

1. A CitePay research agent selects paid evidence sources.
2. Guard evaluates each USDC intent and records why it was allowed, held, or blocked.
3. The approved Arc-routed intent produces deterministic Arc Testnet simulation evidence.
4. The receipt and audit log show the decision, rules, route, amount, and non-broadcast status.

The first screen follows: `Proposed → Evaluated → Approved / Review / Blocked → Arc Testnet simulation → Evidence`.

## Golden path

Run the built-in preset. It selects four sources:

| Source | Decision | Result |
|---|---|---|
| Trusted Arc Testnet verification API, `0.08 USDC` | `ALLOW` | Arc Testnet USDC simulation; not broadcast |
| Premium evidence bundle, `0.25 USDC` | `REVIEW` | Operator decision required |
| Untrusted scrape cache, `0.04 USDC` | `BLOCK` | Cannot reach a payment rail |
| Telemetry attestation note, `0.03 USDC` | `REVIEW` | Operator decision required |

## Arc and USDC status

AgentPay Guard uses a local deterministic simulation, not a live Arc integration. The simulation is fixed to the documented Arc Testnet values:

- network: Arc Testnet, chain ID `5042002`;
- asset: USDC, ERC-20 interface `0x3600000000000000000000000000000000000000`, 6 decimals;
- RPC reference: `https://rpc.testnet.arc.io`;
- explorer reference: `https://testnet.arcscan.app`.

Sources: [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc) and [Arc Testnet contract addresses](https://docs.arc.io/arc/references/contract-addresses).

| Status | Capability |
|---|---|
| Implemented | Policy evaluation, JSONL audit receipts, idempotency, CitePay selection, guided demo, Arc Testnet USDC simulation, health endpoint |
| Simulation-only | Arc Testnet route validation and non-broadcast settlement evidence |
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

Open `http://localhost:3000`, then select **Run demo**.

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

The audit log is file-based and process-local. `REVIEW` has no operator queue yet. The Arc Testnet adapter is intentionally a simulation contract, not `eth_call`, a wallet flow, or payment settlement.
