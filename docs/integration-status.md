# Integration status

| Context | Implemented behavior | Execution status |
|---|---|---|
| x402-style API micropayment | Deterministic policy input, spend envelope, audit receipt | Preview only; no live x402 call |
| Circle Gateway | Future adapter placement in UI and receipt boundary | No API call |
| Arc | Local future-adapter evidence with `broadcast: false` | No RPC call or settlement |
| CCTP | Local route policy and preview-only explanation | No burn, Iris request, attestation verification, or mint |
| ERC-20 authority | Proposed `approve` / `transferFrom` policy evidence | No allowance/balance read, approval, or transaction |
| USDC Paymaster | Local fee and wallet-control policy context | No UserOperation, permit, bundler, EntryPoint, or gas payment |

AgentPay Guard does not claim official Arc, Circle, or x402 integration or partnership. The scope is intentionally policy before spend.
