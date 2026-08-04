# Screenshot Checklist

Create these screenshots after demo implementation. Do not use placeholders or generated fake screenshots.

## docs/assets/screenshots/x402-policy-envelope.png

Must show:

- the trusted `0.08 USDC` x402-style API intent;
- `ALLOW`, matched rules, and reason codes;
- per-request, daily, projected, and velocity spend controls;
- audit ID / AgentPay Receipt;
- `broadcast: false`, `not executed`, and no-funds-moved boundary.

## screenshots/01-allow-decision.png

Must show:

- selected API nanopayment scenario;
- decision `ALLOW`;
- low risk score;
- audit id;
- matched rules.

## screenshots/02-review-decision.png

Must show:

- selected machine-to-machine scenario;
- decision `REVIEW`;
- medium risk score;
- reason;
- audit id.

## screenshots/03-block-decision.png

Must show:

- selected risky spend scenario;
- decision `BLOCK`;
- high risk score;
- blocked reason;
- audit id.

## screenshots/04-audit-log.png

Must show:

- recent audit log table;
- rows for the three demo scenarios;
- audit ids and decisions visible.

## Optional

- architecture strip screenshot;
- audit log JSONL opened in editor;
- repo tree screenshot.
