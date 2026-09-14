# Threat Model — Circle Grants Pilot (Phase 7; current scope: I1–I5)

Engineering threat model for the AgentPay Guard pilot boundary on branch
`grant/circle-grants-pilot-2026`. Every control claim below was verified against the
current source before being written; file:line citations point at the evidence.
This is an internal engineering verification, not an independent external security
audit.

**Current scope: I1–I5** (2026-09-15). This document was originally written at the
Phase 7 no-execution checkpoint and has been updated in place as the integration
track landed I1 (payment-requirement contract), I2 (execution security gate), I3
(durable execution store), I4 (offline external EOA signer), and I5 (bounded
Circle Gateway settlement layer — testnet-capable, MOCK-VERIFIED; the
authoritative record is
[x402-gateway-settlement.md](./x402-gateway-settlement.md) and the status note
is under "Future Execution Preconditions" below). Guard `src/` remains keyless;
its only outward network path is the operator-gated, host-pinned Gateway
testnet HTTPS client. NO live payment has been executed and no funds have
moved (I6). The PRE-I5 security re-review (2026-08-17) is recorded in
[pre-i5-security-review.md](./pre-i5-security-review.md).

# Scope

In scope:

- **Proposed payment intents** — validated `PaymentIntent` objects
  (`src/domain/payment-intent/validation.ts:124-157`), including optional
  operation/spender/amountBaseUnits/routeContext proposal fields.
- **Deterministic policy evaluation** — the `ALLOW` / `REVIEW` / `BLOCK` engine
  (`src/domain/policy/engine.ts`) and its spend controls
  (`src/domain/policy/spend-controls.ts`).
- **Spend controls** — per-request, daily, and velocity limits.
- **Audit evidence** — canonical JSONL audit records
  (`src/domain/audit/audit-log.ts`).
- **Intent / policy fingerprints** — `sha256` over canonicalized JSON
  (`src/domain/payment-intent/intent-fingerprint.ts`,
  `src/domain/policy/policy-fingerprint.ts`, `src/lib/stable-json.ts`).
- **Replay evidence** — idempotent reuse and mismatch/drift signals
  (`src/domain/audit/replay-evidence.ts`).
- **ExecutionAuthorization evidence** — the typed envelope built from persisted
  audit records (`src/domain/authorization/execution-authorization.ts`).
- **Local pilot observability** — evaluation-observation log and metrics
  (`src/domain/observability/*`).
- **Judge UI evidence** — presentation of the above in the demo client
  (`src/app/demo-client.tsx`, `src/app/api/*`).

Excluded from scope because the capabilities DO NOT exist in this repository —
with one I4 qualification: **transaction signing now exists, but ONLY offline
in `scripts/x402-external-signer.mjs`** (the external signer process, I4), never
in Guard `src/` core. Still absent: custody, private-key security in `src/`,
wallet connection, RPC transaction submission, LIVE x402 settlement (no real
payment has ever been executed), CCTP burn/mint, UserOperation submission, and
a production authorization service. I5 qualification (2026-09-15): **Circle
Gateway settlement code now exists** in `src/integrations/circle-gateway/*` +
`src/domain/x402/gateway-*.ts` — testnet-capable, host-pinned, operator-gated,
MOCK-VERIFIED only, never wired into `src/app/**`, and never exercised live.

## I1–I4 pre-settlement execution surface (surface as of 2026-08-17; I5 changes noted below)

The current repository contains a bounded, PRE-SETTLEMENT execution surface
that did not exist at the Phase 7 checkpoint. It is in scope for this threat
model:

- **Offline EIP-3009 signing** — the external signer tool
  `scripts/x402-external-signer.mjs` performs a real local EIP-712 signature
  over `TransferWithAuthorization` typed data (I4). This is the ONLY signing
  capability in the repository.
- **External-signer private-key trust boundary** — the key exists only in the
  signer process env (`AGENTPAY_X402_SIGNER_PRIVATE_KEY`); Guard `src/` knows
  only the `X402ExternalSigner` interface and never sees key material
  (`src/domain/x402/external-signer.ts`,
  `src/domain/x402/sign-prepared-x402-execution.ts`).
- **Execution store (I3 durable state, extended in I5)** —
  `src/domain/x402/execution-store.ts` persists
  `prepared | submitted | remote_outcome_unknown | confirmed | failed` events,
  the deterministic EIP-3009 nonce registry, and the signed-payload digest
  (`signerPayloadDigest`) — never the signature or the key.
- **Transient signed x402 `PaymentPayload` (I4)** — built in memory at signing
  time; only its `sha256:<64 hex>` digest is committed to the execution store;
  the payload itself is never persisted.
- **Cryptographic payer recovery** — Guard verifies the signer-produced
  signature with viem `recoverTypedDataAddress` against the exact locally
  constructed typed data; the recovered address must equal the trusted
  `X402PayerBinding.payerAddress`.
- **STILL ABSENT (pre-I5 statement, dated 2026-08-17):** Gateway HTTP calls,
  Arc RPC calls, settlement, and any funds movement; I5 (Gateway client +
  SettlementEvidence) and I6 (first live payment) were NOT implemented; see
  [pre-i5-security-review.md](./pre-i5-security-review.md). **SUPERSEDED for
  I5 by the 2026-09-15 I5 note below:** the Gateway testnet client,
  settlement orchestration, and durable SettlementEvidence now exist
  (mock-verified, operator-gated). **UNCHANGED:** no Arc RPC call path exists
  in `src/`, and funds movement remains absent — it requires I6 (first live
  payment), which has not happened.

## Static execution-surface review

Repository scan of `src/` and `package.json` for signing, broadcast, RPC, wallet,
and key-management capabilities:

- `package.json` dependencies are `next`, `react`, `react-dom`, and `viem`
  (`^2.55.16`) — no ethers/axios. `viem` is used only for offline EIP-712
  typed-data signing (external signer tool) and signature recovery
  (`recoverTypedDataAddress` in `src/domain/x402/sign-prepared-x402-execution.ts`);
  it is never used for network/RPC calls.
