# Purpose

I3 is the durable, restart-safe, filesystem-backed execution state store. It
turns an ELIGIBLE v2 authorization into a durable single-use execution claim: a
prepared execution record plus a bound EIP-3009 nonce, written durably, then
STOP. I3 still has no signer and no payment.

I3 is the third step of the approved pre-Phase-9 integration track (decision
record `integration-feasibility.md`, **GO WITH BLOCKERS**), following I1 (the
x402 payment-requirement contract + deterministic requirement digest) and I2
(the pure, fail-closed execution security gate that produces the v2
authorization). It sits between I2 and any future external signer adapter (I4).

I3 is a local, keyless, non-executing persistence layer: no signer, no Gateway
call, no network, no funds movement. It exists so that a single-use execution
claim and its bound nonce survive a process restart and are exclusively owned
across processes sharing the same filesystem.

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
  end-to-end: the same nonce is what a future external signer (I4) signs and
  what Gateway enforces at settle time.
- The nonce registry (`nonces/0x<64hex>.json`) claims nonces with **exclusive
  creation**. On a claim collision:
  - a claim for the **same authorization** is treated as **recovery** (the
    existing claim is authoritative, not an error);
  - a claim for a **different authorization** returns
    `X402_EXECUTION_NONCE_CONFLICT`.

# State Machine

States: `prepared | submitted | confirmed | failed`.

Allowed transitions:

```
NO RECORD -> prepared
prepared   -> submitted
prepared   -> failed
submitted  -> confirmed
submitted  -> failed
```

Forbidden transitions (rejected deterministically):

```
prepared   -> confirmed
confirmed  -> anything   (terminal)
failed     -> anything   (terminal)
submitted  -> submitted
prepared   -> prepared
```

- `confirmed` and `failed` are **terminal** — no transition out of either.
- No sequence skipping is allowed (e.g. `NO RECORD -> submitted` is rejected).
- The `submitted` / `confirmed` transitions are **storage primitives for
  I4/I5**, not claims that real submission or real confirmation happened. They
  persist a state label only; real evidence arrives with I4/I5.

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

The **submitted** event stores only `nonce` + `signerPayloadDigest` (the bound
nonce is echoed; the digest is committed, never the signature or payload).

The **confirmed** event stores only `settlementEvidenceDigest` (a future I5
evidence reference, not the evidence itself).

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
- Gateway transfer ID
- fake settlement status

These are deliberately outside the store's contract. Nothing in I3 introduces a
key, a signature, or a fabricated settlement result.

# Current Non-Execution Boundary

State explicitly:

> I3 does not sign. I3 does not contact Gateway. I3 does not submit. I3 does
> not confirm a real payment.

I3's `submitted` / `confirmed` transitions are **persistence capabilities
only** until I4/I5 invoke them with real evidence. Until then they are state
labels in a durable store, not claims that a submission or a settlement
occurred.

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
- **Gateway nonce-enforcement proof is pending I4/I6** — the deterministic
  nonce registry is local; proof that Gateway actually enforces the bound nonce
  at settle time requires the signer and a live submission.

# Next Step

**I4 — External Signer Adapter.**

Last updated: 2026-08-16
