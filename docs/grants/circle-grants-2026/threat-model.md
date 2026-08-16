# Threat Model — Circle Grants Pilot (Phase 7)

Engineering threat model for the AgentPay Guard pilot boundary on branch
`grant/circle-grants-pilot-2026`. Every control claim below was verified against the
current source before being written; file:line citations point at the evidence.
This is an internal engineering verification, not an independent external security
audit.

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

Excluded from scope because the capabilities DO NOT exist in this repository:
custody, private-key security, transaction signing, wallet connection, RPC
transaction submission, live x402 settlement, CCTP burn/mint, Circle Gateway
settlement, UserOperation submission, and a production authorization service.

## Static execution-surface review

Repository scan of `src/` and `package.json` for signing, broadcast, RPC, wallet,
and key-management capabilities:

- `package.json` dependencies are `next`, `react`, `react-dom` only — no
  ethers/viem/web3/axios.
- No runtime code signs, broadcasts, submits transactions, stores private keys,
  connects wallets, calls blockchain RPC, executes CCTP, or submits
  UserOperations. Every keyword hit is one of:
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
- Network calls are limited to same-origin `fetch()` against the app's own
  `/api` routes (`src/app/demo-client.tsx:129,149,169,257`) and the local smoke
  script's `fetch(baseUrl + "/api/payment-intents/evaluate")`
  (`scripts/smoke.mjs:53`).

Docs, strings, types, and previews are explicitly distinguished from runtime
execution code above; there is no execution code to distinguish them from.

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

Stated plainly: **there is no execution surface to attack.** Nothing in `src/`
signs, broadcasts, or moves funds; the strongest attacker outcome is corrupted or
misleading local evidence or a withheld authorization — never fund movement.

# Threat Matrix

| ID | Threat | Current Control | Status | Verification | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| T01 | Exact replay of the same intent/key | One canonical line per key; replayed intent returns the stored record (`replayed:true`); `replayMismatch:false`, `policyChanged:false`; same `auditId`; same deterministic `authorizationId`; no duplicate canonical evidence | MITIGATED | `audit-log.ts:91-93`; `replay-evidence.ts:29-34`; `execution-authorization.ts:66-78`; `canonical-scenarios.md` REPLAY row | None for evidence idempotency. Replay is idempotent reuse, not independent decision reproducibility (see pilot-observability.md) |
| T02 | Same key, different intent (idempotency-key mismatch) | Stored vs current `intentFingerprint` differ → `replayMismatch:true` → stored decision preserved as historical evidence → authorization withheld → no second canonical line | MITIGATED | `replay-evidence.ts:29-30`; `evaluate.ts:42-45`; `audit-log.ts:89-93` | None for authorization suppression. Note: recipient STRING equality is not proof of real-world recipient identity — the fingerprint binds the literal string only |
| T03 | Recipient substitution under the same key | Recipient is a fingerprint field (`intent-fingerprint.ts:10`); substitution → `replayMismatch:true` → no authorization, historical decision preserved | MITIGATED | `intent-fingerprint.ts:5-18`; `evaluate.ts:42-45` | Same as T02: string-level binding, not identity-level |
| T04 | Amount substitution under the same key | Amount is a fingerprint field; `maxAmountUSDC` = persisted proposed amount (`audit.amountUSDC ?? audit.amount`), never the policy maximum — prevents envelope-level amount expansion | MITIGATED | `intent-fingerprint.ts:8`; `execution-authorization.ts:65` | There is **no external executor** enforcing this envelope — no executor exists. The envelope is evidence for a future adapter, not an enforced limit |
| T05 | Route / operation / fee substitution | `routeContext` (whole object), `operation`, `spender`, `amountBaseUnits` participate in the fingerprint when present (`intent-fingerprint.ts:14-17`); same-key route change → `replayMismatch:true` → no auth. CRITICAL nuance: `authorizationId` does NOT hash `programmablePaymentContext` fields directly — it is `sha256` over `[intentId ?? idempotencyKey, idempotencyKey, auditId, agentId, recipient, maxAmountUSDC, paymentRail, policyVersion, policyFingerprint, issuedAt, expiresAt]` (`execution-authorization.ts:66-78`). Route binding is TRANSITIVE via the fingerprint gate + `auditId` disambiguation: a changed route fails the gate (no authorization at all), and any other intent gets a different record → different `auditId` → different `authorizationId`. Do not overclaim `authorizationId` integrity | MITIGATED | `intent-fingerprint.ts:14-17`; `evaluate.ts:42-45`; `execution-authorization.ts:66-78` | Documented residual: `authorizationId` is a deterministic evidence ID over audit-level fields, not an independent cryptographic commitment over every route field. A tampered stored record's `programmablePaymentContext` could be carried into a re-issued envelope without changing `authorizationId` (no per-record signature — see T13) |
| T06 | Policy drift (policy changed between evaluations) | Changed `policyVersion` or `policyFingerprint` → `policyChanged:true` → no authorization; legacy missing attribution → `policyChanged:null` → no authorization. Active `policyVersion` = `"2"` | MITIGATED | `replay-evidence.ts:31-34`; `evaluate.ts:42-45`; `data/policies.default.json` (`policyVersion: "2"`) | None for authorization suppression; drift is reported, not silently absorbed |
| T07 | Legacy / incomplete evidence | Missing `intentFingerprint`/`policyVersion`/`policyFingerprint` → `null` → no authorization (fail-closed). Legacy file bytes are never rewritten merely by reading (normalization is in-memory only) | MITIGATED | `replay-evidence.ts:23-24,29-33`; `audit-log.ts:50-79`; `execution-authorization.ts:49-57` | Historical attribution for legacy records remains unavailable by design (never fabricated) |
| T08 | Authorization scope expansion | `scope: "single_intent"`; `executionScope: ["prepare","simulate"]` exactly — no execute/submit/broadcast/sign/settle; `executionStatus: "not_executed"`; `fundsMoved: false` (literal types) | MITIGATED | `execution-authorization.ts:28-30,101-103`; `audit/types.ts` (`executionStatus: "not_executed"`) | ExecutionAuthorization is evidence for a future adapter, NOT an executable capability or bearer token |
| T09 | Stale / expired authorization | Expiry is evidence metadata only: `issuedAt` = audit timestamp, `expiresAt` = `issuedAt + policy.authorization.ttlSeconds` (300) | RESIDUAL | `execution-authorization.ts:63-64`; `data/policies.default.json` (`ttlSeconds: 300`). Search-verified: NO runtime wall-clock check of `expiresAt` anywhere in `src/` — `Date.now()`/`Date.parse` appear only in velocity windows (`policy/engine.ts:257`, `policy/spend-controls.ts:45`) | Severity MEDIUM, calibrated to current scope (no executing adapter); future-execution blocker. Exact replay after expiry still re-issues authorization with the original timestamps. Future precondition: adapter MUST reject when `now >= expiresAt` |
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
2. **Authorization expiry is not enforced at runtime** (T09) — MEDIUM,
   future-execution blocker. `expiresAt` is metadata; a future adapter MUST check
   `now >= expiresAt` before acting.
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

