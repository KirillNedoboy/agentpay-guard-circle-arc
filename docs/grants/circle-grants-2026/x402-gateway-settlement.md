# Purpose

I5 is the Gateway settlement layer: the code that turns a locally-signed x402
payment into a Circle Gateway testnet settlement attempt, interprets the remote
outcome strictly, persists it as durable `SettlementEvidence`, and only then
advances the I3 execution state machine. It also provides nonce-keyed
reconciliation, the read-only `ExecutedSpendSummary`, and the operator-gated
live entry point.

The design is frozen by
[`pre-i5-security-review.md`](pre-i5-security-review.md) (DECISION: GO WITH
BLOCKERS); this document describes what is actually implemented, file by file:

| Concern | Source |
| --- | --- |
| Settlement orchestration (`submit` / `reconcile` / `finish`) | `src/domain/x402/gateway-settlement.ts` |
| Execution state machine (I3, extended in I5) | `src/domain/x402/execution-store.ts` |
| Strict evidence contract | `src/domain/x402/settlement-evidence.ts` |
| Durable evidence store | `src/domain/x402/settlement-evidence-store.ts` |
| Executed-spend reconciliation | `src/domain/x402/executed-spend.ts` |
| Stable reason codes | `src/domain/x402/gateway-reason-codes.ts` |
| Gateway wire contract + typed validators | `src/integrations/circle-gateway/contracts.ts` |
| Host-pinned testnet transport | `src/integrations/circle-gateway/testnet-client.ts` |
| Operator live-transport gate | `src/domain/x402/gateway-live-transport.ts` |
| Operator entry point + runner | `scripts/x402-gateway-testnet.mjs`, `scripts/x402-gateway-testnet-runner.ts`, `scripts/x402-operator-loader.mjs` |
| Store paths | `src/lib/paths.ts` (`executionStorePath()`, `settlementEvidencePath()`) |

**State plainly: the I5 code is testnet-CAPABLE, and THE I5 TASK DID NOT
EXECUTE A REAL PAYMENT.** All settlement behavior is verified against injected
mock transports (MOCK-VERIFIED). The first real payment is I6
(`pre-i5-security-review.md`, "Live Payment Boundary": LIVE PAYMENT IN I5:
FORBIDDEN — FIRST LIVE PAYMENT IS I6).

# I5 Boundary

