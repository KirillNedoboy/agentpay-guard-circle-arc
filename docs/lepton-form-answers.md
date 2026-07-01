# Lepton Form Answers

Legacy note: this file is retained as historical Lepton/CitePay submission copy.
The current standalone repository is AgentPay Guard for the Agentic Stablecoin Economy.

## 1. Project Name

CitePay Agent

## 2. Short Description

CitePay Agent is a local paid-source demo where an AI agent selects mock premium source cards, turns them into payment intents, and evaluates them through AgentPay Guard before any payment rail is used.

## 3. Long Description

CitePay Agent is a deterministic local demo for paid citation and premium-source selection in agent workflows. The demo starts from a fixed query and budget, selects relevant mock source cards, converts each selected source into a normal AgentPay Guard payment intent, and evaluates each intent through the existing Guard API. The UI then shows `ALLOW`, `REVIEW`, and `BLOCK` decisions, proposed spend versus allowed spend, and recent audit records. The branch demonstrates the policy-and-audit layer around agent payments, not live settlement.

## 4. Problem

AI agents may need premium creator-owned sources, but builders need a policy and audit step before any paid source flow proceeds. Without a preflight layer, an agent can move toward payment decisions without enough control over recipient trust, amount limits, scenario fit, and review or block conditions.

## 5. What It Does

- starts from a deterministic query and `0.24 USDC` budget;
- shows mock paid creator/source cards;
- selects relevant sources deterministically;
- converts selected sources into AgentPay Guard payment intents;
- evaluates each intent through `POST /api/payment-intents/evaluate`;
- shows `ALLOW`, `REVIEW`, and `BLOCK`;
- shows proposed spend `0.24 USDC` versus allowed spend `0.08 USDC`;
- writes or reuses local JSONL audit records through the existing Guard path.

## 6. How It Uses AI Agents

The demo models an agent answering a user question that needs premium sources. The agent-side behavior is local and deterministic: it examines the preset query, selects relevant source cards, prepares payment intents for those sources, and surfaces the Guard decisions that would gate any later payment step.

## 7. How It Uses Payments / Circle / Arc Direction Without Overclaiming Live Integration

The project is aligned with the direction of agent payments and paid APIs, but this branch does not perform live payments. It uses AgentPay Guard as the policy and audit layer before any hypothetical payment rail. Circle, Arc, and x402 are part of the intended future direction for guarded agent payments, not an active integration in this demo branch.

## 8. What Is Implemented

- local deterministic CitePay demo UI;
- mock paid creator/source cards;
- deterministic source selection from the preset query;
- AgentPay Guard evaluation API reuse;
- `ALLOW` / `REVIEW` / `BLOCK` decisions;
- proposed spend versus allowed spend;
- append-only JSONL audit log with idempotency;
- screenshot-backed proof-pack assets.

## 9. What Is Not Implemented

- real payment settlement;
- wallet signing;
- live Circle Gateway / x402 / Arc integration;
- custody or private key handling;
- DB / auth;
- smart contracts;
- creator payouts;
- production fraud, AML, or compliance claims.

## 10. Demo Link Placeholder

`http://138.124.108.146:80/` (production build, port 80 — React-hydrated)

If the reviewer prefers the dev build: `http://138.124.108.146:3000/` (port 3000, Turbopack dev).

For local reproduction: `pnpm dev` → `http://localhost:3000/`.

## 11. GitHub Repo Placeholder

`https://github.com/KirillNedoboy/agentpay-guard-circle-arc`

## 12. Video Link Placeholder

No standalone AgentPay Guard video link is currently published.

## 13. Team / Contact Placeholder

`KirillNedoboy / kirillnedoboy@gmail.com` (solo submitter, see GitHub profile)

## 14. Traction Answer

This is currently a local deterministic demo and proof-pack. No real users, live payments, or production traction are claimed yet.