- No Guard `src/` runtime code signs, broadcasts, submits transactions, stores
  private keys, connects wallets, calls blockchain RPC, executes CCTP, or
  submits UserOperations. The single repository exception is the external
  signer tool `scripts/x402-external-signer.mjs`, which performs real offline
  EIP-712 signing outside `src/` (I4; key never in `src/`). Every keyword hit
  in `src/` is one of:
  - **Type literals** — `executionStatus: "not_executed"` and `broadcast: false`
    (`src/domain/payment-intent/types.ts:103-110`,
    `src/domain/authorization/execution-authorization.ts:101-103`).
  - **Preview/explanation strings** — rail-preview and receipt safety text
    (`src/domain/payment-intent/rail-preview.ts:14-24`,
    `src/domain/payment-intent/receipt.ts:6-7`).
  - **Local simulation objects** — `arc-testnet-simulation.ts` returns
    `broadcast: false, status: "not_executed"` with an explicit
    "No RPC call, transaction signing, broadcast, or USDC movement occurred"
    explanation (`src/domain/payment-intent/arc-testnet-simulation.ts`).
  - **UI text** — demo copy such as "No wallet signing" / "No private keys"
    (`src/app/demo-client.tsx:574-576`) and the authorization safety line
    (`src/app/demo-client.tsx:513`).
- Network calls in the app path are limited to same-origin `fetch()` against
  the app's own `/api` routes (`src/app/demo-client.tsx:129,149,169,257`) and
  the local smoke script's `fetch(baseUrl + "/api/payment-intents/evaluate")`
  (`scripts/smoke.mjs:53`). I5 adds exactly one outward network capability:
  the host-pinned Gateway **testnet** HTTPS client
  (`src/integrations/circle-gateway/testnet-client.ts`,
  `gateway-api-testnet.circle.com` compile-pinned, no URL option), reachable
  only through the operator gate (`--live` + exact-string env); it is not
  imported by `src/app/**` and has never been exercised live.

Docs, strings, types, and previews are explicitly distinguished from runtime
execution code above. There is no execution code in `src/` to distinguish them
from; the only real signing code in the repository lives in the external signer
tool (`scripts/x402-external-signer.mjs`), outside `src/`.

# Protected Assets

- **A — Policy decision integrity.** An `ALLOW`/`REVIEW`/`BLOCK` decision is not
  altered by unrelated layers: the persisted audit record is the single source of
  the response decision (`src/domain/payment-intent/evaluate.ts:57-83`), and a
  replayed key returns the stored decision as historical evidence rather than
  overwriting it (`src/domain/audit/audit-log.ts:91-93`).
- **B — Intent identity.** `agentId`, `recipient`, `amount`, `route`,
  `operation`, and `idempotencyKey` are bound together in a deterministic
  fingerprint (`src/domain/payment-intent/intent-fingerprint.ts:5-18`); changing
  any bound field changes the fingerprint.
- **C — Policy attribution.** `policyId` / `policyVersion` / `policyFingerprint`
  are persisted per record and compared against the currently loaded policy
  (`src/domain/audit/audit-log.ts:72-74`, `src/domain/audit/replay-evidence.ts:23-34`).
- **D — Canonical audit evidence.** Exactly one decision record per
  `idempotencyKey` in-process; replays return the existing record
  (`src/domain/audit/audit-log.ts:86-93`).
- **E — ExecutionAuthorization constraints.** The envelope binds a single intent,
  agent, recipient, amount, policy attribution, prepare/simulate scope, and
  issuedAt/expiresAt metadata (`src/domain/authorization/execution-authorization.ts:7-31`).
- **F — Safety boundary.** `executionStatus: "not_executed"` and
  `fundsMoved: false` are literal types, not runtime values
  (`src/domain/authorization/execution-authorization.ts:29-30,102-103`).
- **G — Pilot metrics integrity.** Canonical decision counts come from audit
  records while evaluation-attempt counts come from the observation log; the two
  sources are never conflated (`src/domain/observability/pilot-metrics.ts`:
  `canonicalIntentCount` from `auditRecords`, `observedEvaluationAttemptCount`
  from `observations`).

# Trust Boundaries

- **UNTRUSTED / caller-controlled** — the incoming HTTP JSON body and every field
  it carries: `agentId`, `recipient`, `amount`, `scenario`, `paymentRail`,
  optional programmable route fields (`operation`, `spender`, `amountBaseUnits`,
  `routeContext`), and `idempotencyKey`. These are the only inputs to validation;
  anything else in the body is ignored (see T15).
- **TRUSTED local application** — the validated `PaymentIntent`, the loaded local
  policy config, the policy engine, the audit writer, and the authorization
  builder. This trust covers the code in `src/domain/**` and `src/app/api/**` as
  executed by this process.
- **LOCAL FILESYSTEM** — policy JSON (`data/policies.default.json`), audit JSONL,
  and observation JSONL. **This is an explicit trust assumption**: these files are
  not cryptographically signed, not tamper-evident, not remotely attested, and not
  backed by an append-only external datastore. Any process or user able to write
  to `data/` is inside the trust boundary (see T12, T13, ADD-2).

# Attacker / Failure Capabilities

An attacker is anyone or anything that can:

- Manipulate caller-controlled input — **any** fields, including `idempotencyKey`
  (the key is accepted verbatim; there is no server-side key derivation).
- Write to the local filesystem as the same user or by tampering with files
  (`data/audit-log.jsonl`, `data/evaluation-observations.jsonl`,
  `data/policies.default.json`).
- Modify the policy file (content or version/fingerprint fields).
- Crash the process mid-write.
- Run concurrent evaluation processes against the same audit file.
- Cause the observation writer to fail (e.g. read-only filesystem, full disk).
- Supply malformed local files (corrupt JSONL lines).