The frozen I5 scope (I5.1–I5.10 in `pre-i5-security-review.md`, "I5 Frozen
Scope") is IMPLEMENTED LOCALLY:

- I5.1 Gateway request/response contract (`src/integrations/circle-gateway/contracts.ts`)
- I5.2 strict testnet client, host-allowlisted HTTPS, bounded timeout, no generic retry (`testnet-client.ts`)
- I5.3 third Guard-expiry recheck immediately before send (`gateway-settlement.ts`)
- I5.4 ambiguous-outcome state handling (`remote_outcome_unknown`; reconcile by nonce)
- I5.5 `SettlementEvidence` strict typed contract
- I5.6 durable SettlementEvidence store (immutable, keyed by `authorizationId`, nonce index)
- I5.7 evidence digest → I3 `confirmed` transition (persist BEFORE confirmed)
- I5.8 read-only `ExecutedSpendSummary`
- I5.9 mocked/fixture integration tests — NO funds moved
- I5.10 operator-gated testnet submission path — not in CI

Proven by the I5 test suite: `tests/x402-gateway-client.test.ts`,
`tests/x402-settlement-evidence.test.ts`,
`tests/x402-settlement-evidence-store.test.ts`,
`tests/x402-executed-spend.test.ts`,
`tests/x402-gateway-operator-script.test.ts`; the settlement-orchestration
suite `tests/x402-gateway-settlement.test.ts` lands in the same commit.

What I5 is NOT:

- **Keyless.** Nothing in `src/` ever holds or reads a private key; the key
  boundary stays in the I4 external signer (see "Operator Gate" below).
- **Not a node.** I5 makes no Arc RPC call, no `eth_sendRawTransaction`, no
  receipt polling, no viem public/wallet client. The only viem use in the
  x402 domain is offline `recoverTypedDataAddress` (I4 signature verification)
  and `privateKeyToAccount` inside the external signer child. The batch-level
  `txHash` from Gateway is stored as evidence only — never fetched, never
  verified on-chain (explorer verification is an I6 pre-broadcast item).
- **Not live.** No `POST /v1/x402/settle` call was ever made in I5 (see
  "Current No-Live-Payment Boundary").
- **Not the decision-maker for funds.** Local confirmation happens only when
  the official transfer snapshot says so (see "State Machine" and
  "Confirmation Ordering").

# Gateway Testnet Contract

Official facts below were verified against
`https://developers.circle.com/openapi/gateway.yaml` (access date 2026-09-14)
and are the single source for the typed contract in
`src/integrations/circle-gateway/contracts.ts` (every official→normalized
field mapping lives in that file's validators, annotated with the wire name).

- **Base URL:** `https://gateway-api-testnet.circle.com` (first `servers:`
  entry; compile-pinned as `GATEWAY_TESTNET_ORIGIN`).
- **Settle:** `POST /v1/x402/settle`. Request body is exactly
  `{ paymentPayload, paymentRequirements }` — both required, and there is NO
  top-level `x402Version`: `x402Version` lives INSIDE `paymentPayload`,
  alongside `accepted` and `payload`. `buildGatewaySettleRequestBody`
  serializes only those two properties; caller-supplied extra top-level keys
  can never reach the wire (proven by `tests/x402-gateway-client.test.ts`).
- **Settle response (200 and 500 shapes):** required
  `{ success, transaction, network }`; optional `errorReason` and `payer`
  ("present on success or when identifiable" → normalized
  `payerAddress: string | null`). `errorReason` is a 15-value enum on the
  200 shape (`unsupported_scheme`, `unsupported_network`, `unsupported_asset`,
  `invalid_payload`, `address_mismatch`, `amount_mismatch`,
  `invalid_signature`, `authorization_not_yet_valid`, `authorization_expired`,
  `authorization_validity_too_short`, `self_transfer`,
  `insufficient_balance`, `nonce_already_used`, `unsupported_domain`,
  `wallet_not_found`); `unexpected_error` is the 500-shape value only. The
  union in `contracts.ts` is a documented superset covering both.
- **`transaction` is a transfer UUID on success / empty string on failure —
  NEVER an on-chain tx hash.** On `success: true` the validator requires a
  UUID shape; on failure, empty string or a UUID, never a random string.
- **Reconciliation reads:** `GET /v1/x402/transfers?nonce=` (list; envelope
  `{ transfers: [...] }`, no other documented key) and
  `GET /v1/x402/transfers/{id}` (single; official 404 = "Transfer not
  found" → normalized `not_found`, body never parsed).
- **Transfer statuses:** `received | batched | confirmed | completed | failed`
  (`GatewayTransferStatus`, verbatim).
- **Transfer `txHash`** is the BATCH-level chain tx hash — shared across all
  transfers in the same batch, null until batched (normalized to
  `batchTxHash`).
- **`token` is a SYMBOL** (e.g. `USDC`) — there is no asset-address field on
  an official transfer (validated as `/^[A-Z0-9]{2,10}$/`, preserved
  verbatim; a fabricated `assetAddress` field is rejected as unknown).
- **Arc Testnet:** CAIP-2 `eip155:5042002`; USDC
  `0x3600000000000000000000000000000000000000` (6 decimals, per
  `data/policies.default.json` `assetDecimals: 6` and the pre-I5 review's
  re-verified facts table).

Every response body is rejected on unknown fields, wrong formats, or
non-`application/json` content types — a body is untrusted until the complete
shape validates (`GatewayContractError` with stable machine-readable codes;
no logging of any request/response body anywhere).

# State Machine

The I3 execution store (`src/domain/x402/execution-store.ts`) was extended in
I5 with `remote_outcome_unknown` (blocker 1 of the pre-I5 review). States:
`prepared | submitted | remote_outcome_unknown | confirmed | failed`.
Allowed transitions (`ALLOWED_TRANSITIONS`):

| From | To |
| --- | --- |
| `prepared` | `submitted`, `failed` |
| `submitted` | `confirmed`, `failed`, `remote_outcome_unknown` |
| `remote_outcome_unknown` | `confirmed`, `failed` |
| `confirmed` | — (terminal) |
| `failed` | — (terminal) |

Properties that matter for settlement safety:

- Durable state is a sequence of immutable numbered event files
  (`NNNN.json`) created with filesystem-exclusive writes; reads reconstruct the
  current state and never mutate. A corrupt history throws
  `X402ExecutionStoreError` — never auto-repaired. Orchestrations ALWAYS
  re-read durable state from disk; an in-memory record object is never
  trusted.
- An identical repeat transition is `REPLAYED` (success semantics for crash
  recovery); a different repeat is a `STATE_CONFLICT`.
- `submitted → remote_outcome_unknown` is idempotent only for the exact same
  `(nonce, reasonCode, gatewayTransferId)` triple. `remote_outcome_unknown →
  submitted` NEVER exists: recovery reconciles by nonce and never re-signs.
- `confirmed` requires a `sha256:<64 hex>` `settlementEvidenceDigest`;
  `failed` stores a stable stage (`prepare | sign | submit | settle`) + code —
  never `Error.stack`, secrets, or raw bodies.
- The `remote_outcome_unknown` event validates its `reasonCode` against the
  shared `X402_GATEWAY_REASON_CODES` list (22 stable codes in
  `src/domain/x402/gateway-reason-codes.ts`) — free-form HTTP text is never
  security state.

# Final Guard Expiry Check

`pre-i5-security-review.md` ("Guard Expiry Before Submission") freezes a
THIRD expiry check: I2 checks at eligibility time, I4 rechecks before the
signer call, I5 must recheck immediately before `settle`. Implemented as
guard (7) of `submitX402GatewaySettlement`:

- `now < prepared.authorizationExpiresAt` strictly — `now === expiresAt`
  rejects; a NaN `now` or an unparseable expiry fails closed. All rejections
  return `X402_GATEWAY_AUTHORIZATION_EXPIRED` with ZERO transport calls.
- The check runs AFTER every other pre-submit guard and IMMEDIATELY before the
  single `client.settle` call.
- The EIP-3009 `validBefore` window is a SEPARATE control and NEVER overrides
  Guard expiry (a long-lived signature window cannot extend the Guard's
  authorization TTL).

# Settlement Request Binding

Guards (1)–(6) of `submitX402GatewaySettlement`
(`src/domain/x402/gateway-settlement.ts`) run fail-closed with ZERO transport
calls, in this order:

1. Durable re-read — corrupt store → `X402_GATEWAY_STATE_CONFLICT`; missing
   record → `X402_GATEWAY_EXECUTION_NOT_FOUND`.
2. State must be `submitted` → else `X402_GATEWAY_EXECUTION_NOT_SUBMITTED`.
3. `submitted.recoveryMetadataComplete` → else
   `X402_GATEWAY_RECOVERY_METADATA_MISSING` (legacy pre-I5 record — see
   "Payload Recovery / Liveness").
4. `signerPayloadDigest(signedPayload)` === the digest committed to the
   durable `submitted` event → else `X402_GATEWAY_PAYLOAD_DIGEST_MISMATCH`.
   Any signature/amount/recipient/nonce substitution changes the digest.
5. I1 strict validation of the requirement + its fingerprint === durable
   `paymentRequirementDigest` → else
   `X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH`.
6. Binding: requirement `network`/`asset`/`payTo`/`amount` vs the durable
   prepared record (addresses compared case-insensitively, amount as an exact
   decimal string); the network+asset must be on the CURRENT policy allowlist
   (`data/policies.default.json` via `loadPolicyConfig` — never a hardcoded
   second copy) → else `X402_GATEWAY_BINDING_MISMATCH` /
   `X402_GATEWAY_NETWORK_NOT_ALLOWED`. The payload's `authorization.from`
   must equal the durable submitted `payerAddress`.

And after the transport call: a validated settle response describing a
DIFFERENT `network` than the durable record proves nothing about this
execution → `X402_GATEWAY_STATE_CONFLICT`, no state change. The Gateway
client receives ONLY the signed payload + requirement + non-secret metadata;
all 12 immutable `SettlementEvidence` base-linkage fields are derived
EXCLUSIVELY from durable I3 evidence, never from a Gateway response.

# Testnet Host Pinning

`src/integrations/circle-gateway/testnet-client.ts`:

- The origin is compile-pinned to `GATEWAY_TESTNET_ORIGIN`
  (`https://gateway-api-testnet.circle.com`). There is NO
  `baseUrl`/`gatewayUrl`/`host` option (proven at compile time via
  `@ts-expect-error` and at runtime via an attacker-ish widened options
  object in `tests/x402-gateway-client.test.ts`); URLs are built only by
  concatenating the pinned origin with fixed constant paths. Only HTTPS.
- Caller input cannot smuggle an origin/path/query: `nonce` must match
  `0x<64 lowercase hex>` and `transferId` must match the official UUID format
  BEFORE any URL construction; anything else is a local rejection with zero
  fetch calls.
- `redirect: "error"` on every request, PLUS a defensive 3xx-status rejection
  (a resolved 300–399 response is rejected as
  `X402_GATEWAY_REDIRECT_REJECTED`; the redirect body is never read or
  followed).
- Bounded timeout: `GATEWAY_TESTNET_DEFAULT_TIMEOUT_MS = 10000` (10 s,
  deliberately far below the official `maxTimeoutSeconds` 604900 so an
  unresponsive gateway surfaces fast), enforced with an `AbortController`;
  overridable once per client via `timeoutMs` (positive safe integer or
  `RangeError`), never per request. A caller-provided already-aborted signal
  prevents the request entirely; caller aborts are never mislabeled as
  timeouts.
- Response bound: `GATEWAY_MAX_RESPONSE_BYTES = 262144` (256 KiB), enforced
  twice: a `content-length` pre-check (non-numeric headers are treated as
  absent — never guessed), and a streaming byte cap
  (`readBoundedStreamText`) that cancels the reader the moment the running
  total exceeds the cap — oversized bytes are never buffered or decoded.
  Exactly 256 KiB is accepted (inclusive-safe); cap+1 is rejected.
- Strict validation of every body (unknown-field rejection, format patterns,
  enum checks) via the I5.1 contract module; non-JSON content types are
  `X402_GATEWAY_RESPONSE_INVALID`, never guessed.
- No request/response body logging anywhere (no `console.*`); nothing is
  persisted by the transport. No new HTTP dependency: the default is platform
  `globalThis.fetch` only.

# Duplicate Settlement Protection

Frozen by `pre-i5-security-review.md` ("Duplicate Settlement Protection"):

- **Gateway side:** a previously used nonce makes settlement FAIL
  (`success:false`, `errorReason: "nonce_already_used"`); retrying the
  identical signed payload is REJECTED, not idempotent, and the exact retry
  response is UNSPECIFIED by Circle.
- **`nonce_already_used` is NOT a terminal failure locally.**
  `classifySettleRejection` returns
  `X402_GATEWAY_NONCE_ALREADY_USED_RECONCILE_REQUIRED` and writes NOTHING and
  transitions NOTHING: the nonce may have been accepted earlier, so the only
  correct next step is nonce-keyed reconciliation (see "Reconciliation by
  Nonce"). The identical signed payload is never retried.
- **Local protection (required, implemented since I3):** the first `prepared`
  event permanently consumes the v2 authorization (duplicate prepare →
  `X402_EXECUTION_ALREADY_CONSUMED`), and the deterministic
  authorizationId ↔ EIP-3009 nonce is claimed via the durable nonce registry
  with exclusive creation (`nonces/0x<64hex>.json` in the execution store).
  This local deterministic nonce registry + single-use claim is what prevents
  accidental double-settlement; the x402 payment-identifier extension is NOT
  relied on (Gateway does not advertise it).
- **Gateway's own nonce enforcement is NOT proven until I6** — I5 implements
  the local registry + reconcile path only.

# Retry Policy

**NO automatic retry anywhere.** The client makes exactly ONE fetch per method
call (`roundTrip` comment: "no retry, no backoff, no automatic re-send under
any circumstance"); the orchestration module calls `client.settle` exactly
once per submit and never re-sends after any ambiguity. The pre-I5 review's
retry matrix allowed bounded retries for pre-connect DNS failures; the I5
implementation adopts the STRICTER rule — DNS/connect/TLS/reset failures are
also never retried in-process (they surface as
`X402_GATEWAY_TRANSPORT_FAILURE` → ambiguous).

Outcome classification in `gateway-settlement.ts`:

| Condition | Local result |
| --- | --- |
| timeout, connection reset, 5xx (even when the body parses), malformed/oversized/redirect, unexpected status, success without a valid transfer UUID, non-mappable 4xx body, crash after send | `remote_outcome_unknown` — durable unknown evidence FIRST, then the I3 transition; NEVER `failed`, NEVER retried |
| valid `success:false` with a mapped official `errorReason` on a 4xx or 200 | `failed` with `failureStage: "settle"` (`X402_GATEWAY_KNOWN_REJECTION`), evidence persisted first |
| `errorReason: "nonce_already_used"` | reconcile-required — nothing written (see "Duplicate Settlement Protection") |
| 200 + `success:true` + valid transfer UUID | acceptance only: `accepted_pending` evidence (status `received`), local state STAYS `submitted` |
| local pre-send rejection (guard failure) | fail-closed result with ZERO transport calls; no state change (the caller/orchestrator never sent anything) |

HTTP 200 alone confirms nothing, and a transfer UUID alone NEVER confirms —
confirmation requires an observed `confirmed`/`completed` transfer snapshot
(see "Confirmation Ordering").

# Remote Outcome Unknown

The ambiguous path is `persistAmbiguousOutcome`: it appends a
`SettlementEvidence` snapshot with `source: "settle_transport"` and
`outcome: "remote_outcome_unknown"` carrying NO invented Gateway fields
(`gatewayTransferId`, `gatewayTransferStatus`, `gatewaySuccess`,
`gatewayErrorReason`, `batchTxHash` all null — enforced by the contract's
cross-field consistency rules), and only then applies the idempotent I3
`submitted → remote_outcome_unknown` transition (REPLAYED is success; anything
else is `X402_GATEWAY_STATE_CONFLICT`).

The transition event's `reasonCode` must be one of the shared
`X402_GATEWAY_REASON_CODES`. The transport's own frozen code is reported when
it is in that list (`X402_GATEWAY_TRANSPORT_TIMEOUT`,
`X402_GATEWAY_TRANSPORT_FAILURE`, `X402_GATEWAY_RESPONSE_INVALID`); codes that
exist only at the transport layer (`X402_GATEWAY_RESPONSE_TOO_LARGE`,
`X402_GATEWAY_REDIRECT_REJECTED`) are mapped to
`X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN` for the durable event.

`remote_outcome_unknown` is at-risk accounting, not failure: the funds may or
may not have been accepted remotely. Exit is ONLY via reconciliation to
`confirmed`/`failed` — never back to `submitted`, never a re-sign.

# Reconciliation by Nonce

`reconcileX402GatewayOutcome` — the recovery path for `submitted` and
`remote_outcome_unknown` records (never retries `settle`, never marks failed
on ambiguity, never frees at-risk accounting):

1. Durable re-read; `confirmed`/`failed` → `X402_GATEWAY_STATE_CONFLICT`;
   `prepared` → `X402_GATEWAY_EXECUTION_NOT_SUBMITTED`; incomplete recovery
   metadata → `X402_GATEWAY_RECOVERY_METADATA_MISSING` (identity filtering is
   impossible without the durable payer).
2. Token binding: the official transfer snapshot carries a SYMBOL, not an
   address. The only trusted derivation is the CURRENT policy allowlist entry
   bound to the durable asset address (`assetSymbol` in
   `data/policies.default.json`). No bindable symbol → fail closed
   `X402_GATEWAY_REMOTE_TRANSFER_MISMATCH` rather than guessing an asset
   identity (documented RESIDUAL).
3. `GET /v1/x402/transfers?nonce=` and a durable identity filter: a transfer
   matches only if ALL of nonce, payer, payTo, exact amount, BOTH networks,
   and the bound token symbol match.
4. Unknown/empty result or zero matches → no trustworthy outcome: from
   `submitted`, durably enter `remote_outcome_unknown`; from
   `remote_outcome_unknown`, change nothing (`X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN`).
   Two or more matches → `X402_GATEWAY_REMOTE_TRANSFER_MISMATCH`, NOTHING
   written, never an arbitrary pick.
5. The single match is refined via `GET /v1/x402/transfers/{id}` (read-only);
   unknown/not_found falls back to the list snapshot; a refinement
   contradicting the durable identity fails closed.
6. Status → outcome: `received`/`batched` → NEW `accepted_pending` snapshot
   (never overwrite, never confirm) → `X402_GATEWAY_TRANSFER_PENDING`;
   `failed` → `failed` snapshot → I3 `failed(settle)` →
   `X402_GATEWAY_TRANSFER_FAILED`; `confirmed`/`completed` → the full
   confirmation ordering below → `X402_GATEWAY_TRANSFER_CONFIRMED`. The
   official status is preserved verbatim — `completed` is stronger than
   `confirmed` and is never claimed when only `confirmed` was observed.

**Confirmation threshold (frozen):** only official `confirmed` OR `completed`
may satisfy local `confirmed`. `received`/`batched` mean funds locked/queued
(accepted/pending) and stay at-risk. HTTP 200 alone and a transfer UUID alone
NEVER confirm.

# SettlementEvidence

`src/domain/x402/settlement-evidence.ts` (I5.5) — the strict, versioned
(`settlement_evidence` / `v1`) contract for one durable interpretation
snapshot:

- 12 immutable base-linkage fields (`authorizationId`,
  `parentAuthorizationId`, `auditId`, `agentId`, `paymentRequirementDigest`,
  `signerPayloadDigest`, `network`, `assetAddress`, `payerAddress`, `payTo`,
  `amountAtomic`, `nonce`) — always from trusted durable evidence, never from
  a Gateway response.
- Remote interpretation: `source`
  (`settle_response | transfer_snapshot | settle_transport`), local
  `outcome` (`remote_outcome_unknown | accepted_pending | confirmed |
  completed | failed`), and the official fields preserved VERBATIM
  alongside it (`gatewayTransferId`, `gatewayTransferStatus`,
  `gatewaySuccess`, `gatewayErrorReason`, `batchTxHash`) plus `recordedAt`.
- Cross-field consistency is a set of REQUIRED implications: `confirmed`
  requires official status `confirmed`; `completed` requires status
  `completed`; `accepted_pending` requires `received` or `batched`; `failed`
  requires a known deterministic rejection (non-null `gatewayErrorReason` OR
  `gatewaySuccess === false` OR status `failed`); `remote_outcome_unknown`
  requires ALL five Gateway fields null; `settle_transport` source implies
  `remote_outcome_unknown`; `transfer_snapshot` implies a non-null status AND
  id.
- Formats are distinct on purpose: `gatewayTransferId` is a UUID (never a tx
  hash); `batchTxHash` is `0x` + 64 hex (never a UUID).
- `fingerprintSettlementEvidence` = `sha256:<64 lowercase hex>` over the
  stable-JSON canonicalized (key-sorted), RE-VALIDATED normalized object —
  key insertion order is irrelevant; any contract-relevant field change (or a
  different `recordedAt`) changes the digest.

# Durable Evidence Store

`src/domain/x402/settlement-evidence-store.ts` (I5.6), Option B of the frozen
design — a dedicated directory separate from the canonical policy audit and
from the I3 execution store. Paths resolve through `src/lib/paths.ts`:
`settlementEvidencePath()` = `AGENTPAY_SETTLEMENT_EVIDENCE_PATH` if set, else
`<dir of auditLogPath()>/settlement-evidence`; the I3 store likewise via
`executionStorePath()` = `AGENTPAY_EXECUTION_STORE_PATH` or
`<dir of auditLogPath()>/execution-store`. Both default locations
(`data/execution-store/`, `data/settlement-evidence/`) are gitignored; both
env vars are documented in `.env.example`.

```
<settlement-evidence root>/
  authorizations/auth_<64hex>/0001.json   # immutable numbered snapshots
  nonces/0x<64hex>.json                   # nonce → first snapshot reference
  transfers/<transfer-uuid>.json          # only when a validated UUID exists
```

- Every snapshot and index record is created with filesystem-exclusive
  `open(path, "wx")` + fsync — the same cross-process primitive as the
  execution store. **TRUST BOUNDARY (honest):** this is a same-filesystem
  durability/crash-recovery mechanism, NOT a tamper-proof or WORM archive;
  append-only-ness is enforced by O_EXCL + strict parsing + never rewriting,
  not by cryptography. Any process able to write the store directory is
  inside the trust boundary (same assumption as `data/audit-log.jsonl`).
- Decision table for `appendSettlementEvidence`: contract-invalid input
  throws (no write); corrupt history throws (no write); changed base linkage
  → `CONFLICT` (no write); same digest already present → `EQUIVALENT`
  (replay — this is what makes crash-window re-runs reuse the digest and stay
  idempotent); won exclusive create → `APPENDED`; lost race, same digest →
  `EQUIVALENT`; lost race, different digest → `SEQUENCE_CONFLICT` (nothing
  written); nonce/transfer index owned by a DIFFERENT authorization →
  `CONFLICT` (pre-flight: nothing written).
- Indexes follow first-reference semantics (later lifecycle snapshots reuse
  the first pointer; never overwrite) and are ensured AFTER the snapshot, so
  an index can never dangle toward a missing file. Reads
  (`readSettlementEvidence`, `latestSettlementEvidence`,
  `findSettlementEvidenceByNonce`, `findSettlementEvidenceByTransferId`,
  `listSettlementEvidenceAuthorizations`) never mutate and fail closed on
  corruption.
- NO SECRETS: the store holds no private key, no signature, no raw signed
  `PaymentPayload`, no raw Gateway body — only validated digests + official
  fields + non-secret pointer records.

# Confirmation Ordering

Mandated by the frozen design and implemented in the confirmation path
(`reconcileX402GatewayOutcome`):

```
validate → build normalized evidence → PERSIST durably → digest → I3 confirmed transition
```

- The evidence append MUST precede the I3 transition. If the append fails or
  conflicts (null digest from `persistEvidence`), NO transition is performed
  — the result is `X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT` and the
  durable state is untouched.
- The `confirmed` transition stores ONLY the digest; the evidence object
  itself lives in the durable store.
- Crash between the evidence write and the transition is RECOVERABLE:
  `finishX402GatewayConfirmation` reads the LATEST durable evidence offline
  (NO network calls), and when its outcome is `confirmed`/`completed`,
  recomputes `fingerprintSettlementEvidence` and replays the idempotent I3
  transition — a REPLAYED transition is success, not an error. Contradictions
  (confirmable evidence but state `failed`/`prepared`) fail closed for human
  triage; terminal states are never rewritten.

The same evidence-first ordering applies to the `failed` and
`remote_outcome_unknown` paths (durable evidence, then the I3 transition).

# ExecutedSpendSummary

`src/domain/x402/executed-spend.ts` (I5 / BLOCKER 3) answers "what did we
ACTUALLY spend?" strictly from the two durable stores — ZERO writes, ZERO
network. It is ACTUAL-EXECUTION accounting, kept SEPARATE from the I1/I2
proposed-intent policy spend controls.

Per-authorization classification, exactly once each, latest canonical
evidence first (multiple lifecycle snapshots are never double counted):

| # | Condition | Bucket |
| --- | --- | --- |
| 1 | latest evidence outcome `confirmed` or `completed` | `settled` (covers the "evidence written, I3 transition crashed" window) |
| 2 | else latest evidence outcome `failed` | `failed` (durable known rejection outranks any non-terminal I3 state) |
| 3 | else I3 state `failed` | `failed` |
| 4 | else I3 state `remote_outcome_unknown` | `unknown` |
| 5 | else I3 state `submitted` | `unknown` (conservative: a settle attempt may have happened in a crash window with no recorded outcome) |
| 6 | else (`prepared`) | `pending` (no remote attempt was possible) |

Below the table, a conservative store-inconsistency guard: I3 `confirmed`
with NO durable evidence → `unknown` — never `settled` (nothing official
proves the money moved) and never `pending` (an attempt demonstrably
happened).

Arithmetic is BigInt ONLY over the canonical decimal atomic-unit strings from
the durable prepared record. `authorizedAmountAtomic` = Σ `amountAtomic` over
ALL enumerated (post-filter) authorizations, each counted once, regardless of
bucket; the four buckets `settled / failed / unknown / pending` are disjoint
and exhaustive, and the invariant `settled + failed + unknown + pending ===
authorized` (plus `authorizationCount === records.length`) is re-checked as a
fail-closed guard before returning. `unknown` is AT-RISK: never zero, never
settled; it may become `settled` or `failed` on a later reconciliation.
Corrupt records in either store throw the owning module's typed error — a
record is NEVER silently skipped (that would under-report spend), and
filtering happens only AFTER both stores are read, so corruption can never be
filtered away. `agentId`/`network`/`assetAddress` come from the DURABLE
prepared record only; `agentId` remains a self-asserted, unauthenticated
policy identity (ADD-1 RESIDUAL, acceptable for the bounded testnet proof,
not production-grade).

# Payload Recovery / Liveness

The signed payload is transient: it is passed from the I4 signing orchestrator
to `submitX402GatewaySettlement` in the SAME process run and is NEVER
persisted. What IS persisted on the `submitted` event (non-secret,
pattern-validated):

- `payerAddress` (EVM address), `signingRequestDigest` (`sha256:<64 hex>`),
  and the signed EIP-3009 validity window `validAfter` / `validBefore`
  (decimal Unix-second strings) — alongside `nonce` and
  `signerPayloadDigest`.

The raw signature and the signed payload are NEVER persisted (the I3 store's
strict known-field parsing rejects them). Consequences (frozen by the pre-I5
review, "I4 Payload Recovery / Liveness"):

- **NO automatic re-sign.** After a crash the transient payload is gone; the
  validity window was derived from `now` at signing time, so re-signing the
  same deterministic nonce with a fresh `now` would produce a DIFFERENT
  payload bound to the SAME nonce — unsafe. Recovery therefore reconciles by
  nonce (`--reconcile` / `reconcileX402GatewayOutcome`), and an expired,
  unresolved authorization requires a FRESH Guard authorization lineage (new
  v1 → v2 → execution claim).
- **Legacy rule:** pre-I5 `submitted` records that omit ALL FOUR recovery
  fields together still parse (`recoveryMetadataComplete === false`) — the
  store never declares valid history corrupt because of the upgrade. But I5
  refuses to settle or reconcile them
  (`X402_GATEWAY_RECOVERY_METADATA_MISSING`): without a durable payer the
  binding cannot be proven, and re-deriving the window is forbidden. Partial
  presence of the four fields is treated as CORRUPT (fail closed, never
  repaired).

# Operator Gate

`scripts/x402-gateway-testnet.mjs` is the ONLY live entry point, and it
refuses by default:

- Live mode requires BOTH `--live` AND environment
  `AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT` set to exactly the string
  `"true"`. Any other invocation prints exactly ONE refusal line to stderr
  containing `X402_GATEWAY_OPERATOR_AUTH_REQUIRED` and exits with code 2 —
  with ZERO network calls, ZERO signer invocations, ZERO filesystem writes,
  ZERO key reads, and ZERO TypeScript imports (the gate script is pure JS
  importing only `node:` builtins; the refusal branch imports no TS at all —
  statically asserted in `tests/x402-gateway-operator-script.test.ts`).
- The `src/` mirror of the gate is
  `src/domain/x402/gateway-live-transport.ts`:
  `createLiveGatewayTestnetClient(env)` returns the same refusal code without
  constructing any client unless the exact env string matches. Nothing under
  `src/app/**` may import it (statically verified).
- Modes (nothing else):
  - `--live --reconcile --authorization-id <id>` — read-only nonce
    reconciliation through the runner; NEVER invokes a signer; valid from
    `submitted`/`remote_outcome_unknown` (enforced by the orchestration
    module).
  - `--live --sign-and-settle --authorization-id <id> --requirement
    <path.json> --payer <0x...>` — ONLY from durable state `prepared`
    (fresh lineage). Any other state (in particular `submitted`) is refused
    with `X402_GATEWAY_EXECUTION_NOT_SUBMITTED` BEFORE the signer is spawned:
    re-signing a used deterministic nonce is FORBIDDEN. It reads + I1-validates
    the requirement, checks its fingerprint against the prepared record, then
    obtains the signature by spawning `scripts/x402-external-signer.mjs` as a
    CHILD PROCESS (stdin JSON → stdout JSON; the key lives only in the child's
    environment via `AGENTPAY_X402_SIGNER_PRIVATE_KEY` and never enters the
    parent), verifies it cryptographically via `signPreparedX402Execution`,
    and submits in the SAME process run. Output is one sanitized single line
    (reason code, durable state, validated transfer UUID, evidence digest) —
    never payload, signature, raw bodies, keys, or env dumps.
- **TS execution mechanism:** once authorized, the script uses Node's native
  type stripping to execute `scripts/x402-gateway-testnet-runner.ts`, resolved
  through the small ESM resolve hook `scripts/x402-operator-loader.mjs`
  (maps `@/…` → `src/…`, extensionless relative specifiers → `.ts`). On Node
  builds where stripping isn't default, it probes once and re-execs itself
  exactly once with `--experimental-strip-types` (loop-guarded by
  `AGENTPAY_X402_OPERATOR_STRIPPED`); if unsupported it refuses with one
  clear diagnostic — no clever fallbacks.
- **Key boundary:** Guard `src/` stays keyless end-to-end. The EIP-3009 key
  exists ONLY in the external signer process
  (`scripts/x402-external-signer.mjs`, from its own
  `AGENTPAY_X402_SIGNER_PRIVATE_KEY`); the Gateway client receives only the
  signed payload + requirement + non-secret metadata and holds nothing.
- Proven by `tests/x402-gateway-operator-script.test.ts`: refusal contract
  (exit 2, single line, untouched fake signer/temp stores, stable
  `git status`, default `data/execution-store` never created), exact-string
  env sensitivity (`"1"`, `"TRUE"`, `"true "` etc. all refuse), and — as a
  NON-live executability proof — the runner's whole `@/…` TS module chain is
  importable to completion inside a network-blocked child process (DNS +
  `globalThis.fetch` hard-fail preload; `main()` never invoked).

# CI Safety

- `pnpm test` (`vitest run`), `pnpm build` (`next build`) and `pnpm smoke`
  (`node scripts/smoke.mjs`, which only evaluates mock payment rails against
  the local app on `127.0.0.1`) CANNOT perform settlement: no test imports the
  live transport's authorized branch, and the operator script refuses without
  the flag+env pair. **CI has no environment variable that enables live mode**
  — the gate requires an explicit operator-set exact-string authorization that
  no CI config provides (`"true"` is NEVER set by any test).
- Every I5 test injects a mock transport/fetch and never contacts
  `gateway-api-testnet.circle.com`, `gateway-api.circle.com`, or any Arc RPC:
  `tests/x402-gateway-client.test.ts` stubs `globalThis.fetch` with a throwing
  guard (any accidental real fetch fails the suite loudly; a final assertion
  checks the guard never fired); `tests/x402-settlement-evidence*.test.ts`,
  `tests/x402-executed-spend.test.ts` use temp directories only (never
  `data/execution-store/` or `data/settlement-evidence/`);
  `tests/x402-gateway-operator-script.test.ts` runs the gate under refusal
  conditions and network-blocked preloads.
- **Honest residual:** `vitest.config.ts` has NO global fetch sandbox —
  isolation is enforced per test file by convention plus each file's own
  guard, not by the runner config.

# Current No-Live-Payment Boundary

Stated explicitly and honestly:

- NO `POST /v1/x402/settle` call was ever made in this task. No testnet
  payment was executed. No funds moved. NO live transfer UUID exists anywhere.
- Every transfer UUID appearing in tests/fixtures (e.g.
  `550e8400-e29b-41d4-a716-446655440000`,
  `123e4567-e89b-12d3-a456-426614174000`) is a visibly fixture-only value
  fabricated locally with the official format; the evidence-store and client
  tests construct official-shaped payloads offline.
- **One real network read DID occur during this task's documentation
  re-verification:** a single read-only `GET
  https://gateway-api-testnet.circle.com/v1/x402/supported` capability probe on
  2026-09-14 (the same permissionless endpoint the pre-I5 review probed live on
  2026-08-17). It returned the Arc Testnet `eip155:5042002` USDC supported
  kind. That is all: no settle call, no signed payload submitted, no funds
  moved, no state written.
- The operator live path (`scripts/x402-gateway-testnet.mjs`) exists, is
  importable, and is tested ONLY on its refusal branch; its first real
  exercise is I6. NOT YET EXECUTED.

# Remaining I6 Preconditions

Everything below must hold before the first real `/settle` (per
`pre-i5-security-review.md` — "Pre-Broadcast Checklist", all items
deliberately UNCHECKED by the review, and the "Blocking Findings"):

1. Explicit operator authorization (`--live` +
   `AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT="true"`) for a bounded, monitored
   test run.
2. A funded, test-only signer EOA (`AGENTPAY_X402_SIGNER_PRIVATE_KEY` held
   only by the external signer process; payer matches the trusted test EOA
   binding).
3. The full pre-broadcast checklist verified at run time: policyVersion
   current, I1/I2 pass, v2 commitment matches, Guard authorization live, I3
   single-use claim + deterministic nonce claim exist, execution state valid,
   I4 cryptographic verification passes, network = Arc Testnet, asset =
   approved Arc Testnet USDC, payTo = trusted test seller, amount exact,
   Gateway EIP-712 domain matches policy, retry/ambiguity/response-validator/
   durable-evidence/executed-spend controls implemented (all landed in I5), no
   raw-request bypass, no key in Guard core, testnet-only host, unknown
   outcomes handled — and a final operator security sign-off.
4. The first LIVE `POST /v1/x402/settle` (positive path) executed through the
   operator gate.
5. Proof of the NEGATIVE path: an attempt to reuse the consumed nonce, with
   the observed Gateway rejection reconciled via
   `X402_GATEWAY_NONCE_ALREADY_USED_RECONCILE_REQUIRED`. **Gateway's own
   nonce enforcement is NOT proven until this live negative test** — the local
   registry proves local single-use only.
6. Reconciliation of the live transfer to `confirmed`/`completed` via
   `--reconcile`, with durable SettlementEvidence + I3 `confirmed` landing
   through the mandated ordering.
7. An explorer-verifiable batch `txHash` for the settled transfer (the hash
   I5 stores is Gateway-asserted evidence; I5 never verifies it on-chain).

# Next Step

I6: the operator-authorized first Arc Testnet x402/Gateway payment — with
POSITIVE proof (settle → nonce reconciliation → official
`confirmed`/`completed` → durable evidence → I3 `confirmed` → funds actually
moved, explorer-verifiable) and NEGATIVE proof (consumed-nonce reuse refused
and reconciled, funds never double-spent). Until I6 executes, every I5 claim
in this document is IMPLEMENTED LOCALLY / MOCK-VERIFIED only — no live
settlement, no official Gateway behavior confirmed by real payment, no Arc/Circle
endorsement, no production readiness, and no key-management story beyond the
bounded test-only signer process.

Phase 9 (fresh-clone / release readiness, see
[`roadmap.md`](roadmap.md)) remains **DEFERRED**.
