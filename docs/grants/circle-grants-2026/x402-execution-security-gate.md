# Purpose

I2 is the pure, fail-closed execution security gate deciding whether an
already-issued Guard ExecutionAuthorization v1 may become **ELIGIBLE FOR A
FUTURE EXTERNAL SIGNER REQUEST** for one exact x402 PaymentRequirement. It is a
local pure security boundary: still **no signer, no nonce, no settlement**.

I2 sits between I1 (the x402 payment-requirement contract + deterministic
requirement digest) and any future external signer adapter (I4). It takes an
issued v1 authorization plus replay/policy evidence and a candidate
`PaymentRequirement`, and either marks the authorization eligible for a future
external signer request or rejects it with a deterministic reason code.

# Inputs

I2 is a pure function over an explicit typed input object:

```ts
{
  authorization: ExecutionAuthorization,   // v1, already issued by Guard
  replayEvidence: ReplayEvidence,
  paymentRequirement: X402PaymentRequirement,
  paymentRequirementEvidence: PaymentRequirementEvidence,
  recipientBinding: X402RecipientBinding,
  policy: PolicyConfig,
  now: Date                               // explicit; never Date.now() inside the gate
}
```

Confirmed module surface (implementation):
`evaluateX402ExecutionGate(input: X402ExecutionGateInput): X402ExecutionGateResult`
in `src/domain/x402/execution-security-gate.ts`, with types
`X402ExecutionGateInput`, `X402ExecutionGateResult`, `X402RecipientBinding { recipient, payTo }`
(discriminated union: `eligibleForSignerRequest: true` with `reasonCodes:
["X402_EXECUTION_GATE_ALLOWED"]` and the v2 `authorization`, or
`eligibleForSignerRequest: false` with `reasonCodes`, `authorization: null`,
`executionStatus: "not_executed"`, `fundsMoved: false`). The allowlist entry
type is `X402ExecutionPolicyEntry` in `src/domain/policy/policy-config.ts`.

- `now` is **explicit** — the gate never calls `Date.now()` internally. Callers
  inject the evaluation time, so the gate is deterministic and testable.
- The gate consumes only the validated, typed objects above — never raw
  request fields.
- The gate is **pure and fail-closed**: any missing, stale, mismatched, or
  unknown state rejects with a stable reason code; it never returns ALLOW on
  ambiguous input.

# Policy Version 3

- `policyVersion` moves from `"2"` to `"3"`.
- The ordinary `ALLOW` / `REVIEW` / `BLOCK` rule semantics are **unchanged**;
  only the policy identity/fingerprint and the x402 execution eligibility
  surface differ.
- The policy fingerprint recomputes over the new `policyVersion` and the new
  `x402Execution` allowlist section, so the fingerprint changes with the
  version.
- **Stored version-2 audit records remain historical.** They surface
  `policyChanged = true` under the current policy (their persisted
  `policyVersion`/`policyFingerprint` no longer match the current policy), and
  they are never rewritten or migrated.

# Arc Testnet Allowlist

`policy.x402Execution.allowedRequirements` — the enforcement allowlist for the
bounded slice. The gate requires the candidate `PaymentRequirement` to match
**exactly**:

