# AgentPay Guard — Grant Draft

## Product summary

AgentPay Guard is a deterministic policy-and-audit control plane for proposed
autonomous USDC payments. It evaluates a payment intent before any future adapter
can execute: a preflight `ALLOW` / `REVIEW` / `BLOCK` decision, a spend-control
envelope, append-only audit evidence, and an AgentPay Receipt with
`fundsMoved: false`. No funds move — the guard is the decision-and-evidence
boundary in front of a future settlement adapter, not a payment rail.

## Grant-track status

Grant development happens on branch `grant/circle-grants-pilot-2026`, on top of the
stable main baseline `eb28fe7…` (merge of PR #3). Phases 0–7 are complete:

- Phase 1 — versioned policy evidence (`policyVersion`, `policyFingerprint`,
  `executionStatus` on new audit records; legacy lines stay readable and are never
  rewritten).
- Phase 2 — typed ExecutionAuthorization envelope: deterministic, ALLOW-only,
  literal `["prepare","simulate"]` scope, `not_executed`, `fundsMoved: false`.
- Phase 3 — replay and policy-drift evidence (`intentFingerprint`, explicit
  `replayed` signal, `ReplayEvidence` mismatch / drift / unknown states).
- Phase 4 — canonical ALLOW / REVIEW / BLOCK / REPLAY scenario fixtures.
- Phase 5 — local pilot observability (observation log, p95 policy-evaluation
  latency, replay and policy-gap metrics, read-only metrics endpoint).
- Phase 6 — judge-first UI surfacing the evidence above to reviewers.
- Phase 7 — internal engineering threat-model verification (21 threat classes,
  residual-risk register, 14 unchecked future-execution preconditions); NOT an
  independent external security audit.

Test suite: 20 test files / 270 tests, all passing (verified 2026-08-14).

## No-execution boundary

This repository does not move funds, sign transactions, hold custody, store private
keys, connect wallets, submit UserOperations, make RPC calls, execute CCTP
burn/mint, or perform live x402 / Gateway / other settlement. Every audit record and
authorization states `not_executed`; every receipt states `fundsMoved: false`. An
`ALLOW` decision means only that a separately authorised future adapter could be
considered.

## Links

- [Canonical grant package](./circle-grants-package.md) — VERIFIED / PROPOSED /
  NOT YET VALIDATED claim classes and the full per-phase evidence.
- [Submission draft](./grants/circle-grants-2026/submission.md) — grant-program
  submission text.
- [Requirements](./grants/circle-grants-2026/requirements.md) and
  [roadmap](./grants/circle-grants-2026/roadmap.md) — scope and phase plan.
