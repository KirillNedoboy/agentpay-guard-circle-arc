# AgentPay Guard requirements

## Product

AgentPay Guard is a deterministic policy-and-evidence control plane before autonomous AI-agent USDC payments on Arc. It evaluates a payment intent, returns `ALLOW`, `REVIEW`, or `BLOCK`, and produces an auditable receipt before a future settlement adapter executes.

## Required flow

```txt
agent payment intent
  -> validation
  -> deterministic policy and decimal-safe spend controls
  -> ALLOW / REVIEW / BLOCK
  -> append-only JSONL audit evidence or idempotent reuse
  -> AgentPay Receipt
  -> future settlement adapter boundary
```

The primary demo is a trusted `0.08 USDC` x402-style API micropayment. It must show recipient, amount, per-request limit, daily allowed/remaining/projected spend, velocity, matched rules, reason codes, audit ID, receipt, and the no-settlement boundary.

## Policy

- Unsupported currency, invalid amount, denylisted recipient, hard per-request maximum, and daily limit exceedance block.
- Unknown or review-required recipient, unknown scenario, suspicious terms, and velocity exceedance review unless a block rule applies.
- Known recipient, supported scenario, and amount inside policy allow.
- CCTP, ERC-20 authority, and USDC Paymaster proposal contexts retain their deterministic local rules.
- Money policy decisions use decimal strings and `BigInt`, never JavaScript floating-point arithmetic.

## Audit and receipt

- Audit evidence is append-only JSONL at `data/audit-log.jsonl` by default.
- The same `idempotencyKey` returns the stored record without appending a duplicate.
- Historical records without newer optional evidence fields remain readable.
- New records may include `programmablePaymentContext`, `spendControls`, and local Arc Testnet adapter evidence.
- Every AgentPay Receipt has `fundsMoved: false`.

## Non-goals and safety boundary

No real payment execution, wallet connection, signing, private keys, custody, real USDC movement, live Arc/Circle/x402/CCTP/Gateway call, RPC call, transaction hash, smart contract, database, auth, AML/KYC, fraud guarantee, or official integration/partnership claim.

The Arc Testnet adapter evidence is local simulation only: `broadcast: false`, `status: "not_executed"`.

## Commands

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm smoke
```

`pnpm smoke` requires a running local server. Use `AGENTPAY_AUDIT_LOG_PATH` for an external temporary audit file when smoke-testing.