| Field | Allowed value |
| --- | --- |
| `network` | `eip155:5042002` (Arc Testnet, chain id 5042002) |
| `scheme` | `exact` |
| `asset` | `0x3600000000000000000000000000000000000000` (Arc Testnet USDC ERC-20 interface, 6 decimals) |
| `maxTimeoutSeconds` | `604900` (official Gateway nanopayments value) |
| `extra.name` | `GatewayWalletBatched` |
| `extra.version` | `1` |
| `extra.verifyingContract` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` (Arc Testnet GatewayWallet) |
| `extra.assetTransferMethod` | `eip3009` |
| `extra.paymentFlow` | `authorization` |

- **Arc Testnet only.** No mainnet, no other testnets.
- **I1 validates syntax; I2 enforces the allowlist.** For example,
  `eip155:84532` is syntactically valid CAIP-2 (Base Sepolia) and passes I1
  syntax validation, but the I2 gate rejects it as not allowed.

# Recipient Binding

- The gate consumes a **trusted** `X402RecipientBinding { recipient, payTo }`
  from adapter/operator configuration — **never** the untrusted raw 402
  request.
- There is **no real seller address in the global policy yet**. The binding is
  configuration/operator-supplied; a future operator must configure it for a
  real seller before any external signer request.

# Amount Binding

- Exact **decimal → atomic** conversion using `assetDecimals` 6 (Arc Testnet
  USDC ERC-20 interface).
- **No floating point, no rounding.**
- A candidate amount with **more than 6 meaningful decimals is not
  representable** at 6-decimal atomic resolution → reject.
- The resulting atomic amount must equal the requirement's `amount` exactly
  (amount mismatch → reject).

# Requirement Digest Binding

- The gate **recomputes** `fingerprintX402PaymentRequirement(paymentRequirement)`
  and requires equality with `paymentRequirementEvidence.requirementDigest`.
- A **stale or mismatched** evidence digest rejects — the direct cryptographic
  commitment must match the candidate requirement exactly.
- This is the direct (not transitive) commitment that I1's contract record
  called for: the gate binds the exact requirement the future adapter would
  sign.

# Runtime Expiry

- The gate enforces **runtime** expiry: `now < expiresAt` strictly.
- `now === expiresAt` **rejects** (expiry is inclusive-fail).
- An **unparseable** `expiresAt` **fails closed** (reject).
- This is the **Guard TTL control**, DIFFERENT from the EIP-3009 `validBefore`
  signature-validity window. Guard TTL is 300 s; Gateway requires ≥ 7-day
  signature validity (S17). They are two distinct expiry controls.

# Replay and Policy-Drift Gates

- `replayMismatch === false` **and** `policyChanged === false` are **required**
  (`true` or `null` on either side rejects).
- `replayed` may be `true` **or** `false` — either is acceptable; replay is
  idempotent reuse, not a rejection condition.
- Plus a **current-attribution check**: the authorization's
  `policyVersion`/`policyFingerprint` must match the current policy
  (`authorization.policyVersion` / `authorization.policyFingerprint` vs the
  current loaded policy).

# X402 ExecutionAuthorization v2

- A **separate deterministic artifact**, `version: "v2"`.
- `parentAuthorizationId` = the v1 authorization's `authorizationId`.
- Direct `paymentRequirementDigest` commitment.
- Deterministic `auth_<64 hex>` id committing: parent id, digest, auditId,
  recipient, payTo, network, asset, amountAtomic, policyVersion,
  policyFingerprint, expiresAt.
- **NO** nonce / signature / transaction / settlement fields.
- `executionStatus: "not_executed"`, `fundsMoved: false`,
  `eligibility: "eligible_for_external_signer_request"`.
- `issuedAt` / `expiresAt` copied from the parent v1 authorization.
- The **v1 implementation is unchanged** — v2 is additive, separate.

# Rejection Reason Codes

Rejection codes are the **deterministic security contract** of the gate — not
free-form strings. The stable rejection codes (fixed, documented evaluation
order):

```
X402_GATE_AUTHORIZATION_DECISION_NOT_ALLOWED  (authorization.decision !== "ALLOW")
X402_GATE_REPLAY_MISMATCH                     (replayEvidence.replayMismatch === true)
X402_GATE_REPLAY_STATE_UNKNOWN                (replayEvidence.replayMismatch === null)
X402_GATE_POLICY_CHANGED                      (replayEvidence.policyChanged === true)
X402_GATE_POLICY_STATE_UNKNOWN                (replayEvidence.policyChanged === null)
X402_GATE_POLICY_ATTRIBUTION_MISMATCH         (authorization policyVersion/fingerprint != current policy)
X402_GATE_AUTHORIZATION_EXPIRED               (now >= expiresAt, or invalid `now`; fail closed)
X402_GATE_AUTHORIZATION_TIMESTAMP_MALFORMED   (expiresAt unparseable; fail closed)
X402_GATE_REQUIREMENT_DIGEST_MISMATCH         (recomputed digest != evidence digest)
X402_GATE_NETWORK_NOT_ALLOWED                 (no allowlist entry for network+scheme)
X402_GATE_ASSET_NOT_ALLOWED                   (asset != matched entry asset; entry-dependent)
X402_GATE_EIP712_DOMAIN_NOT_ALLOWED           (effective EIP-712 domain/transfer method/flow != entry; entry-dependent)
X402_GATE_TIMEOUT_EXCEEDED                    (maxTimeoutSeconds > entry bound; entry-dependent)
X402_GATE_RECIPIENT_BINDING_MISMATCH          (recipientBinding.recipient != authorization.recipient)
X402_GATE_PAYTO_MISMATCH                      (requirement.payTo != trusted recipientBinding.payTo)
X402_GATE_AMOUNT_NOT_REPRESENTABLE            (maxAmountUSDC not representable at entry decimals; entry-dependent)
X402_GATE_AMOUNT_MISMATCH                     (converted amount != requirement.amount; entry-dependent)
```

`X402_EXECUTION_GATE_ALLOWED` (constant
`X402_EXECUTION_GATE_ALLOWED_REASON_CODE`) is the single success code
(eligible for a future external signer request); every other code is a
rejection with a precise, stable meaning. All applicable rejection codes are
collected in the fixed order above and deduplicated per check. Entry-dependent
checks (asset/domain/timeout/amount) run only when a network allowlist entry
matched. The effective `assetTransferMethod`/`paymentFlow` default to
`eip3009`/`authorization` on omission (the requirement is never mutated);
address comparisons are case-insensitive. Callers match on these codes — they
are part of the security contract and must not change.

# Current Non-Execution Boundary

State explicitly:

> I2 can produce eligibility for a FUTURE external signer request. I2 does not
> call a signer. I2 does not create a signature. I2 does not generate a nonce.
> I2 does not call Gateway. I2 does not settle. I2 does not move funds.

I2 is a local pure gate inside the existing keyless boundary. Nothing in I2
touches a network, a wallet, a private key, or a transaction.

# Remaining Preconditions

Still unchecked after I2:

- duplicate execution;
- durable cross-process execution idempotency;
- executed-spend reconciliation;
- external signer/key management proof;
- durable settlement outcome evidence;
- final pre-broadcast threat-model re-review.

I2 implements **local code** for: runtime expiry gate, direct requirement
binding, Arc Testnet allowlist, and the amount/recipient/asset/domain gate.
**End-to-end enforcement is pending I5/I6** — I2 proves the gate locally; the
external signer (I4) is now **implemented** (offline EIP-3009 signing in the
external signer tool, cryptographic payer recovery via viem
`recoverTypedDataAddress`); the positive+negative proof (I6) and the I5
Gateway submission path are not yet implemented.

# Next Step

**I3 — Durable Execution Idempotency.**

Last updated: 2026-08-16

PRE-I5 note (2026-08-17): the PRE-I5 security re-review is complete (decision
GO WITH BLOCKERS) and the I5 design is frozen — see
[pre-i5-security-review.md](./pre-i5-security-review.md). The gate remains a
local pure gate; I5 adds the pre-settle expiry recheck (I5.3) and the
Gateway submission path. I5/I6 NOT implemented.
