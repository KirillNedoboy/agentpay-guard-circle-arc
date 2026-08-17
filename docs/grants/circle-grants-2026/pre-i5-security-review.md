# Pre-I5 Security / Threat-Model Re-Review — AgentPay Guard → Circle Gateway / x402 → Arc Testnet

Status: **COMPLETED — DECISION: GO WITH BLOCKERS.** This document is a
security review and I5 design freeze ONLY. It implements nothing, changes no
runtime code, makes no Gateway/RPC/network call, and performs no commit or
push (a separate worker owns validation/commit/push). It is an internal
engineering security review, not an independent external audit.

Last verified: 2026-08-17

# Decision

**DECISION: GO WITH BLOCKERS.**

The Gateway/x402 → Arc Testnet path remains feasible and the I1–I4 local
execution surface is consistent with it, but I5 code changes MUST land before
any real `/settle` call. The four blockers, in exact implementation order:

1. **I3 state-machine extension** — add a `remote_outcome_unknown` state
   (distinct from `failed`), because `failed` means "known deterministic
   rejection" and a transport timeout after the request left the process is
   UNKNOWN, not failed.
2. **SettlementEvidence contract + durable store** — implement in I5
   (immutable, separate directory, keyed by authorizationId + indexed by
   nonce).
3. **Executed-spend reconciliation** — read-only `ExecutedSpendSummary`
   (settled/failed/unknown buckets) from durable SettlementEvidence.
4. **Payload recovery/liveness** — persist the EIP-3009 validity window
   (validAfter/validBefore) in the I3 record OR require a fresh-authorization
   lineage for crash-after-submitted; never persist private keys or raw
   signatures.

This review re-verifies the official sources (2026-08-17), re-scans the
current I1–I4 execution surface, answers all 14 blocking questions, freezes
the I5 design, and records the 14-precondition matrix. **Live payment is NOT
authorized by this review: the first live payment is I6.**

# Scope

In scope for this review:

- The current I1–I4 execution surface (real local EIP-3009 signing exists in
  the external signer tool; Guard `src/` remains keyless and performs no
  network/RPC/settlement).
- Re-verification of the official Gateway/x402/Arc facts (2026-08-17, with
  primary-source URLs).
- The I5 design freeze: `remote_outcome_unknown` state-machine extension,
  SettlementEvidence contract + durable store, executed-spend reconciliation,
  payload recovery/liveness, Gateway client contract, expiry pre-submit
  recheck, retry policy, and the pre-broadcast checklist.
- The 14 future-execution preconditions re-classified against the I4 surface.

Out of scope (frozen elsewhere):

- **I5 implementation** — a separate implementation worker builds it; this
  review only freezes the design and the security requirements.
- **I6 positive proof / first live payment** — forbidden in I5; first live
  payment is I6.
- Production authenticated agent identity and production key management —
  RESIDUAL PRODUCTION CONTROLS, documented, not blockers for the bounded
  testnet proof.
- Canonical audit-log cross-process concurrency (T14) and tamper-evidence
  (T13) — unchanged residuals; I3/I5 fix only the NEW execution-state and
  settlement-evidence stores.

# Current I1–I4 Execution Surface

State as scanned (2026-08-17, read-only):

- Branch `grant/circle-grants-pilot-2026`, HEAD
  `1a10e235c6a69298e3442844a1cc6c5bc88982f3`, working tree clean; local HEAD
  and remote HEAD match.
- **I1** — strict x402 `PaymentRequirement` validation + deterministic
  `sha256:<64 hex>` requirement digest + `PaymentRequirementEvidence`.
- **I2** — runtime execution security gate + `ExecutionAuthorization` v2
  (17 stable rejection reason codes, fail-closed, typed-input-only).
- **I3** — durable execution store (`prepared/submitted/confirmed/failed`;
  deterministic EIP-3009 nonce via `stableSha256`; cross-process O_EXCL
  transitions; `markX402ExecutionConfirmed` takes a `settlementEvidenceDigest`
  validated as `sha256:<64 hex>`).
- **I4** — offline EIP-3009 external signer; `viem` dependency; key only in
  `scripts/x402-external-signer.mjs` process env (`AGENTPAY_X402_SIGNER_PRIVATE_KEY`);
  Guard `src/` never sees the key; `recoverTypedDataAddress` payer recovery;
  transient signed payload digest committed via I3 `submitted` transition.
- `policyVersion = "3"`. Network allowlist `eip155:5042002` (Arc Testnet);
  asset USDC `0x3600000000000000000000000000000000000000`; EIP-712
  verifyingContract `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`.
- REAL signing: YES, external/offline only. Gateway HTTP: NO. Arc RPC: NO.
  Settlement: NO. Funds moved: NO. `viem`: dependency present.
- Test baseline: 25 test files / 563 tests (per evidence.md).

# Official Sources Re-Verified

Every external fact below was re-read directly from primary sources on
**2026-08-17**, plus one live query of the official permissionless testnet
API (`GET https://gateway-api-testnet.circle.com/v1/x402/supported`, which
answered). No facts taken from memory.

