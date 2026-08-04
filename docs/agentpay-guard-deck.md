# AgentPay Guard deck source

## Slide 1 - Policy and evidence before autonomous USDC spend

AgentPay Guard evaluates an AI-agent payment intent before a future settlement adapter. It returns `ALLOW`, `REVIEW`, or `BLOCK` with audit evidence.

## Slide 2 - The problem

An autonomous agent can create a payment request faster than an operator can assess recipient, amount, purpose, route, authority, and fee context. A payment rail does not itself preserve why a request was allowed, reviewed, or blocked.

## Slide 3 - The first proof

The first click evaluates a trusted `0.08 USDC` x402-style API intent:

`intent -> validation -> deterministic policy -> decision -> audit receipt -> future adapter`

The result shows the per-request limit, daily spend, remaining budget, projected spend, velocity, matched rules, reason codes, and audit ID.

## Slide 4 - Additional policy contexts

- CCTP route preview: local route, finality, wallet-control, fee, and total-budget policy.
- ERC-20 authority: proposed `approve` / `transferFrom` with spender policy.
- Paymaster: local USDC fee and wallet-control policy.

These fields are proposal inputs and evidence only. They do not confirm protocol execution.

## Slide 5 - What a judge sees

The x402 policy envelope shows the decision, deterministic limits, matched rules, append-only audit trace, AgentPay Receipt, and future-adapter boundary. The receipt records `fundsMoved: false`; the local Arc adapter evidence records `broadcast: false`.

## Slide 6 - Boundary

Implemented: policy evaluation, decimal-safe controls, idempotent JSONL evidence, receipts, and preview contexts.

Excluded: wallets, signing, private keys, custody, real USDC movement, live Arc/Circle/x402/CCTP calls, RPC, transactions, and settlement claims.

## Slide 7 - Release state

The repository is verified with deterministic tests, lint, typecheck, production build, and local API smoke. The public demo must be manually redeployed from merged `main`; existing video links remain available but need manual x402-first content review.
