# CHECKPOINT.md

## Project direction

AgentPay Guard is a local preflight policy and audit layer for AI-agent USDC payment intents before x402, Circle Gateway, or Arc-compatible payment flows.

Current direction: the Phase 1 programmable-money context foundation on top of the existing local Ignyte / Circle / Arc builder proof.

## Branch and commit

- Branch: `feature/programmable-money-context-foundation`
- Baseline commit: `99fbc46`
- `6e6fac5 feat: add optional programmable payment context types`
- `768d9e4 feat: validate optional programmable payment context`

## Implementation status

- `PaymentIntent` now accepts optional `operation`, `spender`, `amountBaseUnits`, and `routeContext` values.
- `RouteContext` uses explicit route, finality, attestation, wallet-control, fee, and gas-preview types.
- Legacy intents remain valid without optional fields.
- Validation rejects unknown route-context fields, invalid enums, empty chains, invalid fees, non-USDC fee assets, invalid spenders, and invalid base-unit strings.
- Invalid nested context returns the existing fail-closed client error and does not reach the audit writer.
- Policy, audit schema, receipt, rail preview, scenarios, and UI behavior were not expanded.

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

- `src/domain/payment-intent/types.ts`
- `src/domain/payment-intent/validation.ts`
- `tests/payment-intent-validation.test.ts`
- `src/app/demo-client.tsx` (type-only compatibility for the existing form)

## Preview/mock only

- No CCTP route policy, ERC-20 authority policy, Paymaster policy, audit-context persistence, receipt expansion, new scenarios, or UI rendering was added.
- No live network, wallet, signing, custody, database, authentication, telemetry, or dependency was added.

## Next recommended step

Phase 2: deterministic CCTP-first route policy. Do not begin it as part of this checkpoint.
