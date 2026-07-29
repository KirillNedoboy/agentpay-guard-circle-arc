# Integration status

| Area | Status | Exact behavior |
|---|---|---|
| Agent payment-intent API | Implemented | Validates input and returns `ALLOW`, `REVIEW`, or `BLOCK` |
| Audit receipt | Implemented | Append-only JSONL record with idempotency and simulation evidence |
| CitePay source selection | Implemented | Local deterministic source selection and intent mapping |
| Arc Testnet USDC adapter | Simulation-only | Validates fixed route metadata and returns `not_broadcast` evidence |
| Circle App Kit / Gateway | Future | No package, credential, API call, or wallet adapter is present |
| Arc RPC / `eth_call` | Future | No network request is made |
| Wallet signing / broadcast | Future | No wallet connection, transaction, hash, or confirmation flow |

The Arc Testnet values used by the simulation are copied from the official [network setup](https://docs.arc.io/arc/references/connect-to-arc) and [contract address](https://docs.arc.io/arc/references/contract-addresses) references. They are configuration evidence, not proof of a transaction.
