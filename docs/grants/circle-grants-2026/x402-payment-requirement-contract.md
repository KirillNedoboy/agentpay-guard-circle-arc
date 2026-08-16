# Purpose

I1 is the first step of the approved pre-Phase-9 integration track (decision
record `integration-feasibility.md`, **GO WITH BLOCKERS**). It is a **DATA
CONTRACT + EVIDENCE** layer for the official x402 `PaymentRequirements` object
used by the approved Circle Gateway / Arc Testnet exact-payment EVM thesis. It
does **NOT** authorize execution.

I1 normalizes the official x402 `PaymentRequirements` into a typed, validated
object, produces a deterministic requirement digest, and binds that digest into
Guard evidence. It is a pure, keyless, in-process contract layer: no network
calls, no signing, no settlement, no funds movement.

# Source Contract

The canonical source for the x402 `PaymentRequirements` object is the official
x402 protocol specification v2 from the x402-foundation GitHub org, referenced
as **S9** in `integration-feasibility.md`:

- **S9** — X402 Protocol Specification, Protocol Version 2 —
  `https://raw.githubusercontent.com/x402-foundation/x402/main/specs/x402-specification-v2.md`
  (v2.0 dated 2025-12-09). Defines the `PaymentRequired` / `PaymentPayload` /
  `SettlementResponse` / `VerifyResponse` schemas, including the
  `PaymentRequirements` field definitions (`scheme`, `network` CAIP-2, `amount`
  in atomic units, `asset`, `payTo`, `maxTimeoutSeconds`, `extra`), the `exact`
  scheme, and the `/verify` / `/settle` / `/supported` flow.

The exact-payment EVM/Gateway binding is documented by Circle's nanopayments
seller quickstart, referenced as **S17** in `integration-feasibility.md`:

- **S17** — Quickstart: Accept payments with nanopayments —
  `https://developers.circle.com/gateway/nanopayments/quickstarts/seller.md`
  (uses Arc Testnet, `network: "eip155:5042002"`, `maxTimeoutSeconds: 604900`,
  EIP-712 domain `name: "GatewayWalletBatched"`, `version: "1"`,
  `verifyingContract` = Gateway Wallet contract).

I1 implements the normalization of the `exact` scheme requirement only, as
required by the bounded integration slice.

# Normalized Fields

I1 normalizes the official `PaymentRequirements` (S9 §5.1.2, S17) into a typed
object with the following fields:

| Field | Normalized type / rule |
| --- | --- |
| `scheme` | Literal string `"exact"` (the bounded slice implements the `exact` scheme only). |
| `network` | CAIP-2 EVM identifier, syntax `eip155:<positive decimal chainId>` (e.g. `eip155:5042002` for Arc Testnet). Syntax-only validation; no chain allowlisting (that is I2). |
| `amount` | Atomic-unit canonical base-10 integer string (e.g. `"10000"` = 0.01 USDC at 6 decimals). String-only; no decimals, no negative, no exponent, no leading-zero ambiguity. |
| `asset` | EVM `0x` + 40 hex characters (token contract address); casing preserved. |
| `payTo` | EVM `0x` + 40 hex characters (recipient wallet address); casing preserved. |
| `maxTimeoutSeconds` | Positive integer; no `NaN`, no `Infinity`, no fractional, no negative, no zero. |
| `extra` | Strict typed object `X402ExactExtra`: required `name` (string), `version` (string), `verifyingContract` (EVM address); optional `assetTransferMethod?: "eip3009"` and `paymentFlow?: "authorization"` (allowed values only). |

The `extra` shape models the exact-EVM (eip3009) path as used by Circle
Gateway nanopayments (S12, S17): `name` and `version` are the required EIP-712
domain name/version of the token contract (Gateway uses `"GatewayWalletBatched"`
and `"1"`), `verifyingContract` is the required EIP-712 domain verifying
contract (the Gateway Wallet contract on the target chain, validated
structurally as an EVM address; the concrete allowlisted address is I2's
concern), and `assetTransferMethod` / `paymentFlow` are the optional
protocol-reserved keys (S9 §6.1) with exact allowed values only (`"eip3009"`,
`"authorization"`).

**Example (official fixture, per the verified feasibility sources S17/S20/S21/
S24/S25):** Arc Testnet exact-EVM requirement —