| Fact | Source URL |
| --- | --- |
| `/v1/x402/settle` request = `{ paymentPayload, paymentRequirements }` (both required, no top-level `x402Version`); response `{ success, transaction, network, errorReason?, payer? }`; 200/400/500; `transaction` is a **transfer UUID on success, empty string on failure** — NOT an on-chain tx hash | https://developers.circle.com/openapi/gateway.yaml; https://developers.circle.com/api-reference/gateway/all/settle-x402payment.md |
| Transfer lifecycle statuses: `received` (submitted and accepted), `batched` (included in a batch), `confirmed` (confirmed onchain), `completed` (fully complete), `failed`; `txHash` = **batch-level** settlement transaction hash, shared by all transfers in the batch, null until batched | https://developers.circle.com/openapi/gateway.yaml |
| `GET /v1/x402/transfers/{id}` by transfer UUID; `GET /v1/x402/transfers?nonce=` filter by EIP-3009 nonce (supported) | https://developers.circle.com/openapi/gateway.yaml; https://developers.circle.com/gateway/nanopayments/references/sdk.md |
| Duplicate nonce → settlement FAILS: `success:false`, `errorReason:"nonce_already_used"` (OpenAPI settle enum + SDK error table); SDK recovery "Create a new payment". Retry with the identical signed payload is REJECTED, not idempotent; exact retry response UNSPECIFIED. (Circle's own EIP-3009 howto claims `invalid_signature` for nonce reuse — internal conflict; OpenAPI/SDK contract is the stronger wire evidence.) | https://developers.circle.com/openapi/gateway.yaml; https://developers.circle.com/gateway/nanopayments/references/sdk.md; https://developers.circle.com/gateway/nanopayments/howtos/eip-3009-signing.md |
| Timeout / at-least-once acceptance: NOT documented by Circle or the x402 spec. Timed-out settle MUST be treated as uncertain and reconciled via `GET /v1/x402/transfers?nonce=`, never as definitely-failed | https://developers.circle.com/openapi/gateway.yaml; https://developers.circle.com/gateway/nanopayments/references/sdk.md; https://raw.githubusercontent.com/x402-foundation/x402/main/specs/x402-specification-v2.md |
| payment-identifier extension: NOT implemented/advertised by Circle Gateway — live testnet `/v1/x402/supported` returned `extensions:[]` on 2026-08-17; mechanism documented by x402 docs only | https://developers.circle.com/openapi/gateway.yaml; https://docs.x402.org/extensions/payment-identifier.md |
| Testnet base URL `https://gateway-api-testnet.circle.com` (first server in OpenAPI `servers:`) | https://developers.circle.com/openapi/gateway.yaml; https://developers.circle.com/gateway/nanopayments/quickstarts/seller.md |
| Arc Testnet: CAIP-2 `eip155:5042002`, chain id 5042002, RPC `https://rpc.testnet.arc.io`; Gateway supports Arc Testnet for nanopayments (domain 26, `SupportedChainName: arcTestnet`) | https://developers.circle.com/gateway/references/supported-blockchains.md; https://docs.arc.io/arc/references/connect-to-arc.md |
| USDC (Arc Testnet) `0x3600000000000000000000000000000000000000` (6 decimals); GatewayWallet verifyingContract `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | https://developers.circle.com/stablecoins/usdc-contract-addresses.md; https://developers.circle.com/gateway/references/contract-addresses.md; https://docs.arc.io/arc/references/contract-addresses.md |
| EIP-712 domain: name `GatewayWalletBatched`, version `1`, chainId 5042002 (EVM chain id, NOT Gateway domain 26), verifyingContract = GatewayWallet | https://developers.circle.com/gateway/nanopayments/howtos/eip-3009-signing.md; https://developers.circle.com/gateway/nanopayments/concepts/x402.md |
| Minimum signature validity: live API advertises `minValiditySeconds 604800` (7 days); SDK/quickstart use 604900 (7d+100s); Circle's own howto says "at least 3 days" — internal conflict; **honor 604800** | https://developers.circle.com/openapi/gateway.yaml; https://developers.circle.com/gateway/nanopayments/quickstarts/seller.md; https://developers.circle.com/gateway/nanopayments/howtos/eip-3009-signing.md |
| No separate execution/gas fee on the exact nanopayment path: buyer authorizes exactly `PaymentRequirements.amount`; facilitator pays gas via batched settlement; "Neither the buyer nor the seller pays gas for this step" | https://developers.circle.com/gateway/nanopayments.md; https://developers.circle.com/gateway/nanopayments/concepts/batched-settlement.md; https://developers.circle.com/gateway/nanopayments/quickstarts/buyer.md; https://developers.circle.com/gateway/references/fees.md; https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_evm.md |
| Seller quickstart: "Gateway's settle() endpoint is optimized for low latency and guarantees settlement. Use settle() directly rather than calling verify() followed by settle() in production flows." (This concerns settle-vs-verify-then-settle, NOT timeout/at-least-once semantics.) | https://developers.circle.com/gateway/nanopayments/quickstarts/seller.md |

# Trust Boundaries

- **UNTRUSTED / remote (new in I5)** — the Gateway HTTP endpoint and every
  field of its responses. A settle response is untrusted until strictly
  validated against the typed contract; a timeout carries no information and
  must be treated as ambiguous.
- **UNTRUSTED / caller-controlled** — incoming HTTP JSON body fields
  (`agentId`, `recipient`, `amount`, `idempotencyKey`, …); unchanged from
  I1–I4 and consumed only via `validatePaymentIntent`.
- **TRUSTED local application** — Guard `src/` (`src/domain/**`,
  `src/app/api/**`), the loaded policy, the I3 execution store, and (in I5)
  the durable SettlementEvidence store.
- **External signer process** — a distinct trust boundary: the EIP-3009
  private key exists only in `scripts/x402-external-signer.mjs` process env;
  Guard `src/` knows only the `X402ExternalSigner` interface and never sees
  key material. The signer is trusted to sign exactly the supplied typed
  data; the signature is then cryptographically verified by Guard
  (`recoverTypedDataAddress`).
- **LOCAL FILESYSTEM** — policy JSON, audit JSONL, observation JSONL,
  execution store, and (in I5) the SettlementEvidence directory are an
  explicit trust assumption: not cryptographically signed, not tamper-evident,
  not remotely attested. Any process/user able to write to `data/` is inside
  the boundary.
- **Gateway trust model** — Gateway is a permissionless facilitator, NOT a
  trust anchor: it locks funds at settle-acceptance and batches settlement,
  but its acceptance is inferred only through the reconcile path
  (`GET /v1/x402/transfers?nonce=`), never assumed from a timeout or a lost
  response.

# First Network Effect

I5 introduces the **first real outbound network call** in the integration
track: `POST /v1/x402/settle` against the Gateway testnet host, plus the
read-only reconcile calls. Consequences frozen here:

- The one-sided trust change is explicit: before I5, all inputs were local
  and fully validated; after I5, a remote party produces execution outcomes.
- Every remote response is validated against the strict typed contract
  before it may influence local state; malformed responses are UNKNOWN, never
  interpreted as success or failure.
- The durable local execution record remains the single source of local
  truth; the Gateway reconcile API is the single source of remote truth, and
  the two are joined only through validated SettlementEvidence.
- No amount of remote ambiguity may produce a `confirmed` local state without
  durable SettlementEvidence, and no timeout may produce `failed` (see
  Ambiguous Remote Outcome).

# Gateway Request / Response Semantics

- **Endpoint:** `POST https://gateway-api-testnet.circle.com/v1/x402/settle`.
- **Request body:** `{ paymentPayload, paymentRequirements }` — both REQUIRED;
  there is **no top-level `x402Version`** in Circle's OpenAPI (the generic
  x402 spec example has one; Circle's does not). The `PaymentPayload` wraps
  the chosen `PaymentRequirements` in `accepted` plus the signed scheme
  payload.
- **Response (200):** `{ success: boolean, transaction: string, network:
  string (CAIP-2), errorReason?: string, payer?: string }`.
  - `transaction` is a **transfer UUID** on success and an **empty string** on
    failure — it is NOT an on-chain transaction hash.
  - On-chain hash is the separate `txHash` field of `X402TransferResponse`:
    **batch-level, shared by all transfers in the same batch, null until
    batched**.
  - `errorReason` enum includes `unsupported_scheme`, `unsupported_network`,
    `unsupported_asset`, `invalid_payload`, `address_mismatch`,
    `amount_mismatch`, `invalid_signature`, `authorization_not_yet_valid`,
    `authorization_expired`, `authorization_validity_too_short`,
    `self_transfer`, `insufficient_balance`, `nonce_already_used`,
    `unsupported_domain`, `wallet_not_found` (plus `unexpected_error` on 500).
- **Status codes:** 200 (settlement result — check `success`), 400 (invalid/
  malformed request body), 500 (unexpected infrastructure error, shape
  `success:false`).
- **Lookup:** `GET /v1/x402/transfers/{id}` by transfer UUID;
  `GET /v1/x402/transfers?nonce=` by EIP-3009 nonce (supported).
- **Transfer statuses:** `received | batched | confirmed | completed | failed`
  (official enum; `received` = "submitted and accepted", `completed` = "fully
  complete").

# Guard Expiry Before Submission

- The I2 gate enforces `now < expiresAt` locally at eligibility time, and I4
  rechecks it immediately before the signer call. **I5 must add a third,
  final recheck immediately before the settle send** (I5.3): after loading
  durable state, verify `now < expiresAt` strictly; `now === expiresAt`
  rejects; unparseable `expiresAt` fails closed.
- Guard expiry (`expiresAt` = issuedAt + `authorization.ttlSeconds`, 300 s)
  and the EIP-3009 `validBefore` signature-validity window are **separate
  controls**; both must hold at send time.
- EIP-3009 minimum signature validity: honor the live API's
  `minValiditySeconds 604800` (7 days); the SDK/quickstart window 604900
  (7d + 100 s buffer) remains acceptable. Circle's "at least 3 days" howto
  wording is superseded (internal conflict — documented, live API + quickstart
  agree on 7 days).

# Duplicate Settlement Protection

- **Gateway behavior:** a previously used nonce causes settlement to FAIL
  (`success:false`, `errorReason:"nonce_already_used"`; SDK recovery "Create a
  new payment"). Retry with the identical signed payload is **rejected, not
  idempotent**; the exact retry response is UNSPECIFIED by Circle. (The
  parallel `/v1/batch/submit` endpoint documents a 409 "Nonce has already
  been used", but no 409 is documented for `/v1/x402/settle`.)
- **Local protection (implemented I3):** first `prepared` event permanently
  consumes the v2 authorization (duplicate prepare →
  `X402_EXECUTION_ALREADY_CONSUMED`); deterministic one-to-one
  authorizationId ↔ EIP-3009 nonce registry with exclusive claims. This is
  REQUIRED, not optional: Gateway rejects reuse rather than returning a prior
  success.
- **payment-identifier extension: NOT relied on.** Circle Gateway does not
  advertise it (live `/v1/x402/supported` returned `extensions:[]` on
  2026-08-17). Idempotency and duplicate detection come from the durable
  nonce registry + nonce-keyed reconciliation.
- **Gateway nonce-enforcement proof = I6** (a real live submission proving the
  Gateway enforces the bound nonce); I5 implements the local registry +
  reconcile path only.

# Retry Policy

**NO generic automatic retry middleware.** Every retry decision is explicit,
bounded, and classified below. Retries that could re-send an identical signed
payload after any remote ambiguity are forbidden; the correct recovery is
nonce-keyed reconciliation, and only a fresh authorization lineage may create
a new signature.

| Condition | Classification | Action |
| --- | --- | --- |
| DNS/connect failure before connection | MAY RETRY (bounded) | Bounded, explicitly counted retries with backoff; the request never left the process, so no remote state was created |
| HTTP timeout | QUERY REMOTE STATE FIRST | Outcome UNKNOWN — do NOT retry the identical payload; reconcile via `GET /v1/x402/transfers?nonce=`; only a fresh-authorization lineage may sign again |
| Connection reset | QUERY REMOTE STATE FIRST | Outcome UNKNOWN — same as timeout; reconcile by nonce, never assume failed |
| HTTP 4xx | TERMINAL FAILURE | Known deterministic rejection (e.g. 400 malformed body); record `failed` locally with the reason; no retry of the identical payload |
| HTTP 409 / `nonce_already_used` | QUERY REMOTE STATE FIRST | Duplicate-nonce rejection is documented; the nonce may have been accepted earlier — reconcile via `GET /v1/x402/transfers?nonce=` before classifying |
| HTTP 5xx | UNKNOWN — QUERY REMOTE STATE FIRST | Documented as `success:false` infrastructure errors; acceptance is possible but not guaranteed; reconcile by nonce |
| Malformed response | UNKNOWN — QUERY REMOTE STATE FIRST | Unparseable/out-of-contract response; reconcile by nonce; never interpret as success or failure |
| Valid failure response `success:false` | TERMINAL FAILURE | Known deterministic rejection; map `errorReason` to a stable local code; record `failed` |
| Success response without durable local write | QUERY REMOTE STATE FIRST | If the success cannot be durably recorded before process exit, the outcome is UNKNOWN — reconcile by nonce on recovery |
| Process crash after remote acceptance | QUERY REMOTE STATE FIRST | Recovery MUST reconcile via `GET /v1/x402/transfers?nonce=` and use the persisted validity window (see I4 Payload Recovery / Liveness) |

# Ambiguous Remote Outcome

- A transport timeout, connection reset, HTTP 5xx, malformed response, or
  crash after the request left the process means the remote outcome is
  **UNKNOWN**. It is never `failed` (`failed` = known deterministic
  rejection), never `confirmed` (confirmed requires durable SettlementEvidence
  with official status `confirmed`/`completed`), and never silently retried.
- Circle does **not** document at-least-once acceptance or timeout semantics.
  The lifecycle docs place fund-locking inside the settle call
  ("Gateway verifies the signature, locks the buyer's funds" and status
  `received` = "submitted and accepted"), which makes post-timeout acceptance
  plausible — but that is an INFERENCE, not a documented guarantee. Design
  consequence: reconcile on every ambiguous outcome.
- The reconciliation path is documented: `GET /v1/x402/transfers?nonce=` and
  `GET /v1/x402/transfers/{id}`.

# I3 State-Machine Review

**STATE MACHINE CHANGE REQUIRED.** The current
`prepared | submitted | confirmed | failed` machine cannot safely represent an
unknown remote outcome. `remote_outcome_unknown` is REQUIRED before I5 code.

- `prepared` — durable execution claim with bound deterministic nonce.
- `submitted` — **KEEP**, formally redefined: "signed payload committed to
  the LOCAL execution lifecycle, NOT remote submission." Gateway acceptance is
  distinguished only by SettlementEvidence, never by the `submitted` label.
- `confirmed` — only via durable SettlementEvidence (official status
  `confirmed` or `completed`), with the settlement-evidence digest.
- `failed` — only for **known deterministic rejection** (valid
  `success:false`, HTTP 4xx, gate/local rejection before send).
- `remote_outcome_unknown` (NEW) — entered from `submitted` on any ambiguous
  remote outcome (timeout, reset, 5xx, malformed response, success without
  durable write, crash-after-submitted). Recovery reconciles by nonce; a
  reconciled official status moves the record to `confirmed`/`failed`; an
  unreconciled record stays `remote_outcome_unknown` and is reported as
  at-risk, never counted as settled or as zero.

**§8 semantic decision (verbatim):** `submitted` = KEEP, formally defined as
"signed payload committed to the LOCAL execution lifecycle, NOT remote
submission." Gateway acceptance is distinguished only by SettlementEvidence.

# I4 Payload Recovery / Liveness

- The signed payload is transient and must never be persisted (never private
  keys, never raw signatures). What must be recoverable after a crash is the
  ability to (a) know the payload existed and was submitted locally, and
  (b) reconcile its remote fate by nonce.
- **Required (blocker 4):** persist the EIP-3009 validity window
  (`validAfter` / `validBefore`) in the I3 record, OR require a
  fresh-authorization lineage for crash-after-submitted. Decision: I5 shall
  persist `validAfter`/`validBefore` on the prepared record (non-secret,
  deterministic from `deriveX402Eip3009ValidityWindow`), so a recovery
  process can:
  1. re-derive the nonce and query `GET /v1/x402/transfers?nonce=`;
  2. if the Gateway shows the transfer, build SettlementEvidence and
     transition out of `remote_outcome_unknown`;
  3. if the window has expired and no evidence exists, treat the record as
     terminal-unknown requiring a **fresh-authorization lineage** (a new
     Guard lineage → new authorization → new execution claim); never re-sign
     the same nonce.
- Never persist: private keys, raw signatures, or the full signed
  `PaymentPayload`. Only `signerPayloadDigest = sha256:<64 hex>` is committed.

**Signature re-creation determinism.** EIP-712 signing via viem `signTypedData`
uses ECDSA with RFC-6979 deterministic nonce derivation, so re-signing the
EXACT same domain + message (same nonce, validAfter, validBefore, from, to,
value) with the same EOA would produce a byte-identical signature. HOWEVER the
validity window (validAfter/validBefore) is derived from `now` at signing time
(`deriveX402Eip3009ValidityWindow(now, maxTimeoutSeconds)`) and is NOT
currently persisted in the I3 record, so after a crash the exact window cannot
be reconstructed — re-signing with a fresh `now` yields a DIFFERENT message
(different validity window) bound to the SAME deterministic nonce, which is
unsafe. FROZEN DECISION: persist validAfter/validBefore (non-secret) in I3 so
recovery can reconcile by nonce WITHOUT re-signing; do NOT depend on RFC-6979
determinism as a security property; where reconciliation cannot prove the
remote fate, require a fresh-authorization lineage.

# SettlementEvidence Contract

Strict typed contract (I5.5), fields constrained to what the official APIs
actually return:

```ts
type GatewayTransferStatus =
  | "received" | "batched" | "confirmed" | "completed" | "failed";

type SettlementEvidence = {
  evidenceType: "settlement_evidence";      // literal
  version: "v1";                            // literal, schema version
  authorizationId: string;                  // auth_<64 hex> — record key
  parentAuthorizationId: string;            // v1 authorization id (I2 parent)
  auditId: string;                          // canonical policy audit record
  agentId: string;                          // self-asserted logical agent (ADD-1 residual)
  paymentRequirementDigest: string;         // sha256:<64 hex> of the exact bound requirement
  signerPayloadDigest: string;              // sha256:<64 hex> of the signed payload (I4)
  network: string;                          // CAIP-2, "eip155:5042002"
  assetAddress: string;                     // 0x3600...0000 (Arc Testnet USDC)
  payerAddress: string;                     // recovered EOA == authorization.from
  payTo: string;                            // seller recipient (authorization.to)
  amountAtomic: string;                     // exact atomic units (6 decimals)
  nonce: string;                            // 0x<64 hex> EIP-3009 nonce (registry key)
  gatewayTransferId: string;                // settle-response transaction field (transfer UUID)
  gatewayTransferStatus: GatewayTransferStatus; // official enum
  gatewaySuccess: boolean;                  // settle response success
  gatewayErrorReason: string | null;        // official errorReason enum on failure
  batchTxHash: string | null;               // batch-level tx hash; null until batched
  recordedAt: string;                       // local durable-record timestamp (ISO-8601)
};
```

Explicit semantics:

- The settle-response `transaction` field (a transfer UUID) is **NOT** an
  on-chain transaction hash.
- `batchTxHash` is the **batch-level** settlement transaction hash, **shared
  by all transfers in the same batch**, and **null until the batch settles
  onchain**. It is explorer-verifiable on Arc Testnet only when present; the
  per-payment durable identifiers are `gatewayTransferId` (UUID) and `nonce`.
- The record contains NO private key, NO signature, and NO full signed
  payload — only digests and official response fields.
- **SettlementEvidence digest:** `settlementEvidenceDigest = sha256:<64
  lowercase hex>` computed over the **stable-JSON canonicalized,
  fully-validated** SettlementEvidence (key-sorted canonicalization, reusing
  `src/lib/stable-json.ts`). This exact string is passed to
  `markX402ExecutionConfirmed({ settlementEvidenceDigest })`.

# Durable Settlement Evidence

**Option B selected (verbatim):** a **dedicated settlement-evidence
directory**, with **immutable, write-exclusive per-record files keyed by
authorizationId** plus a **nonce index**, **distinct from the canonical
policy audit**. Rationale: the canonical audit log remains policy-evidence
only and byte-unchanged (never-overwrite invariant); SettlementEvidence is
execution-outcome evidence with its own lifecycle and must not be appended to
or mixed with policy evidence.

- One record file per `authorizationId` (file name derives from the
  authorizationId), created write-exclusively (`fs.open(path, "wx")`,
  O_CREAT|O_EXCL) so a record is immutable after creation; a second writer
  for the same authorizationId fails closed.
- A separate nonce index (or nonce-keyed filename mapping) supports
  `GET /v1/x402/transfers?nonce=` reconciliation lookups.
- Order (I5.7): remote outcome → validate → build normalized evidence →
  **persist durably** → compute `sha256:<64 hex>` digest → mark I3
  `confirmed` with that digest. Persistence MUST precede the confirmed
  transition; a crash between remote acceptance and durable persist leaves
  the record in `remote_outcome_unknown` for nonce reconciliation.
- Store location: `AGENTPAY_EXECUTION_STORE_PATH`-adjacent dedicated
  directory (implementation detail for I5), gitignored like the execution
  store; never inside `data/audit-log.jsonl`.

# Confirmation Semantics

**§19/Q6 — local `confirmed` threshold (verbatim):** official status
`confirmed` OR `completed` (onchain). `received` and `batched` are NOT
sufficient (they mean funds locked/queued, not settled). Document that
`completed` is stronger than `confirmed` and that the exact difference is not
fully specified by Circle.

- `confirmed` = "Transfer has been confirmed onchain"; `completed` = "Transfer
  is fully complete". Both satisfy the local `confirmed` threshold;
  `received`/`batched` do not.
- The settle-response `success:true` alone does NOT confirm settlement — it
  confirms acceptance; the transfer must be observed (reconcile or poll)
  reaching `confirmed`/`completed` before the local `confirmed` transition.
- Local `confirmed` is only ever reached through durable SettlementEvidence
  with `gatewayTransferStatus ∈ { confirmed, completed }` and a persisted
  digest.

# Failure Semantics

- Local `failed` = **known deterministic rejection**: valid settle response
  `success:false` with a mapped `errorReason` (e.g. `nonce_already_used`,
  `amount_mismatch`, `address_mismatch`, `invalid_signature`,
  `authorization_expired`, `unsupported_*`, `insufficient_balance`), HTTP 4xx,
  or a local gate/signing rejection before send (`prepare`/`sign` failure
  stages).
- Anything ambiguous (timeout, reset, 5xx, malformed response, success without
  durable write, crash-after-submitted) is `remote_outcome_unknown`, NEVER
  `failed`.
- The I3 failure stages (`prepare | sign | submit | settle`) remain; `settle`
  failures split into deterministic (`failed`) and ambiguous
  (`remote_outcome_unknown`).

# Executed-Spend Reconciliation

**§22/Q8 — ExecutedSpendSummary (verbatim):** `authorizedAmount`,
`settledAmount` (confirmed+completed), `failedAmount` (known-rejected),
`unknownAmount` (remote_outcome_unknown, kept SEPARATE and at-risk, never
counted as zero nor as settled). Per authorizationId + agentId. It is
**read-only**, **derived from durable SettlementEvidence**; it is SEPARATE
from proposed-intent policy spend accounting.

- Read-only: reconciliation never mutates SettlementEvidence or the execution
  store; it only aggregates.
- `settledAmount` counts only evidence with official status
  `confirmed`/`completed`; `failedAmount` counts known rejections;
  `unknownAmount` counts `remote_outcome_unknown` records and is reported
  explicitly as at-risk (may later become settled via reconciliation).
- Policy spend controls (per-request/daily/velocity over canonical ALLOW
  evidence) remain proposal-intent accounting and are NOT replaced by
  ExecutedSpendSummary; the two are kept distinct.

# Identity Residual

- `agentId` remains **self-asserted, unauthenticated input** (ADD-1). It
  stays RESIDUAL PRODUCTION CONTROL: acceptable for the bounded testnet proof
  and does NOT block I5 or I6; a production deployment requires a real
  authenticated principal model.
- The cryptographic identity on the payment path is the **payer EOA**,
  recovered by viem `recoverTypedDataAddress` in I4 and recorded as
  `payerAddress` in SettlementEvidence. `agentId` (logical) and `payerAddress`
  (crypto) are distinct; mapping is explicit and never conflated.
- I5 derives execution identity from **I3 evidence only** (prepared record →
  nonce → payer binding), never from raw request fields (no raw-request
  bypass).

# Key-Management Boundary

- The EIP-3009 private key exists **only** in the external signer process
  (`scripts/x402-external-signer.mjs`, from its own
  `AGENTPAY_X402_SIGNER_PRIVATE_KEY` env); Guard `src/` never sees key
  material, and no key/signature is ever persisted to the execution store,
  SettlementEvidence store, or audit log.
- This is a **bounded reference test signer**, NOT production key management
  (no HSM/hardware wallet, no key rotation, no production custody) — a
  documented residual; it does not block the testnet proof.
- I5 MUST NOT introduce any key handling in Guard core; the Gateway client is
  keyless (Gateway API is permissionless — no API key).

# Protocol Verification / Simulation Requirement

**§26/Q9 (verbatim):** "Transaction simulation before signing" is
PROTOCOL-INCORRECT for x402 Gateway. EIP-3009 is an offchain signature (no
gas, no onchain simulation before signing; the facilitator pays gas). The
precondition is rewritten to: **"Independent protocol validation before
irreversible settlement submission"** — concretely:

1. I1 strict `PaymentRequirement` validation (typed, unknown-field rejection);
2. I2 execution security gate (expiry, requirement-digest, network/asset/
   domain/amount/recipient binding, fail-closed);
3. EIP-712 domain match (name `GatewayWalletBatched`, version `1`, chainId
   5042002, verifyingContract `0x0077...19B9`) against the policy allowlist;
4. viem `recoverTypedDataAddress` payer recovery (already in I4).

Cite the official seller quickstart ("Use settle() directly rather than
calling verify() followed by settle() in production flows") — the validation
that matters happens locally before the irreversible settle submission;
Gateway `/v1/x402/verify` is not a substitute for local gate enforcement and
is not part of the required path.

# Fee-Bound Requirement

**§27/Q10 (verbatim):** Adapter fee bounds = **NOT APPLICABLE TO THE EXACT
NANOPAYMENT PATH.** Payer authorizes exactly `PaymentRequirements.amount`; the
facilitator absorbs the gas via batched settlement; no per-payment execution
fee changes the authorized amount. (The one-time onchain deposit gas and
seller withdrawal fees are separate documented costs, out of scope.)

- The settle request carries exactly the requirement amount; `amountAtomic`
  in SettlementEvidence must equal the authorized amount exactly.
- Deposit gas (one-time onchain deposit into the Gateway Wallet) and seller
  withdrawal fees (moving the balance out) are documented Circle costs but
  outside the bounded adapter slice; no `maxFee` enforcement is required on
  this path.

# Network / Endpoint Restrictions

- **Testnet-only host enforcement (I5.2):** the Gateway client may only
  target `https://gateway-api-testnet.circle.com` (host-allowlisted HTTPS);
  mainnet `https://gateway-api.circle.com` is FORBIDDEN in this track.
- Network CAIP-2 must equal the allowlisted `eip155:5042002` (Arc Testnet) on
  every request/response; asset must equal Arc Testnet USDC
  `0x3600000000000000000000000000000000000000`; EIP-712 verifyingContract
  must equal `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`.
- I5 makes **no Arc RPC calls** (no `https://rpc.testnet.arc.io`); chain
  verification is via Gateway responses + explorer-verifiable batch txHash
  (out-of-band, I6). No other external hosts.
- Read-only endpoints used for reconciliation: `GET /v1/x402/transfers/{id}`,
  `GET /v1/x402/transfers?nonce=` (same allowlisted host).

# HTTP Client Requirements

- Strict typed Gateway client matching the official OpenAPI request/response
  shapes (I5.1); request = `{ paymentPayload, paymentRequirements }` only, no
  top-level `x402Version`.
- Host-allowlisted HTTPS; TLS enforced; no redirect following across hosts.
- **Bounded timeout**; on timeout the outcome is UNKNOWN (never failed).
- **No generic automatic retry middleware** (see Retry Policy).
- Strict response validation before any state change: required fields present
  (`success`, `transaction`, `network`), `network` == `eip155:5042002`,
  `errorReason` ∈ official enum when `success:false`, `transaction` is a UUID
  on success / empty on failure.
- Response `transaction` (transfer UUID) is recorded as `gatewayTransferId`;
  on-chain `txHash` comes from the transfer lookup (batch-level, null until
  batched) — the settle response itself carries no on-chain hash.
- The client never logs or persists the signed payload, the signature, or any
  key material; only validated evidence fields and digests are stored.

# Secret / Logging Rules

- NEVER print, store, log, or include in any record: private keys, raw EIP-3009
  signatures, or the full signed `PaymentPayload`. `signerPayloadDigest`
  (`sha256:<64 hex>`) is the only payload-derived value persisted.
- `AGENTPAY_X402_SIGNER_PRIVATE_KEY` exists only in the external signer
  process env; it must never appear in `.env.example`, the repo, execution
  store, SettlementEvidence store, audit/observation logs, or CI.
- `.env`, `.env.*`, `data/execution-store/`, and the settlement-evidence
  directory are gitignored; no secrets in source control (unchanged global
  rule).
- Logs (audit, observation, execution events) record digests, state
  transitions, reason codes, and official evidence fields — never signatures,
  never full payloads, never key material.

# 14-Precondition Matrix

Statuses: IMPLEMENTED LOCALLY / PARTIALLY IMPLEMENTED / NOT IMPLEMENTED /
PROTOCOL-ADAPTED REQUIREMENT / NOT APPLICABLE TO BOUNDED PATH / RESIDUAL
PRODUCTION CONTROL.

| Precondition | Current status after I4 | Required before I5 code | Required before I6 live payment | Evidence |
| --- | --- | --- | --- | --- |
| 1. Runtime authorization expiry enforcement | IMPLEMENTED LOCALLY (I2 gate + I4 pre-signer recheck) | I5 MUST add the pre-settle expiry recheck (I5.3: after loading durable state, immediately before send) | Verified end-to-end in the live submission path | `src/domain/x402/execution-security-gate.ts`; `sign-prepared-x402-execution.ts`; pre-i5-security-review.md |
| 2. Exact authorization-to-adapter input binding | IMPLEMENTED LOCALLY (I2 gate typed-objects-only, direct requirement-digest commitment) | Keep; I5 consumes only I3 prepared-record evidence + typed contract | Verified end-to-end; negative criteria J | `execution-security-gate.ts`; I2 record; evidence.md |
| 3. Recipient / amount / asset / chain / route enforcement | IMPLEMENTED LOCALLY (I2 gate: payTo, exact 6-decimal amount, asset/domain allowlist) | Keep; Gateway request built only from validated requirement | Verified end-to-end; negative criteria C/D/E | `execution-security-gate.ts`; I2 record |
| 4. Single-use / duplicate-execution protection | IMPLEMENTED LOCALLY (I3 single-use consumption + deterministic nonce registry) | Keep; reconcile path must use the nonce (never re-sign an accepted nonce) | Gateway nonce-enforcement PROOF via a live duplicate attempt (I6) | `execution-store.ts`; I3 record |
| 5. Durable cross-process idempotency | IMPLEMENTED LOCALLY for the execution store (I3 O_EXCL); canonical audit T14 cross-process still RESIDUAL | I5 SettlementEvidence store uses the same write-exclusive pattern; canonical audit unchanged | Canonical audit concurrency remains a documented production residual | `execution-store.ts`; pre-i5-security-review.md |
| 6. Actual executed-spend accounting | NOT IMPLEMENTED (blocker 3) | REQUIRED: read-only `ExecutedSpendSummary` from durable SettlementEvidence (settled/failed/unknown buckets) | Live amounts reconciled; report per authorizationId + agentId | pre-i5-security-review.md (Executed-Spend Reconciliation) |
| 7. Authenticated principal / agent identity model | RESIDUAL PRODUCTION CONTROL (self-asserted `agentId`; ADD-1) | NOT required (documented; do not block) | NOT required for bounded testnet proof; REQUIRED before any production use | ADD-1 row in threat-model.md; pre-i5-security-review.md (Identity Residual) |
| 8. Protected key-management boundary outside Guard core | IMPLEMENTED LOCALLY (bounded reference test signer; key only in `scripts/x402-external-signer.mjs` env; Guard `src/` keyless) | Keep; I5 adds no key handling; SettlementEvidence stores no keys/signatures | Production key management remains a documented residual | I4 record; evidence.md; pre-i5-security-review.md |
| 9. Transaction simulation before signing | PROTOCOL-ADAPTED REQUIREMENT — rewritten to "Independent protocol validation before irreversible settlement submission" (I1 + I2 gate + EIP-712 domain match + viem `recoverTypedDataAddress` payer recovery) | Keep; no onchain simulation (EIP-3009 is offchain; facilitator pays gas) | Re-verify official facts on the live path | seller quickstart (settle directly); pre-i5-security-review.md (Q9) |
| 10. Explicit network allowlist | IMPLEMENTED LOCALLY (I2: Arc Testnet `eip155:5042002` / USDC / Gateway domain) | Keep; I5 client host-allowlisted to `gateway-api-testnet.circle.com` only | Verified end-to-end; negative criterion K | `data/policies.default.json`; I2 record |
| 11. Adapter-specific fee bounds | NOT APPLICABLE TO BOUNDED PATH (payer authorizes exactly `amount`; facilitator absorbs gas via batched settlement; deposit gas / withdrawal fees are separate documented costs) | N/A | N/A (re-confirm if the path changes) | pre-i5-security-review.md (Q10); Circle nanopayments/fees docs |
| 12. Durable execution outcome evidence | NOT IMPLEMENTED (blocker 2) | REQUIRED: SettlementEvidence contract + durable store (Option B), digest before `confirmed` | Live outcome evidence durably recorded and explorer-verifiable | pre-i5-security-review.md (SettlementEvidence Contract / Durable Settlement Evidence) |
| 13. No raw-request bypass | IMPLEMENTED LOCALLY (I2 gate consumes only validated typed objects) | Keep; I5 derives execution identity from I3 evidence only | Verified end-to-end; negative criterion J | `execution-security-gate.ts`; I2 record |
| 14. Threat-model re-review before enabling broadcast | THIS REVIEW (2026-08-17): in progress → COMPLETED (GO WITH BLOCKERS) | Completed by this document; I5 frozen accordingly | Final operator security review sign-off on the pre-broadcast checklist | pre-i5-security-review.md |

# Pre-Broadcast Checklist

All items unchecked by this review — they are the operator gate before any
real testnet submission (I6):

[ ] current policyVersion = 3
[ ] I1 strict requirement validation passes
[ ] I2 local security gate passes
[ ] v2 requirement commitment matches
[ ] Guard authorization not expired
[ ] I3 first/single execution claim exists
[ ] deterministic nonce claim exists
[ ] execution state is valid
[ ] I4 cryptographic signer verification passes
[ ] payer matches trusted test EOA
[ ] network = Arc Testnet
[ ] asset = approved Arc Testnet USDC
[ ] payTo = trusted test seller binding
[ ] amount exactly matches authorization
[ ] Gateway EIP-712 domain matches policy
[ ] duplicate/ambiguous retry strategy implemented
[ ] remote response validator implemented
[ ] durable SettlementEvidence implemented
[ ] executed-spend reconciliation implemented
[ ] no raw-request bypass
[ ] no private key in Guard core
[ ] testnet-only host enforcement
[ ] unknown remote outcome state handled safely
[ ] final operator security review signed off

# I5 Frozen Scope

- I5.1 Gateway request/response contract (typed, matches official OpenAPI)
- I5.2 strict testnet Gateway client (host-allowlisted HTTPS, bounded timeout,
  no generic retry)
- I5.3 Guard-expiry pre-submit recheck (now < expiresAt, after loading durable
  state, immediately before send)
- I5.4 remote-result / ambiguous-outcome state handling (remote_outcome_unknown;
  reconcile by nonce)
- I5.5 SettlementEvidence (strict typed contract)
- I5.6 durable SettlementEvidence store (immutable, keyed by authorizationId,
  nonce index)
- I5.7 settlement-evidence digest → I3 confirmed transition (persist BEFORE
  confirmed)
- I5.8 executed-spend reconciliation (read-only ExecutedSpendSummary)
- I5.9 mocked/fixture integration tests (NO funds moved)
- I5.10 operator-gated testnet submission path (explicit operator action only;
  not in CI)

# Live Payment Boundary

**LIVE PAYMENT IN I5: FORBIDDEN — FIRST LIVE PAYMENT IS I6.**

I5 implements the real adapter + persistence/recovery controls; automated
tests/CI never move funds. Any live testnet settlement path requires an
explicit operator action + test-only signer setup (I5.10 / I6). This review
authorizes neither I5 implementation work (that is the implementation
worker's job) nor any funds movement.

# GO / GO WITH BLOCKERS / NO-GO

**GO WITH BLOCKERS.**

Rationale:

- The official path remains fully supported (Gateway x402 → Arc Testnet,
  permissionless API, EOA signing outside Guard core) — re-verified
  2026-08-17.
- The current I1–I4 surface is consistent with the frozen I5 design: local
  gate + durable execution state + offline signer + cryptographic payer
  recovery; no code conflicts with the SettlementEvidence / reconciliation /
  unknown-outcome model.
- The four blockers are concrete, well-scoped I5 code changes; none requires
  turning Guard into a custody or payment platform.
- NO-GO would require a finding that the path is infeasible or that a blocker
  is unsatisfiable — none exists. GO (unconditional) is wrong because the
  blockers are real and MUST land before any real `/settle`.

**Answers to the 14 blocking questions (Q1–Q14):**

1. **Q1 — Can the current I3 state machine safely represent an unknown
   Gateway outcome?** NO — the current `prepared | submitted | confirmed |
   failed` machine cannot safely represent an unknown remote outcome; add
   `remote_outcome_unknown` (distinct from `failed`) before I5 code (blocker
   1). `failed` means known deterministic rejection; a transport timeout after
   the request left the process is UNKNOWN, not failed.
2. **Q2 — Does current `submitted` naming create unsafe remote-submission
   ambiguity?** YES, it is ambiguous; resolved by KEEPING `submitted` with the
   formal definition "signed payload committed to the LOCAL execution
   lifecycle, NOT remote submission", and distinguishing Gateway acceptance
   only via SettlementEvidence.
3. **Q3 — Can a lost transient signed payload be safely
   reconstructed/re-signed?** NO — re-signing after a crash is unsafe (see
   "Signature re-creation determinism" under I4 Payload Recovery / Liveness):
   the validity window is derived from `now` at signing time and is not
   currently persisted, so re-signing with a fresh `now` yields a different
   message bound to the same deterministic nonce. FROZEN DECISION: do NOT
   re-sign — reconcile by nonce or require a fresh-authorization lineage.
4. **Q4 — How is duplicate remote settlement prevented after an HTTP
   timeout?** No blind retry; reconcile via `GET /v1/x402/transfers?nonce=`;
   Gateway rejects `nonce_already_used` (retry with the identical signed
   payload is rejected-not-idempotent; exact retry response unspecified); the
   I3 single-use + deterministic nonce registry is REQUIRED (Gateway
   enforcement proof = I6).
5. **Q5 — Which durable remote identifier can be queried before retry?** The
   deterministic EIP-3009 nonce (primary, always available), then the transfer
   UUID (after acceptance).
6. **Q6 — What exact Gateway status is sufficient for local `confirmed`?**
   Official `confirmed` OR `completed` (onchain); `received`/`batched` are NOT
   sufficient (they mean funds locked/queued, not settled); `completed` is
   stronger than `confirmed` and the exact difference is not fully specified
   by Circle (documented).
7. **Q7 — Must SettlementEvidence be durable BEFORE the I3 confirmed
   transition?** YES. Order: remote outcome → validate → build normalized
   evidence → persist durably → compute `sha256:<64 hex>` digest → mark
   confirmed with that digest.
8. **Q8 — How are executed and unknown-outcome amounts reconciled?** Via
   read-only `ExecutedSpendSummary`: `authorizedAmount`, `settledAmount`
   (confirmed+completed), `failedAmount` (known-rejected), `unknownAmount`
   (remote_outcome_unknown, kept SEPARATE and at-risk, never counted as zero
   nor as settled); per authorizationId + agentId; derived from durable
   SettlementEvidence; SEPARATE from proposed-intent policy spend accounting.
9. **Q9 — Is the old "transaction simulation before signing" requirement
   protocol-correct for x402 Gateway?** NO — PROTOCOL-INCORRECT (EIP-3009 is
   an offchain signature; no gas; no onchain simulation before signing; the
   facilitator pays gas). Rewritten to "independent protocol validation before
   irreversible settlement submission": I1 strict requirement validation + I2
   gate + EIP-712 domain match + viem `recoverTypedDataAddress` payer recovery
   (already in I4). Cite the seller quickstart: use `settle()` directly rather
   than `verify()` then `settle()`.
10. **Q10 — Are adapter fee bounds applicable to this exact nanopayment
    path?** NOT APPLICABLE — the payer authorizes exactly
    `PaymentRequirements.amount`; the facilitator absorbs gas via batched
    settlement; no per-payment execution fee changes the authorized amount.
    (One-time onchain deposit gas and seller withdrawal fees are separate
    documented costs, out of scope.)
11. **Q11 — Can I5 keep Guard core keyless?** YES — the key stays only in the
    external signer process env (`AGENTPAY_X402_SIGNER_PRIVATE_KEY` in
    `scripts/x402-external-signer.mjs`); the Gateway client is keyless
    (permissionless API).
12. **Q12 — Can I5 remain Arc-Testnet-only by construction?** YES — host
    allowlist `gateway-api-testnet.circle.com`, network `eip155:5042002`,
    asset/verifyingContract pinned, mainnet (`gateway-api.circle.com`)
    forbidden.
13. **Q13 — Can CI remain permanently incapable of moving funds?** YES —
    `pnpm test`/`build`/`smoke` never make a real Gateway settlement; any
    live testnet path requires an explicit operator action + test-only signer
    setup (I5.10 / I6).
14. **Q14 — Should first real funds movement occur in I5 or I6?** I6 — LIVE
    PAYMENT IN I5: FORBIDDEN; the first live payment is I6.

# Blocking Findings

The four blocking findings (each a MUST before any real `/settle`):

1. **State machine cannot represent unknown remote outcomes** — `failed` means
   "known deterministic rejection"; a transport timeout after the request left
   the process is UNKNOWN, not failed. Add `remote_outcome_unknown` (I3
   extension) before I5 code (Q1, Q4, §21).
2. **No SettlementEvidence contract or durable store exists** — blocker 2:
   implement the strict typed contract + immutable, separate,
   authorizationId-keyed, nonce-indexed store in I5 (Q3, Q7, §17).
3. **No executed-spend reconciliation exists** — blocker 3: read-only
   `ExecutedSpendSummary` (settled/failed/unknown buckets) from durable
   SettlementEvidence (Q8, §22).
4. **No payload recovery/liveness design** — blocker 4: persist
   validAfter/validBefore in the I3 record OR require fresh-authorization
   lineage for crash-after-submitted; never persist private keys or raw
   signatures (Q3, Q5, §I4).

Supporting findings (non-blocking but frozen):

- `received`/`batched` are not settlement; local `confirmed` requires official
  `confirmed`/`completed` (Q6).
- Duplicate-nonce retry is rejected-not-idempotent and its exact response is
  unspecified; I3 single-use + nonce registry is REQUIRED, Gateway
  nonce-enforcement proof is I6 (Q4, Q5).
- payment-identifier is not advertised (extensions:[] on 2026-08-17) — do not
  rely on it (documented under Duplicate Settlement Protection).
- Circle's minimum-validity docs conflict (604800 live / 604900 SDK / "3 days"
  howto); honor 604800 (documented).
- Timeout / at-least-once acceptance is NOT documented; reconcile on every
  ambiguous outcome (Q4, §Ambiguous Remote Outcome).

# Residual Production Risks

- **Authenticated agent identity** (ADD-1) — self-asserted `agentId`;
  RESIDUAL PRODUCTION CONTROL, acceptable for bounded testnet proof; required
  before production.
- **Production key management** — the external signer is a bounded reference
  test signer, not HSM/hardware-wallet/production custody.
- **Canonical audit log cross-process concurrency** (T14) and
  **tamper-evidence** (T13) — unchanged residuals; I3/I5 fix only the NEW
  execution-state and settlement-evidence stores.
- **Timeout / at-least-once acceptance undocumented by Circle** — post-timeout
  acceptance is plausible (inference from lifecycle docs) but not guaranteed;
  mitigated by nonce-keyed reconciliation + `remote_outcome_unknown`.
- **Duplicate-nonce retry response unspecified** — mitigated by never
  re-signing an accepted nonce and by fresh-authorization lineage.
- **payment-identifier extension not advertised** — no server-side response
  caching to lean on; idempotency is app-level.
- **Circle minimum-validity doc conflict** — honored 604800; re-verify on the
  live path (I6).
- **Explorer verification** — batch `txHash` is batch-level, shared, null
  until batched; per-payment identity is transfer UUID + nonce.
- **Deposit gas / seller withdrawal fees** — separate documented costs, out of
  scope for the adapter, but real for any operator funding the test wallet.

# Next Action

- This review is COMPLETE and freezes the I5 design. The next action is the
  **I5 implementation** by the implementation worker, in blocker order:
  (1) I3 `remote_outcome_unknown` state-machine extension; (2)
  SettlementEvidence contract + durable store; (3) executed-spend
  reconciliation; (4) payload recovery/liveness — then the I5.1–I5.10 scope
  items, with mocked/fixture tests only (I5.9, no funds moved).
- A separate worker runs validation (`pnpm test`/`build`/`smoke`) and
  commit/push; this review made no code changes and no commits.
- **I6** (first live testnet payment + positive/negative proof) follows only
  after I5 is implemented and the pre-broadcast checklist is satisfied with a
  final operator security review sign-off.
