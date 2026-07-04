# Challenge demo screenshots

These screenshots were captured from the local AgentPay Guard demo running in production mode.

They show the current challenge submission flow only. The screenshots do not show live Circle, Arc, x402, wallet signing, transaction execution, or real fund movement.

## Screenshot index

| File | What it proves |
|---|---|
| `docs/assets/screenshots/demo-main.png` | Shows the main demo screen before execution, including the AgentPay Guard positioning, boundary card, mock-rail labels, and initial proof state. |
| `docs/assets/screenshots/scenario-allow.png` | Shows the trusted x402 verification API scenario returning `ALLOW`, with audit ID, matched rules, reason codes, and preview-only x402 rail metadata. |
| `docs/assets/screenshots/scenario-review.png` | Shows the premium evidence bundle scenario returning `REVIEW`, with operator-review reasoning, amount-threshold evidence, audit ID, reason codes, and mock Circle Gateway-style preview metadata. |
| `docs/assets/screenshots/scenario-block.png` | Shows the untrusted scrape cache scenario returning `BLOCK`, with denied-recipient reasoning, audit ID, reason codes, and mock Arc settlement preview metadata. |
| `docs/assets/screenshots/audit-preview.png` | Shows the proof panel with guard decision, audit trace, matched policy rules, and reason codes visible after the demo run. |

## Boundary

All rail data shown in the screenshots is preview-only. AgentPay Guard does not move funds, sign transactions, connect wallets, custody assets, call live Circle or Arc services, run a live x402 buyer or seller flow, or create transaction hashes.