Stated plainly (2026-08-17 wording, updated 2026-09-15 for I5): there is a
**settlement-capable execution surface**: real local EIP-3009 signing exists in
the external signer tool (`scripts/x402-external-signer.mjs`), the I3
execution store holds durable execution state, and I5 adds durable
settlement-evidence + executed-spend stores plus a host-pinned,
operator-gated Gateway testnet client. Guard `src/` remains keyless; nothing
in `src/` broadcasts or moves funds, and the Gateway client is unreachable
without the explicit `--live` + exact-string env operator authorization (no
CI or app path enables it). The strongest attacker outcome today remains
corrupted or misleading local evidence, a withheld authorization, or a
malicious/misconfigured external signer being caught by cryptographic payer
recovery — never fund movement. Fund movement still requires I6 (first live
payment): I5's settlement layer is implemented but has NEVER executed a real
`POST /v1/x402/settle`.

# Threat Matrix

| ID | Threat | Current Control | Status | Verification | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| T01 | Exact replay of the same intent/key | One canonical line per key; replayed intent returns the stored record (`replayed:true`); `replayMismatch:false`, `policyChanged:false`; same `auditId`; same deterministic `authorizationId`; no duplicate canonical evidence | MITIGATED | `audit-log.ts:91-93`; `replay-evidence.ts:29-34`; `execution-authorization.ts:66-78`; `canonical-scenarios.md` REPLAY row | None for evidence idempotency. Replay is idempotent reuse, not independent decision reproducibility (see pilot-observability.md) |
| T02 | Same key, different intent (idempotency-key mismatch) | Stored vs current `intentFingerprint` differ → `replayMismatch:true` → stored decision preserved as historical evidence → authorization withheld → no second canonical line | MITIGATED | `replay-evidence.ts:29-30`; `evaluate.ts:42-45`; `audit-log.ts:89-93` | None for authorization suppression. Note: recipient STRING equality is not proof of real-world recipient identity — the fingerprint binds the literal string only |
| T03 | Recipient substitution under the same key | Recipient is a fingerprint field (`intent-fingerprint.ts:10`); substitution → `replayMismatch:true` → no authorization, historical decision preserved | MITIGATED | `intent-fingerprint.ts:5-18`; `evaluate.ts:42-45` | Same as T02: string-level binding, not identity-level |
| T04 | Amount substitution under the same key | Amount is a fingerprint field; `maxAmountUSDC` = persisted proposed amount (`audit.amountUSDC ?? audit.amount`), never the policy maximum — prevents envelope-level amount expansion | MITIGATED | `intent-fingerprint.ts:8`; `execution-authorization.ts:65` | There is **no external executor** enforcing this envelope — no executor exists. The envelope is evidence for a future adapter, not an enforced limit |
| T05 | Route / operation / fee substitution | `routeContext` (whole object), `operation`, `spender`, `amountBaseUnits` participate in the fingerprint when present (`intent-fingerprint.ts:14-17`); same-key route change → `replayMismatch:true` → no auth. CRITICAL nuance: `authorizationId` does NOT hash `programmablePaymentContext` fields directly — it is `sha256` over `[intentId ?? idempotencyKey, idempotencyKey, auditId, agentId, recipient, maxAmountUSDC, paymentRail, policyVersion, policyFingerprint, issuedAt, expiresAt]` (`execution-authorization.ts:66-78`). Route binding is TRANSITIVE via the fingerprint gate + `auditId` disambiguation: a changed route fails the gate (no authorization at all), and any other intent gets a different record → different `auditId` → different `authorizationId`. Do not overclaim `authorizationId` integrity | MITIGATED | `intent-fingerprint.ts:14-17`; `evaluate.ts:42-45`; `execution-authorization.ts:66-78` | Documented residual: `authorizationId` is a deterministic evidence ID over audit-level fields, not an independent cryptographic commitment over every route field. A tampered stored record's `programmablePaymentContext` could be carried into a re-issued envelope without changing `authorizationId` (no per-record signature — see T13) |
| T06 | Policy drift (policy changed between evaluations) | Changed `policyVersion` or `policyFingerprint` → `policyChanged:true` → no authorization; legacy missing attribution → `policyChanged:null` → no authorization. Active `policyVersion` = `"3"` | MITIGATED | `replay-evidence.ts:31-34`; `evaluate.ts:42-45`; `data/policies.default.json` (`policyVersion: "3"`) | None for authorization suppression; drift is reported, not silently absorbed |
| T07 | Legacy / incomplete evidence | Missing `intentFingerprint`/`policyVersion`/`policyFingerprint` → `null` → no authorization (fail-closed). Legacy file bytes are never rewritten merely by reading (normalization is in-memory only) | MITIGATED | `replay-evidence.ts:23-24,29-33`; `audit-log.ts:50-79`; `execution-authorization.ts:49-57` | Historical attribution for legacy records remains unavailable by design (never fabricated) |
| T08 | Authorization scope expansion | `scope: "single_intent"`; `executionScope: ["prepare","simulate"]` exactly — no execute/submit/broadcast/sign/settle; `executionStatus: "not_executed"`; `fundsMoved: false` (literal types) | MITIGATED | `execution-authorization.ts:28-30,101-103`; `audit/types.ts` (`executionStatus: "not_executed"`) | ExecutionAuthorization is evidence for a future adapter, NOT an executable capability or bearer token |
| T09 | Stale / expired authorization | Expiry is evidence metadata only on the issuance path: `issuedAt` = audit timestamp, `expiresAt` = `issuedAt + policy.authorization.ttlSeconds` (300) | PARTIALLY MITIGATED (LOCAL) | `execution-authorization.ts:63-64`; `data/policies.default.json` (`ttlSeconds: 300`). The v1 authorization builder performs no runtime expiry check. I2's execution security gate (`src/domain/x402/execution-security-gate.ts`) now enforces runtime expiry locally: `now < expiresAt` strictly, `now === expiresAt` rejects, unparseable `expiresAt` fails closed — END-TO-END ENFORCEMENT PENDING I4/I6 | Severity REDUCED for the eligibility step (I2 gate rejects expired authorizations locally), but no executing adapter exists yet; exact replay after expiry still re-issues the v1 authorization with the original timestamps. End-to-end expiry enforcement still requires the future external signer adapter (I4) to honor the gate |
| T10 | Duplicate execution | Duplicate EVALUATION is mitigated (canonical audit idempotency, in-process lock). Duplicate EXECUTION: no execute/broadcast path exists | NOT APPLICABLE YET | `audit-log.ts:86-118` | FUTURE CONTROL REQUIRED before any adapter: consume/check `authorizationId`, single-use semantics where required, idempotent execution key, durable execution state, reject duplicate settlement, bind the transaction to exact authorization constraints. No execution ledger added now |
| T11 | Spend-limit bypass | Per-request max: BLOCK above `10.00` (`engine.ts` hard-max check vs `policy.limits.maxAmountPerPayment`); daily projected spend: BLOCK above `25.00`/agent/UTC-day from canonical ALLOW records (`spend-controls.ts:26-31`, `engine.ts` daily check); velocity: REVIEW at `>= 5` attempts/60s (`engine.ts:256-260`); decimal-safe BigInt arithmetic — no float money math (`lib/decimal.ts`) | PARTIALLY MITIGATED | `data/policies.default.json` (`maxAmountPerPayment: "10.00"`, `dailyLimitPerAgent: "25.00"`, `velocity 60s/5`); `lib/decimal.ts` | Spend state is canonical policy/audit evidence, NOT real settled funds (correct for the current no-execution product). Limits are keyed by the SELF-ASSERTED `agentId` — rotating `agentId` resets daily/velocity context. No claim of preventing real-world double spending. Future adapter must reconcile authorized vs executed spend |
| T12 | Policy config tampering | SHA-256 fingerprint over stable-JSON canonical form proves deterministic CONTENT identity — same-version tamper is detected (`policyChanged:true`, no auth) | PARTIALLY MITIGATED | `policy-fingerprint.ts:11-13`; `lib/stable-json.ts` (key-sorted canonicalization); `replay-evidence.ts:31-34`; `evaluate.ts:42-45` | Fingerprint does NOT prove authorship, authenticity, filesystem integrity, or approval provenance — it is content identity/evidence, not a cryptographic trust anchor. Future: signed policy releases, approved policy registry, protected config store, deployment provenance. Signing NOT implemented |
| T13 | Audit log tampering | Append-only by application convention (in-process only). No hash chaining, no signature, no external immutable storage, no integrity verification | RESIDUAL | `audit-log.ts:86-118` (append only); no chain/signature code in `src/domain/audit/*` | A tampered stored line is returned as historical evidence and edited record fields can propagate into a re-issued authorization (no per-record signature). Malformed line fails closed (never ALLOW) but blinds the whole-file read. Claim kept: "append-only audit evidence", NOT "immutable ledger". Future options: hash chaining, signed records, WORM storage, externally anchored hashes. NOT implemented now |
| T14 | Concurrent writer | Same-process: promise-chain lock keyed by path (`audit-log.ts:12-24`, `evaluation-observation-log.ts`); idempotency read happens inside the lock → same-process same-key concurrency yields exactly one line | PARTIALLY MITIGATED | `audit-log.ts:12-24,86-93` | Cross-process: RESIDUAL. No OS-level locking, no fsync, no cross-process protection — two processes can double-append and collide `auditId`s (`makeAuditId(records.length, …)` at `audit-log.ts:45-48`). Future: durable atomic datastore / cross-process concurrency control. No database now |
| T15 | Untrusted extra input fields | Top-level unknown fields (including `transactionHash`, `signature`, `to`, `data`, `programmablePaymentContext`) are SILENTLY IGNORED — never rejected, never survive into the validated `PaymentIntent`, never affect fingerprint/decision/authorization. `routeContext` unknown fields ARE rejected (strict) | PARTIALLY MITIGATED | `validation.ts:124-157` (reads only known fields); `validation.ts:84-88` (strict routeContext rejection); `programmable-payment-context.ts` (derived server-side, never read from raw body) | Acceptable in the no-execution architecture because downstream security logic consumes the typed validated intent. Future adapter rule: NEVER consume raw request fields bypassing `validatePaymentIntent` |
| ADD-1 | Self-asserted agent identity | `agentId` is unauthenticated free-form input; spend controls keyed by it; no auth middleware | RESIDUAL | `validation.ts:23-32,132-138`; no auth code in `src/app/api/*` | Rotating/spoofing `agentId` resets daily and velocity context. Not implemented in this phase |
| ADD-2 | Local filesystem confidentiality | Plaintext JSONL (intent, recipient, agentId); no secrets stored; readable by local users/processes | RESIDUAL | `audit-log.ts:95-117` (plaintext records) | Severity LOW (no secrets; local demo). Operational exposure only |
| ADD-3 | DoS / no rate limiting | No rate limiting; each POST reads the whole audit file (`evaluate.ts:34`); no auth | RESIDUAL | `evaluate.ts:31-34`; no middleware in `src/app/api` | FUTURE CONTROL REQUIRED. LOW/MEDIUM for a local pilot; a production-facing deployment would need rate limiting and auth |
| ADD-4 | Observation-log failure | try/catch → `observationRecorded:false`; decision/evidence/authorization unaffected; error swallowed but honestly reported in the response | MITIGATED | `evaluate.ts:48-63`; `evaluation-observation-log.ts` | None for decision/evidence integrity; observability gap only |
| ADD-5 | Malformed/corrupt local JSONL | Parse throw → fail-closed (never ALLOW, no auth) via `safeEvaluatePaymentIntent` REVIEW/500 posture; `ValidationError` → BLOCK/400 | PARTIALLY MITIGATED | `audit-log.ts:38-43` (JSON.parse throws); `evaluate.ts:85-118` (fail-closed) | One bad line blinds the entire audit read — no per-line recovery. A corrupt file degrades the whole evaluation endpoint until repaired |
| ADD-6 | UI evidence spoofing vs server evidence | UI is presentation of server-persisted records; client-side receipts derive from server data; no per-record signature/hash chain | RESIDUAL | `demo-client.tsx:129,149,169,257` (fetch server records); no signing in `src/domain/audit/*` | A tampered file or proxied response renders as-is; UI evidence is not independent server attestation. Severity LOW for local pilot; revisit before any external-facing demo |

