# Audit Log Schema

Audit log file:

```txt
data/audit-log.jsonl
```

Each line is a complete JSON object. The file is append-only, except that a repeated `idempotencyKey` returns the existing record instead of appending a duplicate line.

## Example

```json
{
  "eventType": "agent_payment_guard_evaluated",
  "auditId": "audit_20260629_000001",
  "timestamp": "2026-06-29T12:00:00.000Z",
  "intentId": "ignyte-allow-x402",
  "idempotencyKey": "ignyte-allow-x402",
  "agentId": "agent_ignyte_demo_001",
  "intent": "Buy premium verification data for a research task",
  "amount": "0.08",
  "amountUSDC": "0.08",
  "currency": "USDC",
  "recipient": "trusted-x402-api.demo",
  "recipientId": "trusted-x402-api.demo",
  "recipientLabel": "trusted-x402-api.demo",
  "scenario": "api_access",
  "purpose": "api_data_purchase",
  "paymentRail": "mock_x402_service",
  "rail": "mock_x402_service",
  "decision": "ALLOW",
  "riskScore": 10,
  "policyId": "default-agentpay-policy-v1",
  "policyVersion": "1",
  "policyFingerprint": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "executionStatus": "not_executed",
  "matchedRules": [
    "recipient_allowlisted",
    "scenario_allowed",
    "amount_below_per_payment_limit"
  ],
  "reasonCodes": [
    "RAIL_PREVIEW_ONLY",
    "RECIPIENT_TRUSTED",
    "PURPOSE_ALLOWED",
    "AMOUNT_WITHIN_LIMIT"
  ],
  "reason": "Recipient is allowlisted, amount is below limits, and scenario is allowed.",
  "spendControls": {
    "currency": "USDC",
    "requestedAmount": "0.08",
    "maxAmountPerPayment": "10.00",
    "reviewThreshold": "5.00",
    "dailyLimit": "25.00",
    "dailyAllowedSpend": "0.30",
    "dailyRemainingBefore": "24.70",
    "projectedDailySpend": "0.38",
    "velocityWindowSeconds": 60,
    "velocityAttemptCount": 2,
    "velocityMaxAttempts": 5
  },
  "arcTestnetSimulation": {
    "network": "Arc Testnet",
    "adapter": "future_settlement_adapter",
    "simulation": "local_deterministic_preview",
    "broadcast": false,
    "status": "not_executed"
  },
  "programmablePaymentContext": {
    "transferMode": "cctp",
    "sourceChain": "ethereum",
    "destinationChain": "base",
    "finalityMode": "standard",
    "attestationStatus": "not_requested",
    "walletControlModel": "user-controlled",
    "estimatedFee": "0.01",
    "feeAsset": "USDC",
    "gasPaymentMode": "native-gas",
    "totalProposedSpendUSDC": "0.09"
  },
  "executionMode": "mock_preview",
  "railPreview": {
    "rail": "mock_x402_service",
    "networkLabel": "x402-compatible paid API",
    "settlementAsset": "USDC",
    "executionMode": "mock_preview",
    "recipientId": "trusted-x402-api.demo",
    "amountUSDC": "0.08",
    "explanation": "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
  }
}
```

## Required fields

- `eventType`
- `auditId`
- `timestamp`
- `intentId`
- `idempotencyKey`
- `agentId`
- `intent`
- `amount`
- `amountUSDC`
- `currency`
- `recipient`
- `recipientId`
- `recipientLabel`
- `scenario`
- `purpose`
- `paymentRail`
- `rail`
- `decision`
- `riskScore`
- `policyId`
- `policyVersion`
- `policyFingerprint`
- `executionStatus`
- `matchedRules`
- `reasonCodes`
- `reason`
- `executionMode`
- `railPreview`

`programmablePaymentContext`, `spendControls`, and `arcTestnetSimulation` are optional. Older JSONL lines do not contain them and remain valid.

## Typed policy evidence

New records persist three evidence fields:

- `policyVersion` — the explicit `policyVersion` of the policy that produced the decision (`"1"` for the default policy). It is a revision identifier, never derived from `policyId`.
- `policyFingerprint` — a deterministic SHA-256 of the canonicalized policy object, formatted as `sha256:<64 lowercase hex>`. Object keys are recursively sorted before hashing so a semantically identical policy with different key order hashes equal; array order and exact values are preserved. The fingerprint is computed from the loaded policy at evaluation time and is never stored in the policy file.
- `executionStatus` — always the literal `"not_executed"` in this MVP. It means the record is policy/evidence only: no funds moved, no transaction hash, no settlement or finality.

Legacy JSONL lines written before these fields existed do not contain them. When read, they normalize in memory to `policyVersion: null` and `policyFingerprint: null` — a record predates policy attribution and that metadata was **not** reconstructed — and `executionStatus: "not_executed"`. Reading legacy evidence never rewrites or migrates the audit file.

`programmablePaymentContext` and `arcTestnetSimulation` are optional. Older JSONL lines do not contain them and remain valid.

## Optional spend-control and adapter evidence

New records can persist `spendControls`: the requested amount, configured per-request and daily limits, daily allowed spend, remaining daily budget before the request, projected daily spend, and velocity-window count. Monetary fields are decimal strings calculated without JavaScript floating-point arithmetic.

`arcTestnetSimulation` is a local future-adapter preview only. It records `broadcast: false` and `status: "not_executed"`; it does not record an RPC response, signature, wallet, transaction hash, or settlement result.

## Optional programmable-payment context

When a request includes proposal context, the audit writer persists only normalized policy input/evidence:

- authority: `operation`, `spender`, `amountBaseUnits`;
- route: `transferMode`, `sourceChain`, `destinationChain`, `finalityMode`, `attestationStatus`, `walletControlModel`;
- fee: `estimatedFee`, `feeAsset`, `gasPaymentMode`;
- `totalProposedSpendUSDC` when an estimated fee is present, derived with decimal-string addition.

This object does not record an on-chain allowance or balance, signature, permit, UserOperation, transaction hash, CCTP burn/mint, Iris attestation, gas payment, or settlement/finality result. It records the context that local policy evaluated.

## Structured audit preview

The UI renders a copyable structured audit preview for the most recent audit record. It uses the stored fields directly when present and falls back to the legacy fields for older JSONL lines:

- `intentId` from `intentId` or `idempotencyKey`
- `recipientLabel` from `recipientLabel` or `recipient`
- `amountUSDC` from `amountUSDC` or `amount`
- `purpose` from `purpose` or deterministic scenario mapping
- `rail` from `rail` or `railPreview.rail`
- `decision`
- `matchedRules`
- `reasonCodes`
- `executionMode`
- `railPreview`
- optional `programmablePaymentContext`
- optional `spendControls`
- optional `arcTestnetSimulation`

## Rules

- JSONL, not a JSON array.
- One line per unique `idempotencyKey`.
- No secrets.
- No private keys.
- No auth tokens.
- No signatures.
- No fake transaction hashes.
- No live payment execution evidence is written by this MVP.
- An idempotent replay returns the existing line rather than appending another record.
