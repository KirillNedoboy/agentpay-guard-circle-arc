# CODEX_START_PROMPTS.md

Use these prompts with Codex in order.

## Prompt 1 — Initialize implementation

Read `AGENTS.md`, `docs/internal/REQUIREMENTS.md`, `docs/internal/STATE.md`, `docs/internal/TASKS.md`, and `docs/internal/SESSION_NOTES.md`.

Implement Phase 1 only.

Build a compact TypeScript app for AgentPay Guard with:

- request validation;
- deterministic policy engine;
- decimal-safe amount comparisons;
- file-based policy config from `data/policies.default.json`;
- JSONL audit log at `data/audit-log.jsonl`;
- idempotency by `idempotencyKey`;
- API endpoint `POST /api/payment-intents/evaluate`;
- API endpoint to read recent audit log entries;
- deterministic tests for the 3 example scenarios.

Do not implement real payments, wallet signing, database, auth, or live Circle integration.

After implementation, run tests/typecheck/lint if configured, update `docs/internal/STATE.md` and `docs/internal/SESSION_NOTES.md`, and report exactly what was verified.

## Prompt 2 — Build demo UI

Read `AGENTS.md`, `docs/internal/REQUIREMENTS.md`, `docs/internal/STATE.md`, `docs/internal/TASKS.md`, and current code.

Implement Phase 2 only.

Create a single local demo UI with:

- scenario selector using the 3 example JSON files;
- editable payment intent form;
- evaluate button;
- decision card;
- matched rules display;
- audit id display;
- recent audit log table;
- architecture strip: `AI Agent → AgentPay Guard → x402/Circle Gateway/Arc`.

Do not add auth, DB, real payments, or external paid services.

Run available checks and update `docs/internal/STATE.md` and `docs/internal/SESSION_NOTES.md`.

## Prompt 3 — Proof pack

Read all docs and current app.

Implement Phase 3 only.

Finalize:

- README;
- `docs/grant-draft.md`;
- `docs/demo-script.md`;
- screenshot checklist;
- sample audit log.

Do not claim real Circle integration unless it exists.

Do not claim AML/KYC/compliance coverage.

Run the local demo and verify all 3 scenarios produce expected decisions.

Update `docs/internal/STATE.md`, `docs/internal/TASKS.md`, and `docs/internal/SESSION_NOTES.md`.
