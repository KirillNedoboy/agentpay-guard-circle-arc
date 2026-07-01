# CitePay Agent — Lepton Submission Quick-Paste

Legacy note: this file is retained as historical Lepton/CitePay submission copy.
The current standalone repository is AgentPay Guard for the Agentic Stablecoin Economy.

Скопируй нужные блоки в submission-форму (или скинь мне в чат — я помогу сформулировать).

## Project name
```
CitePay Agent
```

## One-liner
```
CitePay Agent is a local paid-source demo where an AI agent selects mock premium source cards, turns them into payment intents, and runs each intent through AgentPay Guard before any payment rail is used.
```

## Demo link
```
http://138.124.108.146:80/
```
(Production build, React-hydrated. Dev build: `http://138.124.108.146:3000/`)

## GitHub repo
```
https://github.com/KirillNedoboy/agentpay-guard-circle-arc
```

## Video link
```
No standalone AgentPay Guard video link is currently published.
```

## Team / contact
```
Kirill Nedoboy / kirillnedoboy@gmail.com / @kirillnedoboi (Discord) / @kirillnedoboi (Telegram) / @KirillNedoboy (GitHub)
```
Solo submitter.

## Long description (use if asked)
```
CitePay Agent is a deterministic local demo for paid citation and premium-source selection in agent workflows. The demo starts from a fixed query and budget, selects relevant mock source cards, converts each selected source into a normal AgentPay Guard payment intent, and evaluates each intent through the existing Guard API. The UI then shows ALLOW, REVIEW, and BLOCK decisions, proposed spend versus allowed spend, and recent audit records. The branch demonstrates the policy-and-audit layer around agent payments, not live settlement.
```

## What it does (bullets)
```
- starts from a deterministic query and 0.24 USDC budget
- shows mock paid creator/source cards
- selects relevant sources deterministically
- converts selected sources into AgentPay Guard payment intents
- evaluates each intent through POST /api/payment-intents/evaluate
- shows ALLOW / REVIEW / BLOCK decisions
- shows proposed spend 0.24 USDC versus allowed spend 0.08 USDC
- writes or reuses local JSONL audit records with idempotency
```

## What is NOT implemented (important — be honest)
```
- real payment settlement
- wallet signing
- live Circle Gateway / x402 / Arc integration
- custody or private key handling
- DB / auth
- smart contracts
- creator payouts
- production fraud, AML, or compliance claims
```

## Payment / Circle / Arc position
```
The project is aligned with the direction of agent payments and paid APIs, but this branch does not perform live payments. It uses AgentPay Guard as the policy and audit layer before any hypothetical payment rail. Circle, Arc, and x402 are part of the intended future direction for guarded agent payments, not an active integration in this demo branch.
```

## Traction
```
This is currently a local deterministic demo and proof-pack. No real users, live payments, or production traction are claimed yet.
```

## Passphrase (если спросят)
```
LEPTONHOUSE
```

## Notes
- Demo runs on Next.js 14, TypeScript
- Audit log: `data/audit-log.jsonl` (12 entries, append-only)
- Tests: `pnpm test` (vitest)
- No DB, no auth, no live payments
