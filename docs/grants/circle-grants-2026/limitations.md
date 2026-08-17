# Circle Grants 2026 — Limitations

This document states the explicit non-negotiable boundary of AgentPay Guard. It
mirrors and links the safety boundary in
[`docs/circle-grants-package.md`](../../circle-grants-package.md) and the
[README](../../../README.md). The full engineering analysis of these boundaries is
in the [threat model](./threat-model.md); this page is a summary, not a duplicate.

## The current product does NOT

- move funds;
- hold custody;
- store private keys;
- sign transactions in Guard `src/` (offline EIP-3009 signing exists only in
  the external signer tool `scripts/x402-external-signer.mjs`, I4 — never in
  Guard core);
- connect wallets;
- submit UserOperations;
- perform RPC execution;
- execute CCTP burn/mint;
- verify Iris attestations;
- perform live x402 settlement;
- perform live Gateway (or other) settlement;
- produce transaction hashes;
- confirm settlement or finality;
- claim official Circle, Arc, or x402 partnership.

## Verified security posture (Phase 7; current scope I1–I4)

- **Pre-settlement execution surface (I1–I4).** Nothing in Guard `src/` signs,
  broadcasts, submits transactions, calls blockchain RPC, or moves funds. The
  only real signing in the repository is offline in the external signer tool
  (`scripts/x402-external-signer.mjs`, I4 — key never in `src/`). Dependencies
  are `next` + `react` + `viem` (`^2.55.16`, offline EIP-712 signing/recovery
  only). See the static execution-surface review in the
  [threat model](./threat-model.md#static-execution-surface-review) and the
  [pre-I5 security re-review](./pre-i5-security-review.md).
- **Authorization expiry is metadata only.** `expiresAt` is derived from the audit
  timestamp + `policy.authorization.ttlSeconds` (300s). There is NO runtime
  wall-clock enforcement of expiry anywhere in `src/`; a future executing adapter
  MUST enforce `now >= expiresAt` itself.
- **Local filesystem is a trust boundary, not tamper-evident storage.** The
  policy JSON, audit JSONL, and observation JSONL are not cryptographically
  signed, not tamper-evident, not remotely attested, and not backed by an
  append-only external datastore.
- **No production-grade immutable audit storage.** "Append-only" is a
  writer-level convention enforced in-process only (a promise-chain lock per
  file path); there is no hash chaining, no per-record signature, and no
  cross-process protection. See T13/T14 in the [threat model](./threat-model.md).
- **No authenticated agent identity.** `agentId` is unauthenticated free-form
  input; spend controls are keyed by it, so rotating it resets daily/velocity
  context (ADD-1 in the [threat model](./threat-model.md)).

## Preserved model

- Every AgentPay Receipt records `fundsMoved: false`.
- Arc adapter evidence is a local deterministic preview only: `broadcast: false`,
  `status: "not_executed"`.
- CCTP, ERC-20 authority, Paymaster, and x402 contexts are proposal-only policy
  inputs, not protocol calls or integrations.
- `ALLOW` means only that a separately authorised future adapter could be
  considered. It never means funds moved, and no such adapter exists in this
  repository.

Any change that crosses this boundary requires explicit operator authorization
and its own tests; none is planned in the grant phases documented in
[`roadmap.md`](./roadmap.md).