# Current Security Invariants

Verified invariants in the current code:

1. **One canonical line per key, in-process.** Same `idempotencyKey` creates at
   most one original audit line; replays return the stored record
   (`audit-log.ts:86-93`).
2. **Mismatch suppresses authorization.** `replayMismatch === false &&
   policyChanged === false` is the exact gate for building an authorization;
   `null` or `true` on either side yields no authorization (`evaluate.ts:42-45`).
3. **Policy drift suppresses authorization.** Version or fingerprint change, or
   missing stored attribution, blocks authorization (`replay-evidence.ts:29-34`;
   `execution-authorization.ts:49-57`).
4. **Legacy evidence suppresses authorization.** Missing `intentFingerprint` /
   `policyVersion` / `policyFingerprint` on a record → fail-closed
   (`execution-authorization.ts:49-51`).
5. **Literal scope.** `executionScope` is the literal tuple
   `["prepare", "simulate"]`; `executionStatus` is the literal `"not_executed"`;
   `fundsMoved` is the literal `false` — enforced by the type system, not by
   runtime state (`execution-authorization.ts:28-30`).
6. **Decimal-safe money arithmetic.** All policy money comparisons and sums use
   BigInt-scaled decimal strings; no floating-point math in decisions
   (`lib/decimal.ts`; `spend-controls.ts`; `engine.ts`).
