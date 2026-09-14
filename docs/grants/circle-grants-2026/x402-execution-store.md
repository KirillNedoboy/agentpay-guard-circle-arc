# Purpose

I3 is the durable, restart-safe, filesystem-backed execution state store. It
turns an ELIGIBLE v2 authorization into a durable single-use execution claim: a
prepared execution record plus a bound EIP-3009 nonce, written durably, then
STOP. The store itself signs nothing and settles nothing; I4/I5 drive it.

I3 is the third step of the approved pre-Phase-9 integration track (decision
record `integration-feasibility.md`, **GO WITH BLOCKERS**), following I1 (the
x402 payment-requirement contract + deterministic requirement digest) and I2
(the pure, fail-closed execution security gate that produces the v2
authorization). It sits between I2 and the external signer adapter (I4, now
implemented); the I5 Gateway settlement layer is its remote-outcome consumer.
I3 is a local, keyless, non-executing persistence layer: the store itself has
no signer, makes no Gateway call, and has moved no funds. It exists so that a
single-use execution claim and its bound nonce survive a process restart and
are exclusively owned across processes sharing the same filesystem.

# Store Layout

The store is rooted at a directory returned by `executionStorePath()`
(`src/lib/paths.ts`) — `AGENTPAY_EXECUTION_STORE_PATH` env override, defaulting
beside the active audit log:

```
<store>/
  authorizations/
    auth_<64 lowercase hex>/
      NNNN.json        # immutable numbered state events, strictly ascending
  nonces/
    0x<64 lowercase hex>.json   # durable nonce claims, one file per nonce
```

- `executionStorePath()` = `AGENTPAY_EXECUTION_STORE_PATH` if set, else
  `join(dirname(auditLogPath()), "execution-store")` (beside the active audit
  log). This mirrors how `observationLogPath()` derives from `auditLogPath()`.
- The default execution-store location is gitignored.
- Authorization IDs are validated as `auth_<64 lowercase hex>` **before** any
  path is constructed from them, so an untrusted or malformed id cannot escape
  the store directory (no path traversal, no arbitrary filename).
- Per-authorization event files are numbered `NNNN.json` (zero-padded,
  strictly ascending); the highest existing number is the latest state.
- Nonce files live flat under `nonces/` keyed by the bound EIP-3009 nonce
  (`0x<64 lowercase hex>`).

# Single-Use Authorization Consumption

- The **first prepared event permanently consumes the v2 authorization.** Once
  an authorization has a durable `prepared` record, no second execution claim
  for that authorization may be created.
- A duplicate `prepare` for an already-consumed authorization returns
  `X402_EXECUTION_ALREADY_CONSUMED`: **no second event, no second nonce, no
  second signer-eligible result.**
- Consumption is **true across process restarts** — it is derived from the
  persisted immutable event history, not from module-level memory.
- A retry after a terminal failure requires a **fresh Guard authorization
  lineage** (a new v1 parent → new v2 → new execution claim). It never reuses
  the consumed execution authorization.
- I1/I2 evaluation replay consistency (the same `idempotencyKey` yields the
  same decision/authorization) does **NOT** mean execution may happen twice.
  Evaluation is idempotent; execution is single-use.

# EIP-3009 Nonce Binding

- Each consumed v2 authorization is bound to a **deterministic EIP-3009
  nonce**:

  ```
  0x + SHA-256(stable JSON of {
    purpose: "agentpay_eip3009_nonce_v1",
    authorizationId,
    paymentRequirementDigest
  })
  ```

- The nonce is `0x<64 lowercase hex>` — exactly 32 bytes.
- **Same v2 → same nonce; different v2 → different nonce.** The nonce is a pure
  deterministic function of the authorization id and its requirement digest.
- This gives a **one-to-one authorizationId ↔ nonce** mapping that is auditable
  end-to-end: the same nonce is what the external signer (I4) signs and what
  a future live Gateway settlement (I6) will exercise at settle time.
- The nonce registry (`nonces/0x<64hex>.json`) claims nonces with **exclusive
  creation**. On a claim collision:
  - a claim for the **same authorization** is treated as **recovery** (the
    existing claim is authoritative, not an error);
  - a claim for a **different authorization** returns
    `X402_EXECUTION_NONCE_CONFLICT`.

# State Machine