```ts
{
  scheme: "exact",
  network: "eip155:5042002",            // Arc Testnet (S17 comment, S24)
  amount: "10000",                      // 0.01 USDC at 6 decimals (S17)
  asset: "0x3600000000000000000000000000000000000000", // Arc Testnet USDC (S20/S25)
  payTo: "0x1111111111111111111111111111111111111111", // deterministic TEST-ONLY fixture, not a real seller
  maxTimeoutSeconds: 604900,            // official Gateway value (S17)
  extra: {
    name: "GatewayWalletBatched",       // Gateway EIP-712 domain (S17)
    version: "1",                       // (S17)
    verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" // Arc Testnet GatewayWallet (S21/S25)
  }
}
```

No private key, signature, or transaction hash appears anywhere in the fixture.

# Validation Rules

I1 performs **syntax validation only** — it validates the structure and
form of the incoming requirement against the contract. It does **not** perform
network/contract allowlisting (that is I2).

- **Strict unknown-field rejection** at the top level and inside `extra`.
  Unknown fields are **rejected**, never silently dropped. This is
  security-sensitive: injected fields such as `privateKey`, `signature`,
  `transactionHash`, `to`, `data`, `execute`, or `rpcUrl` are rejected rather
  than ignored, so no execution-adjacent field can ride along inside a
  requirement.
- `amount` must be a canonical positive base-10 integer string (regex
  `/^[1-9]\d*$/`) — no decimals, no negative sign, no exponent/`e` notation,
  no leading zeros. Zero is rejected (documented decision; sources S9 §5.1.2 /
  S11). String-only.
- `network` must match the CAIP-2 EVM syntax `eip155:<chainId>` where the
  chain id is a positive decimal integer with no leading zeros, zero, or
  negatives (regex `/^eip155:[1-9]\d*$/`).
- `asset` and `payTo` must match `0x` followed by exactly 40 hex characters
  (regex `/^0x[0-9a-fA-F]{40}$/`); case is preserved (never lowercased — the
  literal is committed as received).
- `maxTimeoutSeconds` must be a positive safe integer. The official schema
  type is `number` (S9 §5.1.2), so strings are rejected; `NaN`, `Infinity`,
  `-Infinity`, fractions, zero, negatives, and non-safe integers are rejected.
- `scheme` must be the literal `"exact"`.
- `extra` follows `X402ExactExtra`: `name`/`version` are non-empty strings,
  `verifyingContract` is an EVM address, and `assetTransferMethod` /
  `paymentFlow` are optional with exact allowed values only.

# Deterministic Digest

I1 produces a deterministic digest of a fully validated normalized requirement:

```
sha256:<64 lowercase hex>
```

- Computed over the **fully validated normalized requirement** using the
  existing repo stable-JSON canonicalization helper
  (`src/lib/stable-json.ts`).
- **Key-order independent** (keys are sorted during canonicalization).
- **Exact values significant** — changing any bound field changes the digest.
- **No wall clock, randomness, or environment** — the digest is fully
  deterministic and replayable for the same validated requirement.
- **Never fingerprints raw input** — only the validated, normalized
  requirement is digested.

The digest is the direct cryptographic commitment that I2 will use as an
execution gate. It is produced by
`fingerprintX402PaymentRequirement(requirement)` in
`src/domain/x402/payment-requirement.ts`, which returns
`sha256:${stableSha256(requirement)}` using the repo's `stableSha256` helper
(`src/lib/stable-json.ts`). A pure helper `x402NetworkChainId(network)` returns
the numeric chain-id string from a validated CAIP-2 EVM network identifier
(e.g. `"eip155:5042002"` → `"5042002"`); it performs no network policy or
allowlisting.

# Evidence Types

I1 emits deterministic evidence with no execution state. The concrete type and
function names are taken from the implementation
(`src/domain/x402/payment-requirement-evidence.ts`); the shapes below are the
I1 spec.

**`PaymentRequirementEvidence`** — the canonical deterministic evidence for a
normalized, digested payment requirement. Built by
`buildPaymentRequirementEvidence(requirement)`:

- `evidenceType`: `"x402_payment_requirement"`
- `version`: `"v1"`
- `protocol`: `"x402"`
- `x402Version`: `2`
- `requirementDigest`: `sha256:<64 hex>` of the validated requirement
- authoritative non-secret fields: `scheme`, `network`, `amountAtomic`,
  `asset`, `payTo`, `maxTimeoutSeconds` (field list mirrors the authoritative,
  non-secret `PaymentRequirements` fields, S9 §5.1.2; `extra` is committed by
  the digest rather than duplicated)
