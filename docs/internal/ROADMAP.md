# ROADMAP.md

## Current MVP

- Deterministic policy engine.
- x402-first API-micropayment policy envelope with decimal-safe budget and velocity evidence.
- `ALLOW` / `REVIEW` / `BLOCK`.
- JSONL audit log.
- Demo UI.
- Future settlement-adapter preview (`broadcast: false`).
- x402, CCTP, ERC-20, and Paymaster proposal-only demo scenarios.
- README + proof-pack docs.

## After MVP

### Milestone 1 - x402/Gateway adapter

Extend the preview adapter into a buyer-side sandbox adapter after explicit approval.

No real funds without explicit operator setup, wallet/signing review, and separate tests.

### Milestone 2 - Policy management

Add UI/API for editing:

- per-agent limits;
- recipient allowlist;
- review-required recipients;
- scenario allowlist;
- denylist;
- velocity rules.

### Milestone 3 - Webhook/audit export

Add:

- webhook on decision;
- CSV/JSON export;
- audit hash chain or Merkle-style digest.

### Milestone 4 - Team/operator flow

Add:

- review queue;
- manual approval/deny;
- reviewer notes;
- decision history.

### Milestone 5 - Production hardening

Add:

- DB-backed audit log;
- auth;
- rate limiting;
- observability;
- proper deployment config;
- integration tests.

## Not on MVP roadmap

- AML/KYC provider features;
- custody;
- wallet private-key handling;
- autonomous real-money execution by default;
- fake transaction hashes;
- smart contracts unless a specific audit anchoring requirement appears.
