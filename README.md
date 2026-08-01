# AgentPay Guard

> Deterministic policy and evidence layer for proposed AI-agent USDC payment intents before a future settlement adapter.

## What it does

AgentPay Guard accepts a proposed payment intent, validates its shape, applies local deterministic policy, returns `ALLOW`, `REVIEW`, or `BLOCK`, and writes or reuses append-only JSONL evidence by `idempotencyKey`.

The app is a local proof. It does not settle a payment. Its audit record and AgentPay Receipt preserve the policy decision and proposal context for review.

## Implemented policy contexts

- **CCTP route policy preview:** evaluates a proposed route such as Ethereum to Base. It is not a CCTP integration and does not burn or mint USDC, request Iris attestations, or call Circle.
- **ERC-20 authority proposal context:** evaluates proposed `approve` and `transferFrom` operations with a spender and optional six-decimal USDC base units. It does not read an on-chain allowance or balance, sign an approval, or submit an ERC-20 transaction.
- **USDC Paymaster fee-budget preview:** evaluates an estimated local USDC fee only for `usdc-paymaster-preview`. It does not create a UserOperation or permit, contact a bundler or EntryPoint, or pay gas.
- **Audit and receipt evidence:** successful evaluations persist the optional normalized `programmablePaymentContext`; the receipt is an evidence artifact with `fundsMoved: false`.

Generic intents remain compatible, as does the existing CitePay source-selection flow.

## Reviewer narrative

The local demo starts with a CitePay paid-source request. It becomes a proposed USDC payment intent, passes AgentPay Guard preflight, and produces an explainable `ALLOW`, `REVIEW`, or `BLOCK` result. The same screen links the proposed intent to matched rules, an audit ID, an AgentPay Receipt, and a compact future settlement boundary for Arc / Circle Gateway / x402.

CitePay is an illustrative local entry story, not a marketplace or payment product. The quick cases reuse the existing generic `ALLOW`, CitePay premium-source `REVIEW`, and denylisted-recipient `BLOCK` intents.

## Demo scenarios

The validator includes the original generic `ALLOW`, `REVIEW`, and `BLOCK` cases plus:

- CCTP Fast Transfer, Ethereum to Base, developer-controlled, `5.01` USDC plus `0.02` fee -> `REVIEW`.
- Standard CCTP, Ethereum to Base -> `ALLOW`.
- Unsupported CCTP route, Ethereum to Arbitrum -> `BLOCK`.
- ERC-20 approval for `trusted-agent-service`, `5010000` base units -> `REVIEW`.

All route, fee, authority, and receipt fields remain proposal-only evidence.

## Safety boundary

AgentPay Guard does not move funds, connect wallets, sign transactions, hold private keys, create permits or UserOperations, read balances or allowances, call Circle, Arc, CCTP, Gateway, x402, Iris, a bundler, or an EntryPoint, or create transaction hashes. It does not claim production compliance, AML/KYC, custody, settlement/finality confirmation, or official Circle, Arc, Encode, or Ignyte partnerships.

## Run and verify

## Live demo

Open the deployed production demo:

**https://138-124-108-146.nip.io**

## Demo video

- [Watch the AgentPay Guard demo on YouTube](https://youtu.be/Zj_sK3MY9kQ)
- [Download the fallback MP4 from GitHub Raw](https://raw.githubusercontent.com/KirillNedoboy/agentpay-guard-circle-arc/main/docs/videos/agentpay-guard-demo-en.mp4)

## Submission deck

[Download the AgentPay Guard slide deck (PDF)](./docs/agentpay-guard-deck.pdf)


The public demo runs the same production build verified by systemd. It remains a local-policy proof: no wallet, signing, network payment, or funds movement is performed.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm dev
```

Open the local URL printed by Next.js, normally `http://localhost:3000`.

The submitted baseline has 10 test files and 142 passing tests.

## Reviewer path

1. `docs/architecture.md`
2. `docs/demo-script.md`
3. `docs/audit-log-schema.md`
4. `docs/submission-answers.md`
5. `docs/screenshots.md`
6. `data/policies.default.json`
7. `tests/`
