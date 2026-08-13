# Circle Grants 2026 — Judge Demo Script

One concise reviewer path, ~2–3 minutes. The primary demo is the **x402-first
judge path**; the CitePay flow remains secondary and is not part of this script.
All data shown is local/demo — see [Demo data source](#demo-data-source) below.

## Sequence

**1. Product thesis**

> "Policy before execution. Evidence after every decision."

AgentPay Guard is a deterministic preflight policy-and-audit layer for proposed
autonomous USDC payments. It decides `ALLOW` / `REVIEW` / `BLOCK` and records
replayable evidence before any future settlement adapter — no funds move.

**2. x402-style canonical ALLOW**

Submit the x402-style API intent ([`examples/scenario-allow-api.json`](../../../examples/scenario-allow-api.json),
see [canonical-scenarios.md](./canonical-scenarios.md)): a proposed **0.08 USDC**
API micropayment against a trusted recipient → **ALLOW**. Show:

- policy attribution: `policyId`, `policyVersion` `"2"`, and the deterministic
  `policyFingerprint` (sha256 over the canonicalized policy);
- the audit ID (`auditId`) of the single canonical record;
- `executionStatus: "not_executed"`, `fundsMoved: false`.

**3. Execution Authorization**

Show the bounded envelope: `scope: single_intent`; `maxAmountUSDC: "0.08"` (the
proposed amount, never the policy cap); `executionScope: ["prepare", "simulate"]`
only; `executionStatus: "not_executed"`; `fundsMoved: false`. State: this is
bounded evidence for a future adapter — not an executable capability.

**4. Exact replay**

Click **"Replay exact intent"** (re-submits an immutable snapshot with the same
`idempotencyKey`). Show: `replayed: true`, `replayMismatch: false`,
`policyChanged: false`, the **same audit context** (same `auditId`), the **same
deterministic `authorizationId`**, and exactly **one canonical decision record**
for the key. Frame it precisely: this is idempotent replay consistency with the
persisted decision/evidence — not independent decision reproducibility.

**5. REVIEW**

Submit the machine scenario ([`examples/scenario-review-machine.json`](../../../examples/scenario-review-machine.json)):
unknown recipient → **REVIEW**, stable reason code `RECIPIENT_REVIEW_REQUIRED`.
Show: **no Execution Authorization** is issued.

**6. BLOCK**

Submit the risky scenario ([`examples/scenario-block-risky.json`](../../../examples/scenario-block-risky.json)):
denied recipient → **BLOCK**, stable reason code `RECIPIENT_BLOCKED`. Show: **no
Execution Authorization** is issued.

**7. Local pilot evidence**

Open the local pilot metrics panel (`GET /api/pilot-metrics`): canonical intent
count, ALLOW/REVIEW/BLOCK counts, evaluation-attempt and replay counters, p95
policy-evaluation duration, gap signals, evidence coverage. State explicitly:

> "These are local/demo observations, not partner traction."

No design partners, pilot usage, or adoption is claimed.

**8. Safety ending**

> "No wallet. No signing. No broadcast. No settlement. No funds moved."

Nothing in this repository executes a payment; `ALLOW` only means a separately
authorized future adapter could be considered.

## Demo data source

The demo reads and writes **local, temporary data through the app's own API**
(`POST /api/payment-intents/evaluate`, `GET /api/audit-log`,
`GET /api/pilot-metrics`) against a **temp/isolated audit and observation log**.
The demo MUST be run with the env overrides `AGENTPAY_AUDIT_LOG_PATH` and
`AGENTPAY_OBSERVATION_LOG_PATH` pointed at a temp/isolated path (see
[`.env.example`](../../../.env.example) and
[`src/lib/paths.ts`](../../../src/lib/paths.ts)) — it must NEVER run against the
tracked `data/audit-log.jsonl`, which is a repository file and must not be
modified by a demo run. Everything shown is **local/demo only** — no external
telemetry, no real payments, no network calls beyond the app's own same-origin
API routes.
