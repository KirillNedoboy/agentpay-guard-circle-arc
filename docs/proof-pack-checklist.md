# Proof Pack Checklist

## Repository

- [ ] GitHub repo ready
- [x] README complete
- [x] local demo runs
- [x] tests pass
- [x] x402 policy-envelope flow and `ALLOW` / `REVIEW` / `BLOCK` cases verified
- [x] audit-log.jsonl exists
- [x] repo hygiene verified

## Proof Assets

- [x] screenshots captured
- [x] grant draft ready
- [x] demo script ready
- [x] launch post ready

## Safety / Scope

- [x] no real funds/private keys
- [x] no fake compliance claims
- [x] no live Circle API calls in MVP
- [x] no wallet signing in MVP
- [x] no database/auth/smart contracts in MVP

## Scenario Files

- [x] `examples/scenario-allow-api.json` -> `ALLOW`
- [x] `examples/scenario-review-machine.json` -> CitePay `REVIEW`
- [x] `examples/scenario-block-risky.json` -> hard `BLOCK`
- [x] `examples/scenario-review-cctp-fast-transfer.json` -> programmable `REVIEW`
- [x] `examples/scenario-allow-cctp-standard.json` -> programmable `ALLOW`
- [x] `examples/scenario-block-cctp-route.json` -> programmable `BLOCK`
- [x] `examples/scenario-review-erc20-approval.json` -> authority `REVIEW`
- [x] `examples/scenario-review-paymaster.json` -> fee-budget `REVIEW`