7. **Fail-closed validation and parse.** Invalid input → BLOCK/400; internal
   failure → REVIEW/500; never ALLOW on failure (`evaluate.ts:85-118`).
8. **Observation failure is non-fatal.** A failed observation append never
   changes decision, evidence, or authorization, and is honestly reported
   (`evaluate.ts:48-63`).
9. **Authorization is evidence, not capability.** It is built from persisted
   audit records + current policy, never from the raw request
   (`execution-authorization.ts:42-57`).
10. **Fingerprints are canonical.** Key-sorted stable JSON → deterministic
    SHA-256 for both intent and policy (`lib/stable-json.ts`).

# Residual Risks

Severities are calibrated to the CURRENT product scope (local pilot, no execution
adapter, no funds movement, no production deployment). Each would be re-graded
before any testnet execution work; where a risk would escalate materially, that is
stated. This calibration avoids alarmist inflation — none of these risks can
currently result in fund movement.

1. **Audit log is not tamper-evident** (T13) — MEDIUM now; would become CRITICAL
   before any execution adapter exists. JSONL is append-only by writer convention
   only; no hash chain, signature, or external anchoring.
2. **Authorization expiry is not enforced at runtime on the LIVE path**
   (T09) — reduced post-I5: all three checks are now implemented locally (I2
   eligibility gate, I4 pre-signer recheck, I5 pre-settle recheck — `now >=
   expiresAt` rejects at each). End-to-end enforcement against a real Gateway
   remains PENDING I6 (no live settle has occurred).
3. **No cross-process concurrency control** (T14) — MEDIUM for the local demo
   (single process is fine), production blocker. Two processes can double-append
   and collide `auditId`s.
4. **No authenticated agent identity** (ADD-1) — MEDIUM. Spend limits key on a
   self-asserted `agentId`; rotation resets daily/velocity context.
5. **Policy fingerprint proves content identity only** (T12) — LOW /
   INFORMATIONAL. Not authorship or authenticity; no signed policy releases.
6. **`authorizationId` does not commit every route field** (T05) — LOW /
   INFORMATIONAL. Route binding is transitive (fingerprint gate + `auditId`), not
   a direct hash over `programmablePaymentContext`; documented boundary, not an
   independent commitment.
7. **No rate limiting / auth on local API** (ADD-3) — LOW for local pilot;
   each POST re-reads the whole audit file. Re-grade before any public deployment.
8. **Plaintext local files** (ADD-2) — LOW. No secrets stored; readable by local
   users/processes.
9. **UI evidence is not independent server attestation** (ADD-6) — LOW for local
   pilot; a tampered file or proxied response renders as-is.
10. **Malformed JSONL blinds the whole audit read** (ADD-5) — LOW/INFORMATIONAL.
    Fails closed (never ALLOW) but takes the endpoint down until repaired.
11. **Historical attribution unavailable for legacy records** (T07) —
    INFORMATIONAL. Deliberate: never fabricated.

# Future Execution Preconditions

I2 now implements **local code** for a subset of these (runtime expiry gate,
direct requirement binding, Arc Testnet network allowlist, and
amount/recipient/asset/domain gate) — marked **I2 IMPLEMENTED LOCALLY /
END-TO-END ENFORCEMENT PENDING I4/I6** below. **This does NOT complete the
gate**: no execution adapter exists, and the remaining items are still
unchecked. Every item must still be implemented and tested before ANY testnet
adapter is allowed to move funds. Marking a precondition complete requires
both implementation and test evidence.

> I1 note (2026-08-16): the x402 payment-requirement contract and deterministic
> requirement digest now exist as an I1 artifact
> (`src/domain/x402/payment-requirement.ts`,
> `src/domain/x402/payment-requirement-evidence.ts`,
> `tests/x402-payment-requirement.test.ts`,
> `docs/grants/circle-grants-2026/x402-payment-requirement-contract.md`). This
> does **not** check off any precondition below: exact
> authorization-to-adapter execution binding (preconditions 2 and 3) remains
> unchecked and unimplemented until I2 (Execution Security Gate) exists.

