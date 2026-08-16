# Purpose

I4 is the fourth step of the approved pre-Phase-9 integration track (decision
record `integration-feasibility.md`, **GO WITH BLOCKERS**), following I1 (the
x402 payment-requirement contract + deterministic requirement digest), I2 (the
pure, fail-closed execution security gate producing the v2 authorization and
ELIGIBLE-for-signer-request status), and I3 (the durable execution state store
that turns an ELIGIBLE v2 authorization into a prepared execution claim with a
bound deterministic EIP-3009 nonce).

I4 creates a **real cryptographic EIP-3009 signature locally** via a bounded
external EOA signer boundary for the I3 prepared execution record, verifies it
cryptographically, builds a transient x402 `PaymentPayload`, and commits its
digest via the I3 `prepared → submitted` transition.

State explicitly:

> I4 creates a real cryptographic EIP-3009 signature locally.
> I4 does NOT submit that signature anywhere.
> I4 does NOT prove payment.
> I4 does NOT move funds.

I4 produces a locally generated, cryptographically verified EIP-3009
authorization signature and the derived signed `PaymentPayload` digest. It is
an **offline, non-network** slice: the signature is never submitted to Gateway
or any RPC endpoint, no payment is proved, and no funds move. Real Gateway
submission remains a later step (I5).

# Trust Boundary

The signing key lives **only** in the external signer process/tool
(`scripts/x402-external-signer.mjs`). It is **never** present in `src/`, the
Next.js runtime, the policy engine, the execution store, or the
audit/observation logs.

- **Signer secret source:** `AGENTPAY_X402_SIGNER_PRIVATE_KEY` env var, read
  **only by the signer process/tool**. It is deliberately **NOT** declared in
  the application `.env.example` — the application never needs it and never
  reads it.
- **Guard core keyless:** Guard core knows only the `X402ExternalSigner`
  interface (`sign(request) → response`). Guard core has **no** private key,
  mnemonic, key-file, or wallet-provider knowledge.
- The external signer is a separate process boundary (offline reference
  signer) that holds the key and returns only a signed response; the key never
  crosses back into the Guard/runtime boundary.

# Signing Request

I4 builds a strict, non-secret `X402Eip3009SigningRequest` that binds:

- `authorizationId`
- `parentAuthorizationId`
- `auditId`
- `paymentRequirementDigest`
- `network`
- `chainId`
- `assetAddress`
- `payTo`
- `amountAtomic`
- `payerAddress`
- `nonce`
- plus the EIP-712 block (domain and typed-data authorization message).

The request is built **only** from prepared-record evidence + the trusted payer
+ an explicit `now`. It contains **no secret material** — it is safe to pass to
the external signer.

The `signingRequestDigest` is:

```
sha256:<64 hex>
```

computed over the **complete normalized request** (not including itself). The
digest changes for any change to payer / payTo / amount / nonce / network /
asset / domain / validity / authorizationId / requirementDigest. It is the
integrity commitment that lets the signer and the Guard both confirm they are
operating on the identical request.

# EIP-3009 Typed Data

The exact EIP-712 shape that the external signer signs follows the official
Gateway nanopayments EIP-3009 `TransferWithAuthorization` facts. The
implementation re-verified these against the official `@circle-fin/x402-batching`
SDK v3.3.0 (the SDK the official Circle nanopayments quickstarts install,
`authorizationTypes` and `BatchEvmScheme.signAuthorization`), and the following
are the confirmed, implemented facts:

- **Primary type:** `TransferWithAuthorization` over
  `{ from, to, value, validAfter, validBefore, nonce }` (SDK
  `authorizationTypes`; field order is significant for EIP-712 hashing and is
  preserved exactly).
