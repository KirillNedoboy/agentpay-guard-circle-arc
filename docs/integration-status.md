# Integration status

| Area | Status | Exact behavior |
|---|---|---|
| Agent payment-intent API | Implemented | Validates input and returns `ALLOW`, `REVIEW`, or `BLOCK` |
| Spend-control evidence | Implemented | Decimal-string per-request, daily-budget, projected-spend, and velocity values are added to new receipts |
| Audit receipt | Implemented | Append-only JSONL record with idempotency, matched rules, rail preview, and spend controls |
| x402-style API preset | Implemented | Local trusted USDC API micropayment evaluated before any adapter boundary |
| CitePay source selection | Illustrative | Local deterministic source selection and intent mapping; secondary UI flow |
| Arc Testnet USDC adapter | Simulation-only | Validates fixed route metadata and returns `not_broadcast` evidence |
| Circle Gateway / x402 settlement | Future | No package, credential, API call, buyer/seller flow, or adapter execution is present |
| Arc RPC / `eth_call` | Future | No network request is made |
| Wallet signing / broadcast | Future | No wallet connection, transaction, hash, or confirmation flow |

The Arc Testnet values used by the simulation are copied from the official [network setup](https://docs.arc.io/arc/references/connect-to-arc) and [contract address](https://docs.arc.io/arc/references/contract-addresses) references. They are configuration evidence, not proof of a transaction.
