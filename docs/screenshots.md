# Challenge demo screenshots

All PNG files are real captures from the local AgentPay Guard UI. They document policy decisions and proposal evidence only; none shows payment execution or a live protocol integration.

The current reviewer path is x402 first: the trusted `0.08 USDC` API intent is the primary judge flow, followed by the proposed intent, Guard decision, replay and policy evidence, Execution Authorization (when issued), receipt/audit evidence, and the future settlement boundary. CitePay remains a collapsed illustrative local source-selection flow. The older generic captures remain preserved for compatibility.

## Grant evidence capture guidance (Phase 6)

The Phase 6 UI surfaces grant evidence: exact replay evidence, policy attribution
(Policy ID / version / fingerprint), the bounded ExecutionAuthorization, explicit
not-executed states, and local pilot metrics. PNG captures for these states are
pending capture from the live judge flow. Guidance for the planned captures:

1. x402 ALLOW decision with policy evidence (decision, matched rules, reason codes,
   policy ID, policy version, shortened policy fingerprint, "First evaluation").
2. Exact replay evidence: "Exact replay" label, stored audit ID unchanged, same
   execution authorization, and a one-record canonical audit context.
3. Execution Authorization panel: scope `single_intent`, maximum amount equal to the
   proposed `0.08 USDC`, execution scope `prepare + simulate only`,
   `executionStatus: not_executed`, `fundsMoved: false`, and the safety line that
   authorization does not sign, broadcast, submit, or settle a payment.
4. REVIEW and BLOCK states with "No Execution Authorization issued." (no empty
   authorization object).
5. Local pilot evidence panel with the "Local/demo evidence only" qualifier, decision
   counts, replay counters, p95 policy-evaluation duration, and evidence coverage.

The live states above were verified in an automated browser session on 2026-08-13
(see Phase 6 report); the PNG files themselves have not been committed yet.

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
