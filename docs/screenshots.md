# Challenge demo screenshots

All PNG files are real captures from the local AgentPay Guard UI. They document policy decisions and proposal evidence only; none shows payment execution or a live protocol integration.

The current reviewer path is CitePay first, then the proposed payment intent, Guard decision, receipt/audit evidence, and the future settlement boundary. The older generic captures remain preserved for compatibility.

## Legacy generic evidence

| File | What it shows |
|---|---|
| `screenshots/01-allow-decision.png` | Original trusted generic intent returning `ALLOW`. |
| `screenshots/02-review-decision.png` | Original generic review decision. |
| `screenshots/03-block-decision.png` | Original generic block decision. |
| `screenshots/04-audit-log.png` | Original audit-log view. |
| `screenshots/05-citepay-preset-loaded.png` | Existing CitePay preset selection. |
| `screenshots/06-citepay-guard-decisions.png` | Existing CitePay Guard outcomes. |
| `screenshots/07-citepay-spend-summary.png` | Existing CitePay spend summary. |

## Programmable-payment evidence

| File | What it proves |
|---|---|
| `screenshots/08-cctp-fast-transfer-review.png` | CCTP Fast Transfer `REVIEW`, local reason codes, proposed Ethereum to Base route, finality, developer-controlled context, estimated fee, decimal-safe total, and non-execution boundary. |
| `screenshots/09-cctp-standard-allow.png` | Standard CCTP Ethereum to Base `ALLOW` with proposal-only route and fee context. |
| `screenshots/10-cctp-unsupported-route-block.png` | Unsupported CCTP route `BLOCK` with `CCTP_ROUTE_UNSUPPORTED`; it remains a proposed route, not a protocol attempt. |
| `screenshots/11-erc20-approval-review.png` | ERC-20 `approve` `REVIEW`, trusted spender, and six-decimal USDC base-unit evidence. |
| `screenshots/12-programmable-audit-receipt.png` | AgentPay Receipt with audit ID, reason codes, matched rules, programmable authority context, and `fundsMoved: false`. |

## Boundary

The screenshots do not show live Circle, Arc, CCTP, Gateway, x402, Iris, wallet, signing, permit, UserOperation, bundler, EntryPoint, gas-payment, transaction, balance, settlement, or finality behavior. They show local deterministic policy and evidence before any future settlement adapter.
