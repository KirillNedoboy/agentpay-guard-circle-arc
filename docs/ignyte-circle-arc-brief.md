# Circle / Arc brief

## Positioning

AgentPay Guard is a preflight decision and evidence layer for autonomous stablecoin commerce. Before an AI agent proceeds toward x402, Circle Gateway, or an Arc-compatible settlement path, Guard evaluates the payment intent, returns `ALLOW`, `REVIEW`, or `BLOCK`, and records why.

## Primary demo

The judge preset is a trusted `0.08 USDC` x402-style API micropayment. It produces an `ALLOW` receipt containing per-request and daily-budget limits, daily spend consumed and remaining, projected daily spend, velocity evidence, matched rules, and a preview-only future settlement handoff.

## Optional illustration

The CitePay flow remains as a secondary local source-selection illustration. It can show trusted API `ALLOW`, premium evidence `REVIEW`, untrusted cache `BLOCK`, and a non-broadcast Arc Testnet simulation for the approved Arc route.

## Rail preview modes

| Rail | Meaning |
|---|---|
| `mock_x402_service` | Preview for an x402-style paid API request. |
| `mock_gateway_nanopayment` | Preview for a Circle Gateway-style nanopayment. |
| `arc_settlement_preview` | Preview for future Arc-compatible USDC settlement. |
| `mock_agent_wallet` | Local agent-wallet style preview/fallback. |

Unknown future rail strings resolve to `executionMode: "live_disabled"` instead of pretending that payment execution exists.

## Boundaries

This repo does not include live Circle Gateway calls, live Arc integration, a real x402 buyer/seller flow, wallet connection, private-key handling, transaction signing, transaction hashes, custody, smart contracts, or autonomous background spending.