> I2 note (2026-08-16): the pure, fail-closed execution security gate now
> exists as an I2 artifact
> (`src/domain/x402/execution-security-gate.ts`,
> `src/domain/x402/execution-authorization-v2.ts`,
> `tests/x402-execution-security-gate.test.ts`,
> `docs/grants/circle-grants-2026/x402-execution-security-gate.md`), with
> active `policyVersion` `"3"` and an `x402Execution` allowlist in
> `data/policies.default.json`. I2 implements **local** code for the runtime
> authorization expiry gate, direct requirement binding, the Arc Testnet
> network allowlist, and the amount/recipient/asset/domain gate; it produces
> eligibility for a FUTURE external signer request only — no signer, no
> nonce, no settlement, no Gateway call, no funds movement. I2 does **not**
> complete the preconditions below: duplicate execution, durable cross-process
> idempotency, executed-spend reconciliation, external signer/key-management
> proof, durable settlement outcome evidence, and the final pre-broadcast
> threat-model re-review remain unchecked and unimplemented until I4/I6.

> I3 note (2026-08-16): the durable execution state store now exists as an I3
> artifact (`src/domain/x402/execution-store.ts`,
> `tests/x402-execution-store.test.ts`,
> `docs/grants/circle-grants-2026/x402-execution-store.md`, plus
> `src/lib/paths.ts` `executionStorePath()` and `.env.example` /
> `.gitignore` entries). I3 implements **local** code — single-use v2
> authorization consumption, durable execution-state idempotency on a shared
> filesystem, deterministic EIP-3009 nonce binding/registry, and
> cross-process exclusive execution-state transitions (`fs.open(path, "wx")`,
> O_CREAT|O_EXCL) — marked **I3 IMPLEMENTED LOCALLY / END-TO-END PENDING**
> below. **I3 does NOT fix the T14 canonical-audit cross-process concurrency**:
> that store still uses the in-process promise-lock pattern; I3 fixes only the
> NEW execution-state store. Still NOT COMPLETE: the external signer/key
> boundary, real Gateway submission, Gateway nonce-enforcement proof,
> SettlementEvidence, executed-spend reconciliation, and the final
> pre-broadcast threat-model re-review. The 14-precondition gate is **not**
> complete.

> I4 note (2026-08-16): the offline external EOA signer boundary now exists as
> an I4 artifact
> (`src/domain/x402/eip3009-signing-request.ts`,
> `src/domain/x402/external-signer.ts`,
> `src/domain/x402/sign-prepared-x402-execution.ts` (orchestrator
> `signPreparedX402Execution`),
> `scripts/x402-external-signer.mjs`,
> `tests/x402-external-signer.test.ts`,
> `tests/x402-external-signer-cli.test.ts`, the `viem` dependency, and the
> record `docs/grants/circle-grants-2026/x402-external-signer.md`). I4 creates
> a **real cryptographic EIP-3009 signature locally** via a bounded external
> EOA signer boundary, verifies it cryptographically, builds a transient x402
> v2 `PaymentPayload`, and commits its digest via the I3 `prepared → submitted`
> transition. Marked **IMPLEMENTED LOCALLY for the I4 reference boundary**:
> external signer/key isolation (key only in `scripts/x402-external-signer.mjs`
> from its own `AGENTPAY_X402_SIGNER_PRIVATE_KEY` env, never in `src/` /
> `.env.example` / repo / execution store / audit logs; Guard core knows only
> the `X402ExternalSigner` interface); signature-field integrity verification
> (strict response shape, `signingRequestDigest` equality, signature encoding,
> viem `recoverTypedDataAddress` against the exact locally constructed typed
> data); payer EOA verification (recovered address == trusted
> `X402PayerBinding.payerAddress`; wrong signer / tampered fields rejected with
> stable `X402_SIGNER_*` reason codes). Confirmed EIP-712 facts: primary type
> `TransferWithAuthorization`; domain includes `chainId`; `validBefore = now +
> max(maxTimeoutSeconds, 604900)` (7 days + 100 s buffer).
> I4 is **offline / non-network** — zero Gateway, RPC, HTTP payment, balance,
> faucet, or broadcast calls; it does NOT submit the signature anywhere, does
> NOT prove payment, and does NOT move funds. **I4 does NOT complete the gate**:
> real Gateway submission, Gateway nonce enforcement in a real call,
> SettlementEvidence, executed-spend reconciliation, production authenticated
> agent identity, the pre-broadcast security re-review, and full testnet
> positive proof remain unchecked and unimplemented (I5/I6). I4 claims **no**
> universal custody solution, no production key-management, no hardware-wallet
> support, and no production wallet security. The 14-precondition gate is
> **not** complete.

> PRE-I5 note (2026-08-17): **PRE-I5 SECURITY RE-REVIEW COMPLETED 2026-08-17,
> decision GO WITH BLOCKERS, I5 NOT IMPLEMENTED, I6 NOT IMPLEMENTED.** The
> re-review (see [pre-i5-security-review.md](./pre-i5-security-review.md))
> re-verified the official Gateway/x402/Arc facts, re-classified the 14
> preconditions below against the I4 surface, and froze the I5 design: I3
> `remote_outcome_unknown` state-machine extension (required — `failed` means
> known deterministic rejection; a timeout after the request left the process
> is UNKNOWN), SettlementEvidence contract + durable store (Option B, keyed by
> authorizationId + nonce index), read-only ExecutedSpendSummary
> (settled/failed/unknown buckets), payload recovery/liveness (persist
> validAfter/validBefore OR fresh-authorization lineage; never persist keys or
> signatures), Gateway client contract (host-allowlisted testnet HTTPS, bounded
> timeout, no generic retry), pre-settle expiry recheck, and `confirmed` =
> official `confirmed` OR `completed`. Live payment remains FORBIDDEN in I5
> (first live payment is I6). This note updates only the threat model and
> docs; no runtime code changed.

