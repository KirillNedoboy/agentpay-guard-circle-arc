# Canonical Grant Scenarios

The four canonical decision/evidence cases for the Circle Grants pilot track. They
prove existing deterministic behavior of AgentPay Guard; they do not add product
behavior. CCTP, ERC-20 authority, and USDC Paymaster fixtures remain
compatibility/evidence scenarios and are not part of the canonical set.

| Scenario | Fixture | Expected evidence |
| --- | --- | --- |
| ALLOW | `examples/scenario-allow-api.json` | `ALLOW`; `replayEvidence {replayed:false, replayMismatch:false, policyChanged:false}`; `executionStatus: "not_executed"`; ExecutionAuthorization present (`decision: "ALLOW"`, `scope: "single_intent"`, `maxAmountUSDC` = proposed `0.08`, `executionScope: ["prepare","simulate"]`, `fundsMoved: false`); one JSONL record. |
| REVIEW | `examples/scenario-review-machine.json` | `REVIEW`; `replayEvidence {false,false,false}`; `executionStatus: "not_executed"`; stable reason code `RECIPIENT_REVIEW_REQUIRED`; no ExecutionAuthorization; one JSONL record. |
| BLOCK | `examples/scenario-block-risky.json` | `BLOCK`; `replayEvidence {false,false,false}`; `executionStatus: "not_executed"`; stable reason code `RECIPIENT_BLOCKED`; no ExecutionAuthorization; one JSONL record. |
| REPLAY | `examples/scenario-replay.json` (descriptor of `scenario-allow-api.json`) | Two-evaluation sequence: first `replayed:false`, second `replayed:true`; `replayMismatch:false`, `policyChanged:false`; same `auditId`; same deterministic `authorizationId`; one JSONL record after both calls; `executionStatus: "not_executed"`, `fundsMoved: false`. |

REPLAY is a two-evaluation sequence, not a separate payment intent: the same
validated intent with the same `idempotencyKey` is evaluated twice against the same
audit log. It proves idempotent evidence reuse, not a new decision class.

No scenario moves funds.

Executed by `tests/canonical-grant-scenarios.test.ts` (end-to-end through
`evaluatePaymentIntent` with an isolated temporary audit path) and
`tests/scenario-fixtures.test.ts` (policy-engine level plus descriptor consistency).