- **EIP-712 domain:** `{ name: "GatewayWalletBatched", version: "1", chainId,
  verifyingContract }` — **the domain DOES include `chainId`** (parsed from
  the CAIP-2 network, e.g. `5042002` for Arc Testnet). This chainId-in-domain
  fact is an **addition** to the pinned feasibility record (S17 documented
  name/version/verifyingContract only); it was re-verified from the official
  SDK source and is implemented. `verifyingContract` = the Gateway Wallet
  contract on the target chain (Arc Testnet GatewayWallet
  `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, S21/S25).
- **Authorization message fields:** `{ from, to, value, validAfter,
  validBefore, nonce }` (S12). `from` = payer EOA address, `to` = payTo
  recipient, `value` = amountAtomic, `validAfter`/`validBefore` = the validity
  window, `nonce` = the 32-byte nonce bound by I3.
- **Validity window:** `validAfter` = `now − 600 s` (SDK backdates 10 minutes
  so the authorization is immediately usable);
  `validBefore = now + max(maxTimeoutSeconds, 604900)` where
  `604900 = 7 days (604800) + 100 s buffer` (SDK
  `GATEWAY_MIN_AUTH_VALIDITY_SECONDS` + `GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS`).
  Circle's seller quickstart: payment signatures must have at least 7 days plus
  a small buffer of validity, or Gateway will reject them.
- **Signature encoding:** 65-byte `0x` hex (viem `signTypedData` output).
- **EOA-only restriction:** verification uses `ecrecover`; **ERC-1271
  smart-account signatures are not supported** for Gateway nanopayments /
  x402 (S16, S18 — "Nanopayments and x402 batch settlement require EOA
  signatures and do not support ERC-1271").

The EIP-712 domain/validity facts above are now **confirmed from the
implementation** (module header notes in
`src/domain/x402/eip3009-signing-request.ts` re-verified against the official
SDK on 2026-08-16), not merely provisional feasibility-record values.

# Trusted Payer Binding

The payer address is bound via `X402PayerBinding { payerAddress }` taken from
**trusted operator / test-harness configuration** — never solely from the
untrusted raw 402 requirement and never from the signer response. The signer
must derive an account whose address equals `request.payerAddress`; the Guard
checks that the recovered signer address semantically equals
`payerBinding.payerAddress`. The self-asserted `agentId` residual (ADD-1 in the
threat model) remains documented and is not fixed by I4.

# External Signer Interface

Guard core depends only on a narrow interface (defined in
`src/domain/x402/external-signer.ts`):

```ts
interface X402ExternalSigner {
  sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse>;
}
```

The response is strictly bounded to:

```ts
{
  responseType: "x402_eip3009_signature",  // literal
  version: "v1",                            // literal
  signingRequestDigest,                     // must equal the request's signingRequestDigest
  payerAddress,                             // the signer's derived address
  signature                                 // 65-byte EIP-3009 signature as 0x hex
}
```

The response **cannot redefine payment fields** — it carries no
paymentRequirement, no amount, no payTo, no network, no nonce, no
authorizationId (those live in the request and in the Guard's own state). The
signer contributes **signature only**; every payment field remains under the
Guard's validated, prepared-record evidence.

# Offline Reference Signer

`scripts/x402-external-signer.mjs` is the offline reference signer (never
imported by `src/` — a separate process):

- **stdin** = one JSON envelope `{ signingRequestDigest, request }`; **stdout**
  = one JSON response `{ responseType, version, signingRequestDigest,
  payerAddress, signature }`; a JSON error object is written to **stderr** on
  failure.
- The key is read from its **own** environment
  (`AGENTPAY_X402_SIGNER_PRIVATE_KEY`), never from the request or the repo.
- It **strictly validates the request** before signing.
- It **derives the account** from the key.
- It **verifies the derived address equals `request.payerAddress`** — a
  mismatch is rejected, never signed.
- It **signs exactly the supplied typed data** (the EIP-712 block in the
  request) and **echoes the Guard-built `signingRequestDigest`**.
- It makes **no network calls at all** — no RPC, no Gateway, no faucet, no
  broadcast.
- It **never prints or writes the key**.

# Signature Verification

Guard-side, before any transition, I4 performs strict verification inside the
orchestrator `signPreparedX402Execution` (in
`src/domain/x402/sign-prepared-x402-execution.ts`, the only caller of the
external signer). The orchestration fails closed at **every** step, in this
fixed order: read the I3 record → re-validate the requirement and recompute the
I1 digest → binding integrity (network / asset / payTo / amount + nonce) →
payer EVM validity → Guard expiry recheck (no signer call on failure) → build +
round-trip-validate the signing request → `signer.sign(request)` → response
digest + payer checks → viem `recoverTypedDataAddress` over the **exact locally
constructed typed data** → build the signed payload → `signerPayloadDigest`
(includes the signature) → `markX402ExecutionSubmitted({ nonce, signerPayloadDigest,
occurredAt })` — applied OR exact safe replay of the same digest →
`X402_SIGNER_READY` with the transient payload; any other outcome → fail closed.

The full stable reason-code contract (`src/domain/x402/sign-prepared-x402-execution.ts`):

```
X402_SIGNER_READY
X402_SIGNER_EXECUTION_NOT_FOUND
X402_SIGNER_EXECUTION_NOT_PREPARED
X402_SIGNER_AUTHORIZATION_EXPIRED
X402_SIGNER_AUTHORIZATION_TIMESTAMP_MALFORMED
X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH
X402_SIGNER_PREPARED_BINDING_MISMATCH
X402_SIGNER_PAYER_ADDRESS_INVALID
X402_SIGNER_REQUEST_BUILD_FAILED
X402_SIGNER_EXTERNAL_FAILURE
X402_SIGNER_RESPONSE_INVALID
X402_SIGNER_REQUEST_DIGEST_MISMATCH
X402_SIGNER_PAYER_MISMATCH
X402_SIGNER_SIGNATURE_INVALID
X402_SIGNER_STATE_CONFLICT
```

Sign-stage failures persist via the I3 primitive as `markX402ExecutionFailed`
(`failureStage "sign"`, stable code) — never `Error.stack`, keys, signatures, or
raw payloads. The verification steps are:

- **Strict response-shape validation** — `validateX402ExternalSignerResponse`
  rejects any unknown field, wrong `responseType`/`version` literal, or
  malformed digest/address/signature format.
- **`signingRequestDigest` equality** — the response's digest must equal the
  locally computed `signingRequestDigest(request)`.
- **Signature encoding** — the signature must be a well-formed 65-byte `0x` +
  130-hex EIP-3009 encoding.
- **Cryptographic verification** — the Guard recovers the signer from the
  **exact locally constructed typed data** via viem
  `recoverTypedDataAddress` (domain/types/message exactly as the Guard built
  them — NOT as the signer described them; the signer contributes the
  signature only).
- **Payer match** — the recovered address semantically equals
  `payerBinding.payerAddress` (case-insensitive EVM equality).
- **Wrong signer / tampered fields are rejected** with a stable reason code.
- The signer contributes the signature **only**; it cannot redefine any payment
  field (the response shape `X402ExternalSignerResponse` carries only
  `responseType`/`version`/`signingRequestDigest`/`payerAddress`/`signature`).

# Signed PaymentPayload

I4 builds a transient x402 v2 `PaymentPayload` per the verified official shape
(`X402SignedPaymentPayload`, from the official x402 spec v2 §5.2 and the
Circle Gateway OpenAPI `PaymentPayload` schema consumed by `/v1/x402/settle`):

```ts
{
  x402Version: 2,
  accepted: X402PaymentRequirement,   // echoes the exact validated requirement
  payload: {
    signature,                        // 65-byte 0x hex EIP-712 signature
    authorization: {                  // mirrors the signed EIP-3009 authorization
      from, to, value, validAfter, validBefore, nonce
    }
  }
}
```

The payload contains the transient signature but **never** a private key,
mnemonic, or seed. It is transient — it exists to compute the digest and is
not persisted (see Crash / Recovery Residual).

# signerPayloadDigest

```
sha256:<64 hex>
```

computed over the **complete canonical signed payload** (including the
signature). Any changed signature or changed field → a different digest. This
digest is what I3 persists on the `submitted` transition — the digest is
committed, never the signature or the payload itself.

# I3 Submitted Transition

After verification succeeds, I4 invokes the I3 store transition:

```
markX402ExecutionSubmitted({
  nonce: prepared.nonce,
  signerPayloadDigest,
  occurredAt: now
})
```

The state name `"submitted"` means the **signed payload commitment entered the
execution lifecycle** — it does **NOT** prove Circle Gateway accepted anything.
Actual Gateway submission begins only in **I5**.

# Secret Handling

- No private key in `src/`, `.env.example`, or the repository.
- **Ephemeral test keys only** — generated at test runtime, passed via
  child-process env, never persisted or printed.
- The execution store never receives the signature, the raw payload, or the
  private key — it receives only the `signerPayloadDigest`.

# Expiry Boundary

- The Guard **authorization expiry is rechecked** (`now <
  prepared.authorizationExpiresAt` strictly) **immediately before the signer
  call**. At/after expiry, or a malformed expiry, → **no signer call**.
- **Guard expiry and EIP-3009 `validBefore` are SEPARATE controls.** A long
  Gateway signature validity window must **NOT** extend the Guard
  authorization window.
- **Mandatory future I5 invariant:** recheck `now <
  prepared.authorizationExpiresAt` immediately before any Gateway `/settle`
  request.

# Crash / Recovery Residual

- **Crash before signing** → the prepared record stays consumed (terminal for
  that lineage; a retry requires a fresh Guard authorization lineage).
- **Crash after signing but before durable `submitted`** → a fresh Guard
  authorization may be required depending on the recovery path.
- **Crash after durable `submitted` but before I5 receives the transient
  payload** → the raw signature is intentionally **NOT** stored (a liveness
  residual, not a duplicate-payment safety failure).
- I4 does **not** add encrypted-secret storage.
- This residual is recorded for the I5/I6 orchestration design.

# Current Non-Network Boundary

State explicitly:

> I4 performs zero network calls — no Gateway, no RPC, no HTTP payment
> requests, no balance queries, no faucet, no transaction broadcast.

URLs appear in docs/comments only; nothing in I4 opens a connection.

# Remaining Preconditions

Still **NOT COMPLETE** after I4:

- real Gateway submission;
- Gateway nonce enforcement in a real call;
- SettlementEvidence;
- executed-spend reconciliation;
- production authenticated agent identity;
- pre-broadcast security re-review;
- full testnet positive proof.

# Next Step

**PRE-I5 threat-model re-review** before any Gateway network submission (and
then **I5 — Gateway Submission + Settlement Evidence**).

Last updated: 2026-08-16