> I5 note (2026-09-15): **the bounded Circle Gateway settlement layer (I5) is
> now IMPLEMENTED.** The Gateway/x402 testnet client
> (`src/integrations/circle-gateway/contracts.ts`,
> `src/integrations/circle-gateway/testnet-client.ts`), the settlement
> orchestration (`src/domain/x402/gateway-settlement.ts`: submit / reconcile /
> finish), the durable `SettlementEvidence` contract + immutable store
> (`src/domain/x402/settlement-evidence.ts`,
> `src/domain/x402/settlement-evidence-store.ts`), the read-only
> executed-spend reconciliation (`src/domain/x402/executed-spend.ts`), the
> operator-gated live transport (`src/domain/x402/gateway-live-transport.ts`,
> `scripts/x402-gateway-testnet.mjs`), and the I3 state-machine extension
> (`remote_outcome_unknown`) now exist. The authoritative record is
> [x402-gateway-settlement.md](./x402-gateway-settlement.md). Everything
> verified in I5 is **IMPLEMENTED LOCALLY / MOCK-VERIFIED**: unknown-remote
> -outcome handling (a `remote_outcome_unknown` state distinct from `failed`),
> durable SettlementEvidence (immutable store; evidence digest persisted
> BEFORE the `confirmed` transition), executed-spend reconciliation, Gateway
> testnet host pinning, strict response validation, NO automatic retry, the
> final expiry pre-send check (third Guard recheck, immediately before
> `settle`), the nonce-keyed reconciliation path (reconcile by nonce, never
> re-sign), and the operator-gated live transport (`--live` + exact-string
> env authorization; tested only on its refusal branch). Explicitly: **NO
> live payment proof yet** — no `POST /v1/x402/settle` has ever been
> executed, no testnet payment was made, no funds moved, and no live
> transfer UUID exists. **Gateway nonce behaviour is NOT PROVEN END-TO-END
> until I6** — the durable nonce registry and reconcile path prove LOCAL
> single-use only. Phase 9 remains **DEFERRED**; the first live payment is
> **I6**. Honest residuals: `vitest.config.ts` has **no global fetch
> sandbox** — test isolation is a per-test-file convention plus each file's
> own guard, not a runner-level guarantee; and the SettlementEvidence store
> is **immutable-by-convention** (O_EXCL + strict parsing + never rewriting)
> inside the same filesystem trust boundary — **NOT tamper-proof, NOT WORM**.

- [x] **Runtime authorization expiry enforcement** — adapter MUST reject when
  `now >= expiresAt` (T09). **IMPLEMENTED LOCALLY (I2 gate + I4 pre-signer
  recheck + I5 pre-settle recheck) / END-TO-END ENFORCEMENT PENDING I6**
  (`now < expiresAt` strictly; `now === expiresAt` rejects; unparseable
  `expiresAt` fails closed; the I5.3 pre-settle recheck is implemented as a
  guard of `submitX402GatewaySettlement` immediately before the single
  `settle` call, rejecting with zero transport calls).
- [x] **Exact authorization-to-adapter input binding** — the adapter consumes the
  validated typed intent / `ExecutionAuthorization`, never raw request fields
  (T15). **IMPLEMENTED LOCALLY / END-TO-END ENFORCEMENT PENDING I6**
  (typed-input-only gate; I5 consumes only I3 prepared-record evidence + the
  typed contract, with digest guards on the payload and requirement).
- [x] **Recipient / amount / asset / chain / route enforcement** — executed
  transaction must match authorization constraints exactly (T03, T04, T05).
  **IMPLEMENTED LOCALLY / END-TO-END ENFORCEMENT PENDING I6**
  (recipient → payTo gate, exact 6-decimal decimal→atomic amount, asset/domain
  gate; the I5 pre-send binding guard compares requirement
  network/asset/payTo/amount against the durable prepared record, and
  SettlementEvidence amounts derive exclusively from durable evidence).
- [x] **Single-use / duplicate-execution protection** — consume/check
  `authorizationId`; single-use semantics where required (T10).
  **IMPLEMENTED LOCALLY / GATEWAY NONCE-ENFORCEMENT PROOF PENDING I6** (the
  execution-state store: first prepared event permanently consumes the v2
  authorization; duplicate prepare → `X402_EXECUTION_ALREADY_CONSUMED`; retry
  after terminal failure requires a fresh Guard lineage; I5 reconciles by
  nonce and NEVER re-signs an accepted nonce — `nonce_already_used` triggers
  reconcile-required, not blind failure or retry). **Gateway's own nonce
  enforcement is NOT proven until the I6 live negative test.**
- [x] **Durable cross-process idempotency** — atomic append / datastore-backed
  audit writes; no `auditId` collisions (T14). **IMPLEMENTED LOCALLY (I3
  execution store + I5 SettlementEvidence store, both O_EXCL); canonical
  audit T14 cross-process remains RESIDUAL** (`fs.open(path, "wx")`
  O_CREAT|O_EXCL exclusive creation of numbered events, nonce claims, and
  evidence snapshots; restart-safe reconstruction from persisted immutable
  events; deterministic EIP-3009 nonce binding/registry; the canonical audit
  log still uses the in-process promise lock).
- [x] **Actual executed-spend accounting** — reconcile authorized vs executed
  spend; daily limits reflect settled funds (T11). **IMPLEMENTED LOCALLY FOR
  BOUNDED TESTNET MODEL** (read-only `ExecutedSpendSummary` in
  `src/domain/x402/executed-spend.ts`; settled/failed/unknown/pending buckets
  derived from durable SettlementEvidence + I3 state, zero writes, zero
  network). Separate from proposed-intent policy spend accounting. Making
  daily limits REFLECT settled funds in production remains I6+ work.
- [ ] **Authenticated principal / agent identity model** — no self-asserted
  `agentId` as a security boundary (ADD-1). **RESIDUAL PRODUCTION CONTROL —
  self-asserted `agentId`; acceptable for the bounded testnet proof; do not
  block I5/I6 on it. Cryptographic identity on the payment path is the payer
  EOA (`recoverTypedDataAddress`, I4).**
- [x] **Protected key-management boundary outside AgentPay Guard core** — no
  private keys in this repository. **IMPLEMENTED FOR REFERENCE TEST SIGNER —
  NOT production key management** (key only in
  `scripts/x402-external-signer.mjs` process env, never in `src/`). I5 added
  no key handling; the live transport is keyless (the Gateway client
  receives only the signed payload + requirement + non-secret metadata);
  SettlementEvidence stores no keys/signatures.
