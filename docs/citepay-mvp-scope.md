# CitePay MVP Scope

## Role in AgentPay Guard

CitePay is the illustrative local entry story for AgentPay Guard. An agent asks for a paid source, local source selection creates ordinary proposed USDC payment intents, and the existing Guard API evaluates them before any future settlement adapter.

CitePay is not a marketplace, creator-payout system, or live payment product.

## Implemented local slice

- Mock source cards and deterministic selection live in `src/domain/citepay/source-selection.ts`.
- The UI exposes the query, budget, selected sources, skipped sources, proposed intent fields, decisions, audit IDs, and AgentPay Receipt evidence.
- Every selected source is evaluated through `POST /api/payment-intents/evaluate`.
- The same idempotency and append-only JSONL audit behavior applies to CitePay intents and generic intents.
- Quick cases reuse existing generic `ALLOW`, CitePay premium-source `REVIEW`, and denylisted-recipient `BLOCK` intents.

## Current local preset

The built-in preset asks for premium verification data, high-value evidence, telemetry attestation, and scraped cache context. The selected cards demonstrate the existing policy range: trusted API `ALLOW`, premium evidence `REVIEW`, untrusted scrape cache `BLOCK`, and telemetry attestation `REVIEW`.

## Explicit boundary

No source purchase, wallet connection, signing, custody, live API call, RPC call, creator payout, settlement, or transaction is performed. CitePay data is proposal input for deterministic policy and evidence only.

## Future work

Live x402/Circle Gateway/Arc adapters, creator payouts, accounts, policy editing, and marketplace behavior require separate scope and are not part of this MVP.