- **No signature, no private key, no transaction hash, no settlement status**
- **No timestamp** — deterministic, so the same requirement yields the same
  evidence every time

**`AuthorizedPaymentRequirementEvidence`** — the association/linkage evidence
binding a `PaymentRequirementEvidence` to an existing Guard
`ExecutionAuthorization`. Built by `buildAuthorizedPaymentRequirementEvidence`
from an existing `ExecutionAuthorization` + `PaymentRequirementEvidence`
(`auditId` and `authorizationId` come verbatim from the authorization; no
mutation):

- `evidenceType`: `"authorized_x402_payment_requirement"`
- `version`: `"v1"`
- `auditId`: the Guard canonical audit record id
- `authorizationId`: the Guard `ExecutionAuthorization` id
- `requirementDigest`: the digest of the bound requirement
- `executionStatus`: `"not_executed"`
- `fundsMoved`: `false`

This type is **association/linkage evidence only** — it records that a
requirement is bound to an authorization. It is **NOT an execution approval**,
NOT "payment ready", and NOT "settlement authorized". It performs no network
action and makes no assertion that amount/payTo/network are safe to execute
(that is I2's execution security gate).

# Relationship to ExecutionAuthorization

I1 does **NOT** modify `ExecutionAuthorization` v1, its `authorizationId`
algorithm, or authorization responses. The existing v1 envelope and its
deterministic `auth_<sha256>` id are unchanged.

The relationship is additive: the requirement digest is the **direct
cryptographic commitment** that I2 will use as an execution gate. This matters
because the existing `authorizationId` hashes intent/audit/agent/recipient/
amount/rail/policy/timestamps and does **not** directly commit the fields that
matter to a payment (network, asset address, `payTo`, amount scale, nonce) —
per the T05 residual note in the threat model. The `PaymentRequirement` digest
binding must therefore be **direct**, not transitive: the future adapter
verifies the digest of the requirement it will sign against the digest
committed in the authorization evidence, and the digest participates in the
execution gate.

# Current Non-Execution Boundary

State explicitly:

> I1 validates and fingerprints payment requirements. I1 does NOT verify that a
> requirement is authorized for execution. I1 does NOT sign. I1 does NOT call
> Gateway. I1 does NOT settle. I1 does NOT move funds.

Guard remains keyless: no wallet, no private keys, no network calls, no expiry
enforcement, no duplicate-settlement protection, no execution store.

I1 is a pure contract + evidence layer inside the existing keyless boundary.

# What I1 Does Not Implement

I1 is only the first step of the integration track. It does not implement:

- **I2 — Execution Security Gate** (runtime expiry, exact
  recipient/amount/asset/network binding, ALLOW/mismatch/drift checks, network
  allowlist).
- **I3 — Durable Execution Idempotency** (authorization consumption state,
  duplicate-settlement rejection, durable testnet execution record, nonce
  registry).
- **I4 — External Signer Adapter** (EIP-3009 signing outside Guard core).
- **I5 — Settlement Evidence** (capture of real official settlement result).
- **I6 — Positive + Negative Proof** (testnet payment + negative acceptance
  criteria A–L).

Additionally, I1 adds:

- **No API routes.**
- **No SDKs or new dependencies** (the repo keeps `next`/`react`/`react-dom`
  only).
- **No policy changes were made in I1** — `policyVersion` stayed `"2"` at the
  time; the policy config and its fingerprint were unchanged (a network
  allowlist / fee-bound policy change is I2 scope; I2 bumps `policyVersion`
  to `"3"`).
- **No `PaymentIntent` changes.**
- **No `ExecutionAuthorization` changes** (v1 envelope and id unchanged).
- **No Phase 9** — payment execution remains deferred.

# Next Security Gate

**I2 — Execution Security Gate** will enforce exact binding before any signer
can be considered:

- **runtime expiry** (reject `now >= expiresAt` before any signing request);
- **exact recipient / amount / asset / network binding** via the requirement
  digest;
- **ALLOW / mismatch / drift checks** (reuse the existing
  `replayMismatch === false && policyChanged === false` gate);
- **network allowlist** (`eip155:5042002` for the bounded slice).

Only after I2 is implemented and tested may any signer be considered for the
bounded testnet path.

Last updated: 2026-08-16
