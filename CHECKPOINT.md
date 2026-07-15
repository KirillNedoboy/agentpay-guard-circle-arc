# CHECKPOINT.md

## Project direction

AgentPay Guard is a local preflight policy and audit layer for AI-agent USDC payment intents before x402, Circle Gateway, or Arc-compatible payment flows.

Current direction: deterministic ERC-20 authority-aware policy and proposal-only base-unit explanation on top of the existing local builder proof.

## Branch and commit

- Branch: `feature/programmable-money-context-foundation`
- Baseline commit: `99fbc46`
- `6e6fac5 feat: add optional programmable payment context types`
- `768d9e4 feat: validate optional programmable payment context`
- `72b11e8 feat: add deterministic CCTP route policy`
- `8180f12 feat: add honest CCTP route preview`
- `34dfc94 feat: add ERC20 authority policy context`
- `1c8e15f feat: display ERC20 authority and USDC base units`

## Implementation status

- `PaymentIntent` now accepts optional `operation`, `spender`, `amountBaseUnits`, and `routeContext` values.
- `RouteContext` uses explicit route, finality, attestation, wallet-control, fee, and gas-preview types.
- Legacy intents remain valid without optional fields.
- Validation rejects unknown route-context fields, invalid enums, empty chains, invalid fees, non-USDC fee assets, invalid spenders, and invalid base-unit strings.
- Invalid nested context returns the existing fail-closed client error and does not reach the audit writer.
- Local CCTP policy permits only Ethereum to Base and uses `5.00` Fast Transfer and developer-control review thresholds.
- The generic `10.00` hard max is unchanged; CCTP total budget is `100.00` and uses existing decimal-string addition.
- Same-chain and unsupported CCTP routes block; claimed verified attestations, Fast Transfer, and developer-control conditions can require review.
- CCTP preview details are nested inside the existing `railPreview` value. It states that no funds moved, no burn/mint occurred, no Iris attestation was requested, and no Circle API was called.
- `approve` and `transferFrom` proposal context now has deterministic spender and allowance policy rules; direct `transfer` has no authority escalation.
- Spender policy is separate from recipients: `trusted-agent-service` is allowed and `blocked-spender` is denied.
- The base-unit helper converts valid USDC decimal strings to six-decimal units without rounding. Decimal `amount` remains the sole policy input.
- ERC-20 authority details are nested inside the existing `railPreview` value and explicitly state that no allowance/balance read, approval signature, or ERC-20 transaction occurred.
- Generic intents, generic rails, unknown rails, audit writer, receipt builder, API endpoint and top-level response fields, UI, scenarios, and public documentation were not changed.

## Validation status

Baseline validation at `99fbc46`:

```bash
pnpm install --frozen-lockfile # passed
pnpm test       # passed, 7 files, 42 tests
pnpm lint       # passed
pnpm typecheck  # passed
pnpm build      # passed
```

Final Phase 1 validation before memory update:

```bash
pnpm test       # passed, 8 files, 64 tests
pnpm lint       # passed
pnpm typecheck  # passed
pnpm build      # passed
git diff --check # passed
```

Final Phase 2 validation before memory update:

```bash
pnpm test       # passed, 8 files, 78 tests
pnpm lint       # passed
pnpm typecheck  # passed
pnpm build      # passed
git diff --check # passed
```

Final Phase 3 validation before memory update:

```bash
pnpm test       # passed, 9 files, 103 tests
pnpm lint       # passed
pnpm typecheck  # passed
pnpm build      # passed
git diff --check # passed
```

## Safety boundaries

Do not add without explicit approval:

- live Circle Gateway calls;
- live Arc integration;
- live x402 buyer/seller execution;
- wallet custody, private keys, seed phrases, or signing;
- swaps, trading, order execution, or transaction hashes;
- cron/background autonomous spend;
- DB/auth/smart contracts;
- official Circle, Arc, Ignyte, or x402 integration claims.

## Changed areas

- `data/policies.default.json`
- `src/domain/policy/policy-config.ts`
- `src/domain/policy/engine.ts`
- `tests/policy-engine.test.ts`
- `src/domain/payment-intent/types.ts`
- `src/domain/payment-intent/rail-preview.ts`
- `tests/rail-preview.test.ts`
- `src/lib/usdc-base-units.ts`
- `tests/usdc-base-units.test.ts`

## Preview/mock only

- No Paymaster policy, audit-context persistence, receipt expansion, new scenarios, or UI rendering was added.
- No live network, wallet, signing, custody, database, authentication, telemetry, or dependency was added.

## Next recommended step

Phase 4: USDC Paymaster-preview total-cost policy. Do not begin it as part of this checkpoint.