None of the following are implemented. **This list is intentionally all-unchecked:
no execution adapter exists in this repository, and every item must be implemented
and tested before ANY testnet adapter is allowed to move funds.** Marking a
precondition complete requires both implementation and test evidence.

> I1 note (2026-08-16): the x402 payment-requirement contract and deterministic
> requirement digest now exist as an I1 artifact
> (`src/domain/x402/payment-requirement.ts`,
> `src/domain/x402/payment-requirement-evidence.ts`,
> `tests/x402-payment-requirement.test.ts`,
> `docs/grants/circle-grants-2026/x402-payment-requirement-contract.md`). This
> does **not** check off any precondition below: exact
> authorization-to-adapter execution binding (preconditions 2 and 3) remains
> unchecked and unimplemented until I2 (Execution Security Gate) exists.

- [ ] **Runtime authorization expiry enforcement** — adapter MUST reject when
  `now >= expiresAt` (T09).
- [ ] **Exact authorization-to-adapter input binding** — the adapter consumes the
  validated typed intent / `ExecutionAuthorization`, never raw request fields
  (T15).
- [ ] **Recipient / amount / asset / chain / route enforcement** — executed
  transaction must match authorization constraints exactly (T03, T04, T05).
- [ ] **Single-use / duplicate-execution protection** — consume/check
  `authorizationId`; single-use semantics where required (T10).
- [ ] **Durable cross-process idempotency** — atomic append / datastore-backed
  audit writes; no `auditId` collisions (T14).
- [ ] **Actual executed-spend accounting** — reconcile authorized vs executed
  spend; daily limits reflect settled funds (T11).
- [ ] **Authenticated principal / agent identity model** — no self-asserted
  `agentId` as a security boundary (ADD-1).
- [ ] **Protected key-management boundary outside AgentPay Guard core** — no
  private keys in this repository.
- [ ] **Transaction simulation before signing** — preview remains preview until
  independently simulated.
- [ ] **Explicit network allowlist** — adapter may only target permitted
  chains/contracts (T05, engine CCTP pair rules).
- [ ] **Adapter-specific fee bounds** — fee caps enforced at execution, not only
  policy preview (T05 fee fields).
- [ ] **Durable execution outcome evidence** — executed state recorded
  durably, distinct from policy evidence (T10, T13).
- [ ] **No raw-request bypass around validated typed intent** — downstream
  security logic consumes only the validated `PaymentIntent` (T15).
- [ ] **Threat-model re-review before enabling broadcast** — this document must
  be re-verified against the new execution surface.

# Verification Evidence

- **Security regression suite** — `tests/security-boundaries.test.ts`
  (22 tests, all passing).
- **Existing suites** — 20 test files / 270 tests, all passing
  (verified 2026-08-14 on this branch: baseline 19 files / 248 tests + 22 new
  security-boundary tests).
- **Validation commands** — `pnpm test`, `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, `git diff --check` (all green at Phase 6; re-run for Phase 7
  delivery).
- **Git evidence** — this phase adds `tests/security-boundaries.test.ts` and changes
  `docs/` only; `src/domain`, `src/app`, `data/`, and `package.json` are
  unchanged.