States: `prepared | submitted | remote_outcome_unknown | confirmed | failed`
(`remote_outcome_unknown` added in I5).

Allowed transitions:

```
NO RECORD -> prepared
prepared   -> submitted
prepared   -> failed
submitted  -> confirmed
submitted  -> failed
submitted  -> remote_outcome_unknown
remote_outcome_unknown -> confirmed
remote_outcome_unknown -> failed
```

Forbidden transitions (rejected deterministically):

```
prepared   -> confirmed
confirmed  -> anything   (terminal)
failed     -> anything   (terminal)
remote_outcome_unknown -> submitted  (NEVER exists: recovery reconciles by
                                       nonce and never re-signs)
submitted  -> submitted
prepared   -> prepared
```

- `confirmed` and `failed` are **terminal** — no transition out of either.
- No sequence skipping is allowed (e.g. `NO RECORD -> submitted` is rejected).
- `submitted → remote_outcome_unknown` is idempotent ONLY for the exact same
  `(nonce, reasonCode, gatewayTransferId)` triple (an identical repeat is
  REPLAYED; anything else is a state conflict).
- `remote_outcome_unknown` records an AMBIGUOUS remote outcome (transport
  timeout/reset, 5xx, malformed response, crash after send) — it is at-risk
  accounting, NOT `failed`: the funds may or may not have been accepted
  remotely. Exit is ONLY via reconciliation to `confirmed`/`failed`.
- `confirmed` requires a `settlementEvidenceDigest` — the I5 SettlementEvidence
  reference persisted BEFORE the transition.
- The `submitted` / `confirmed` transitions began as **storage primitives for
  I4/I5**; since I5 they are actually driven: I4 commits the `submitted`
  digest, and the I5 settlement orchestration
  (`src/domain/x402/gateway-settlement.ts`) is the only code path that
  produces `confirmed` / `failed` / `remote_outcome_unknown` from a real
  (or ambiguous) remote outcome. `submitted` still does NOT mean Gateway
  accepted anything; `confirmed` means official `confirmed`/`completed` was
  observed and evidenced durably.

# Cross-Process Exclusivity

- Exclusive creation of the next numbered event and of each nonce claim uses
  `fs.open(path, "wx")` (O_CREAT | O_EXCL): **first process wins**.
- The loser re-reads the current state and returns a **deterministic conflict
  result** (`X402_EXECUTION_ALREADY_CONSUMED` for an existing prepared event;
  `X402_EXECUTION_NONCE_CONFLICT` for a foreign nonce claim).
- Scope: this guards **multiple processes sharing the same filesystem**. It is
  NOT multi-host coordination and NOT distributed consensus.
- This is deliberately **NOT** the existing in-process promise-lock pattern
  used by the canonical audit log (T14). The canonical audit still uses the
  in-process lock; I3 gives the NEW execution-state store its own
  filesystem-exclusive guarantee.

# Restart Safety

- Execution state is **reconstructed from persisted immutable events** on
  startup; no module-level in-memory state is required to recover the current
  state of an authorization.
- This makes the application state **process-restart-safe** via
  filesystem-exclusive durable files.
- Boundaries (explicit): this is **not** database-grade distributed consensus,
  **not** WORM, and **not** cryptographically tamper-proof. It is durable
  single-process-and-shared-filesystem execution-state persistence.

# Corruption / Fail-Closed Behavior

- Every event and nonce claim is **strictly parsed**: `eventType`, `version`,
  `sequence`, `state`, `authorizationId`, state-specific fields, nonce/digest
  formats, and ISO timestamps are all validated.
- On any of the following the store **fails closed**:
  - sequence gaps or out-of-order event numbering;
  - an unknown or forbidden transition;
  - an invalid state, nonce, or digest format;
  - malformed JSON.
- There is **no automatic repair** and **no further writes after a corrupt
  history** — a corrupted authorization history freezes that authorization's
  execution path rather than risking a second execution.

# Stored Data

The **prepared** event commits:

- `parentAuthorizationId`
- `auditId`
- `idempotencyKey`
- `agentId`
- `recipient`
- `paymentRequirementDigest`
- `network`
- `assetAddress`
- `payTo`
- `amountAtomic`
- `policyVersion`
- `policyFingerprint`
- `authorizationExpiresAt`
- `nonce`

