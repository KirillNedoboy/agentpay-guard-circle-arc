# AGENTS.md — Codex Instructions for AgentPay Guard

## Project

AgentPay Guard is a builder proof / grant proof for Arc/Circle ecosystem.

It is a preflight policy and audit layer for AI-agent payments.

The MVP evaluates payment intents before an agent proceeds to x402 / Circle Gateway / Arc payment flow.

## Read first

Before editing:

1. `docs/internal/REQUIREMENTS.md`
2. `docs/internal/STATE.md`
3. `docs/internal/TASKS.md`
4. `docs/internal/SESSION_NOTES.md`
5. `README.md`

## Product boundary

AgentPay Guard:

- evaluates payment intent;
- returns `ALLOW`, `REVIEW`, or `BLOCK`;
- writes audit log;
- demonstrates how a guard layer fits before x402/Gateway payments.

AgentPay Guard does not:

- move funds;
- sign transactions;
- custody assets;
- store private keys;
- implement AML/KYC;
- guarantee fraud prevention;
- claim official Arc/Circle status.

## Tech direction

Default implementation target:

- TypeScript;
- Next.js app router or similarly compact fullstack TypeScript stack;
- file-based audit log for MVP;
- deterministic policy engine;
- no database unless explicitly requested;
- no live Circle payment integration unless explicitly requested.

## Expected commands

Implement and keep these commands working:

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
```

If a command is not available yet, add it properly or update docs honestly.

## Architecture

Expected app boundaries:

```txt
src/domain/payment-intent
src/domain/policy
src/domain/audit
src/lib/validation
src/lib/file-store
src/app/api/payment-intents/evaluate
src/app/api/audit-log
src/app/page
```

Names can differ if justified, but keep boundaries clean.

## Security rules

Never:

- commit `.env`;
- hardcode secrets;
- store API keys in logs;
- log private keys, seed phrases, tokens or signatures;
- add real payment execution in MVP;
- return `ALLOW` on internal evaluation failure;
- silently swallow errors;
- add hidden globals;
- add unsafe concurrency around audit file writes.

## Money handling

Use decimal string handling for money.

Do not use JavaScript floating-point math for policy decisions involving amounts.

Use deterministic decimal parsing/comparison.

## Audit rules

Every successful evaluation attempt must create or return an audit record.

Audit log path:

```txt
data/audit-log.jsonl
```

Audit writes must be append-only.

Same `idempotencyKey` must not create duplicate audit entries.

## Policy rules

Implement deterministic rules first:

- unsupported currency → `BLOCK`;
- invalid amount → `BLOCK`;
- denied recipient → `BLOCK`;
- amount above hard max → `BLOCK`;
- daily spend limit exceeded → `BLOCK`;
- unknown recipient → `REVIEW`;
- unknown scenario → `REVIEW`;
- suspicious intent keywords → risk increase;
- velocity limit exceeded → `REVIEW`;
- clean known recipient/scenario/amount → `ALLOW`.

No opaque AI scoring in MVP.

## Testing rules

Add deterministic tests for:

- allow scenario;
- review scenario;
- block scenario;
- invalid amount;
- unsupported currency;
- idempotency;
- audit JSONL validity;
- internal failure posture if applicable.

## Documentation rules

Update docs when behavior changes:

- `README.md`
- `docs/internal/REQUIREMENTS.md` if product scope changes;
- `docs/internal/STATE.md`
- `docs/internal/SESSION_NOTES.md`

Do not make fake claims about Arc, Circle, grants, points, or APIs.

If current external conditions matter, mark as "verify against official sources".

## Ask first

Ask before:

- adding database;
- adding auth;
- adding wallet/signing;
- adding live Circle API calls;
- changing product positioning;
- adding smart contracts;
- introducing paid third-party services.

## Definition of done

A task is done only if:

- implementation matches `docs/internal/REQUIREMENTS.md`;
- tests or manual verification were run;
- errors are handled explicitly;
- no secrets are present;
- docs/state are updated;
- no fake claims are introduced.
