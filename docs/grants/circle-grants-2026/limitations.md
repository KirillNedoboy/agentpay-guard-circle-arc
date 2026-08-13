# Circle Grants 2026 — Limitations (Phase 0)

This document states the explicit non-negotiable boundary of AgentPay Guard at baseline
`eb28fe7973cdd3d770de155556c23ee214c6ef33`. It mirrors and links the safety boundary in
[`docs/circle-grants-package.md`](../../circle-grants-package.md) and the
[README](../../../README.md).

## The current product does NOT

- move funds;
- hold custody;
- store private keys;
- sign transactions;
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

## Preserved model

- Every AgentPay Receipt records `fundsMoved: false`.
- Arc adapter evidence is a local deterministic preview only: `broadcast: false`,
  `status: "not_executed"`.
- CCTP, ERC-20 authority, Paymaster, and x402 contexts are proposal-only policy inputs,
  not protocol calls or integrations.
- `ALLOW` means only that a separately authorised future adapter could be considered.
  It never means funds moved, and no such adapter exists in this repository.

Any change that crosses this boundary requires explicit operator authorization and its
own tests; none is planned in the grant phases documented in
[`roadmap.md`](./roadmap.md).