The **submitted** event stores `nonce` + `signerPayloadDigest` plus the four
**non-secret recovery fields** added in I5: `payerAddress` (EVM address),
`signingRequestDigest` (`sha256:<64 hex>`), and the signed EIP-3009 validity
window `validAfter` / `validBefore` (decimal Unix-second strings). The bound
nonce is echoed; the digest is committed — never the signature or the payload.
The recovery fields exist so a crash-recovery path can reconcile an
uncertain remote outcome **by nonce** (identity filtering requires the durable
payer) WITHOUT re-signing: the signed validity window cannot be reconstructed
locally after a crash, so re-signing the same deterministic nonce with a
fresh `now` would produce a different payload bound to the same nonce —
forbidden.

**Legacy rule:** pre-I5 `submitted` records that omit ALL FOUR recovery
fields together still parse (the store never declares valid history corrupt
because of the upgrade) and are reported with
`recoveryMetadataComplete === false` — readable, but I5 refuses to settle or
reconcile them (`X402_GATEWAY_RECOVERY_METADATA_MISSING`). PARTIAL presence of
the four fields is CORRUPT: the store throws and fails closed (no auto-repair,
no rewrite, nothing fabricated).

The **remote_outcome_unknown** event carries ONLY `nonce`, a stable
`reasonCode` (validated against the shared `X402_GATEWAY_REASON_CODES` list —
free-form HTTP text is never security state), and an OPTIONAL
already-validated `gatewayTransferId` (non-null ONLY when a validated Gateway
response produced one). Never a signature, key, raw payload, or raw Gateway
body.

The **confirmed** event stores only `settlementEvidenceDigest` (the durable
I5 SettlementEvidence reference; the evidence object itself lives in the
separate evidence store).

The **failed** event stores `failureStage` (`"prepare" | "sign" | "submit" |
"settle"`) and `failureCode`.

# Data Not Stored

The execution store **never** stores:

- `privateKey`
- mnemonic / seed
- signature
- signed payload
- `PaymentPayload`
- transaction hash / `txHash`
- fake settlement status

These are deliberately outside the store's contract. Nothing in I3 introduces a
key, a signature, or a fabricated settlement result. The only exception I5
added is narrow and non-secret: the `remote_outcome_unknown` event may carry
an **already-validated Gateway transfer UUID** (`gatewayTransferId`,
non-null ONLY when a validated Gateway response produced one) — a reference
for reconciliation, never an on-chain tx hash, never raw response bodies, and
never a locally invented status.

# Current Non-Execution Boundary

State explicitly (the store module itself):

> The store does not sign. The store does not contact Gateway. The store does
> not submit. The store does not confirm a real payment.

History: as shipped in I3, the `submitted` / `confirmed` transitions were
**persistence capabilities only**. I4 now invokes `submitted` with a real
locally-signed payload digest, and I5 invokes `confirmed` / `failed` /
`remote_outcome_unknown` from interpreted remote outcomes — always backed by
durable SettlementEvidence written BEFORE the transition. The states are
still labels about what the LOCAL process committed; the actual settlement
proof lives in the evidence store and, ultimately, in Gateway's own data.
**No live settlement has occurred** — the first real payment is I6.

# Residual Risks

- **No power-loss guarantee** beyond portable `fsync` — a hard crash in the
  window between a write and its flush could lose the very latest event.
- **No cryptographic tamper-proofing** — the store is durable, not
  tamper-evident; a local attacker with write access could rewrite event
  files.
- **No multi-host coordination** — exclusivity covers processes sharing one
  filesystem only; two hosts on independent filesystems are not coordinated.
- **T14 canonical-audit cross-process concurrency remains unfixed** — I3 fixes
  only the NEW execution-state store; the canonical audit log still uses the
  in-process promise-lock pattern.
- **Gateway nonce-enforcement proof is pending I6** — the deterministic
  nonce registry, the single-use claim, and the reconcile-by-nonce path are
  local (and since I5 exercised against mock transports only); proof that
  Gateway actually enforces the bound nonce at settle time requires a live
  submission + a live nonce-reuse negative test.

# Next Step

I4 (external signer) and I5 (bounded Gateway settlement layer driving this
store) are implemented; see
[x402-external-signer.md](./x402-external-signer.md) and
[x402-gateway-settlement.md](./x402-gateway-settlement.md). **I6 — the
operator-authorized first live testnet payment** — is the next step.

Last updated: 2026-09-15