- [x] **Transaction simulation before signing** — **PROTOCOL-ADAPTED
  REQUIREMENT (PRE-I5 re-review, 2026-08-17): "transaction simulation before
  signing" is PROTOCOL-INCORRECT for the x402 Gateway** (EIP-3009 is an
  offchain signature; no gas; no onchain simulation before signing; the
  facilitator pays gas). Rewritten to "Independent protocol validation before
  irreversible settlement submission": I1 strict requirement validation + I2
  gate + EIP-712 domain match + viem `recoverTypedDataAddress` payer recovery
  (already in I4). Official seller quickstart: use `settle()` directly rather
  than `verify()` then `settle()`. **IMPLEMENTED LOCALLY (protocol-adapted:
  I1 validation + I2 gate + EIP-712 domain match + payer recovery) / LIVE
  PROOF PENDING I6.**
- [x] **Explicit network allowlist** — adapter may only target permitted
  chains/contracts (T05, engine CCTP pair rules). **IMPLEMENTED LOCALLY**
  (compile-pinned host-only testnet client —
  `gateway-api-testnet.circle.com`, no `baseUrl` option — plus Arc Testnet
  `eip155:5042002` / USDC / Gateway-domain allowlist enforced at the I2 gate
  and re-checked against the CURRENT policy allowlist before every settle).
- [ ] **Adapter-specific fee bounds** — fee caps enforced at execution, not only
  policy preview (T05 fee fields). **NOT APPLICABLE TO BOUNDED PATH — the
  exact nanopayment path has no per-payment execution fee: the payer
  authorizes exactly `PaymentRequirements.amount` and the facilitator absorbs
  gas via batched settlement.** (One-time onchain deposit gas and seller
  withdrawal fees are separate documented costs, out of scope.)
- [x] **Durable execution outcome evidence** — executed state recorded
  durably, distinct from policy evidence (T10, T13). **IMPLEMENTED LOCALLY**
  (immutable SettlementEvidence store — separate directory, keyed by
  authorizationId with nonce/transfer indexes, O_EXCL appends; evidence
  digest persisted BEFORE the I3 `confirmed` transition, with
  evidence-first ordering on the failed/unknown paths too). Tamper-proofing
  remains out of scope (same filesystem trust boundary, not WORM).
- [x] **No raw-request bypass around validated typed intent** — downstream
  security logic consumes only the validated `PaymentIntent` (T15).
  **IMPLEMENTED LOCALLY** (the gate consumes only validated typed objects,
  never raw request fields; I5 derives execution identity from I3 durable
  evidence only — all 12 SettlementEvidence base-linkage fields come
  exclusively from durable evidence, never from a Gateway response).
- [ ] **Threat-model re-review before enabling broadcast** — this document must
  be re-verified against the new execution surface. **COMPLETED for I5; final
  operator sign-off on the pre-broadcast checklist still REQUIRED before the
  first live testnet submission (I6).** (2026-08-17 — PRE-I5 SECURITY
  RE-REVIEW, decision GO WITH BLOCKERS, see pre-i5-security-review.md; the
  I5 implementation record is
  [x402-gateway-settlement.md](./x402-gateway-settlement.md).)

**Live remote enforcement / proof — I6 PENDING.** Every I5 status above is
implemented-locally / mock-verified; no precondition carrying an "END-TO-END
/ LIVE / GATEWAY-PROOF PENDING I6" clause may be marked fully complete until
the first operator-authorized live testnet run (I6).

# Verification Evidence

- **Security regression suite** — `tests/security-boundaries.test.ts`
  (22 tests, all passing).
- **Existing suites** — the pre-I5 baseline was 25 test files / 563 tests, all
  passing (verified 2026-08-16 at I4: post-I1 21 files / 360 tests, post-I2
  22 files / 445 tests, post-I3 23 files / 494 tests, post-I4 25 files / 563
  tests — incl. I1 90, I2 85, I4 63 + external-signer-cli 6). The earlier
  Phase 7 baseline was 20 files / 270 tests (19 files / 248 + 22
  security-boundary tests). Updated for I5: the execution state machine
  gained `remote_outcome_unknown`, and `tests/x402-execution-store.test.ts`
  now has 63 tests (verified 2026-09-15, 63 passed); the I4 external-signer
  suite stands at 63 tests + CLI 6 (verified 2026-09-15). No global
  file/count total is restated here — the post-I5 totals belong to
  `evidence.md` and the final validation run.
- **New I5 suites (mock/fixture-only, NO live network)** —
  `tests/x402-gateway-client.test.ts`,
  `tests/x402-settlement-evidence.test.ts`,
  `tests/x402-settlement-evidence-store.test.ts`,
  `tests/x402-executed-spend.test.ts`,
  `tests/x402-gateway-settlement.test.ts` (settlement orchestration),
  `tests/x402-gateway-operator-script.test.ts` — every transport is an
  injected mock/stub fetch; none contacts the Gateway testnet host or any
  Arc RPC; the operator script is exercised only on its refusal branch.
- **Dependency note** — `package.json` now includes `viem ^2.55.16`
  (I4, offline EIP-712 signing/recovery only); no other network/signing
  dependency is present.
- **Validation commands** — `pnpm test`, `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, `git diff --check` (all green at Phase 6; re-run for Phase 7
  delivery). A separate worker owns validation for the PRE-I5 review; this
  review changes docs only.
- **Git evidence** — the Phase 7 checkpoint added
  `tests/security-boundaries.test.ts` and changed `docs/` only. I5 changes
  `src/domain/x402/*`, `src/integrations/circle-gateway/*`, `src/lib/paths.ts`,
  `scripts/x402-gateway-testnet*` + operator loader, `tests/x402-gateway-*` /
  settlement-evidence / executed-spend suites, and `docs/`; `src/app/**` is
  unchanged and no live settlement has been executed.
