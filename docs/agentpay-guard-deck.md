# AgentPay Guard — Final Submission Deck

**Project:** AgentPay Guard  
**Track:** Agentic Economy  
**Hackathon:** Programmable Money Hackathon — Arc / Encode Club / Circle

## Slide 1 — The payment firewall for autonomous AI agents

AgentPay Guard evaluates proposed AI-agent USDC payment intents before a future settlement adapter.

**ALLOW · REVIEW · BLOCK**  
Deterministic policy. Explainable evidence. Human-confirmed boundaries.

## Slide 2 — The problem

An autonomous agent can form a payment request faster than an operator can assess whether the recipient, amount, purpose, route, authority, and fee context are acceptable.

A payment rail can move value. It does not automatically preserve the policy reasoning behind the decision.

## Slide 3 — The solution

AgentPay Guard creates a hard policy boundary before settlement:

`Proposed intent → validation → deterministic policy → risk score → decision → receipt`

Every decision returns `ALLOW`, `REVIEW`, or `BLOCK`, with matched rules and an append-only audit record keyed by idempotency.

## Slide 4 — One boundary, multiple payment contexts

- Generic USDC payment intents: recipient, scenario, amount, daily limit, velocity, suspicious keywords.
- CCTP route-policy preview: Ethereum → Base, Fast Transfer, wallet-control, estimated fee, decimal-safe totals.
- ERC-20 authority proposal context: `approve` / `transferFrom`, spender policy, USDC base units.
- Paymaster fee-budget preview: local USDC fee context without UserOperation or gas execution.

All protocol-facing values are proposal-only evidence in the current MVP.

## Slide 5 — What the operator sees

A local CitePay request becomes a proposed USDC intent. The Guard exposes the decision, matched rules, risk context, audit ID, AgentPay Receipt, and `fundsMoved: false` evidence in one review path.

The demo makes the three outcomes legible: safe requests can be allowed, ambiguous requests routed for review, and denylisted or unsupported requests blocked.

## Slide 6 — Trust boundary

**Implemented now**

- Deterministic local policy engine.
- Append-only JSONL audit trail.
- Idempotent replay by intent key.
- AgentPay Receipt evidence.
- Production build and public demo.

**Explicitly not executed**

- No wallet connection.
- No private keys or signing.
- No live funds movement.
- No live Arc, Circle Gateway, CCTP, x402, Iris, bundler, or EntryPoint calls.
- No settlement or finality claim.

## Slide 7 — Proof today, settlement boundary tomorrow

**Validated:** 142 passing tests across 10 test files; lint, typecheck, and build pass.

**Current public assets**

- Repository: `github.com/KirillNedoboy/agentpay-guard-circle-arc`
- Live demo: `https://138-124-108-146.nip.io`
- Demo video: `docs/videos/agentpay-guard-demo-en.mp4`

**Roadmap:** put Arc / Circle Gateway / x402 adapters behind the same policy boundary only after the evidence contract is proven. The Guard remains the decision and audit layer before execution.
