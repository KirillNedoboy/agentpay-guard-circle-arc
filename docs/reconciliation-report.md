# Canonical Reconciliation and Release Report

Date: 2026-08-02

## Canonical history

- Canonical remote: `https://github.com/KirillNedoboy/agentpay-guard-circle-arc`
- Canonical base: `origin/main` at `cff7b36192cffca02edce58154d5c3414f03c18b`
- Preserved source branch: `origin/feature/ignyte-circle-arc-preview` at `aa3b860893172c07a307ba544347617ae6fdff6f`
- Verified merge base: `960fc2598deca10fb948f41a64630c75a8cf756f`
- Safety refs created before integration: branch and annotated tag `safety/main-before-ignyte-reconciliation-20260802`
- Integration branch: `integration/ignyte-circle-arc-preview`, created from canonical `origin/main`

The feature branch was compared at file level. This branch ports only compatible x402 policy-envelope semantics; it does not merge unrelated history or cherry-pick the feature commit wholesale.

## Preserved from canonical main

- GitHub Actions CI, public deck/video assets, legacy screenshots, and historical append-only `data/audit-log.jsonl`.
- AgentPay Receipt, `fundsMoved: false`, idempotency, fail-closed evaluation, and existing CCTP, ERC-20, and Paymaster proposal contexts.
- Canonical public repository, live-demo, YouTube, fallback-MP4, one-pager, and deck URLs.

## Ported and integrated behavior

- Decimal-safe `SpendControls` for per-request limits, daily allowed/remaining/projected spend, and velocity counts.
- The deterministic trusted `0.08 USDC` x402-style judge preset, persisted spend evidence, and a local future-adapter preview with `broadcast: false` and `status: "not_executed"`.
- An x402-first UI proof showing decision, matched rules, reason codes, audit trace, receipt, and proposal-only boundary. CCTP, ERC-20, and Paymaster remain visible secondary contexts; CitePay remains illustrative and collapsed.
- A portable deck generator, rebuilt PDF/preview, and a browser-captured x402 policy-envelope screenshot.

## Deliberately omitted feature-branch deletions

The feature branch removed CI, deck/video/screenshot assets, receipt and programmable-context code, historical audit data, and tests for CCTP/ERC-20/Paymaster behavior. Those deletions were not ported because they would regress the canonical proof, public assets, or compatibility coverage. Its separate live-looking Arc simulation was also not ported; the integrated preview is explicitly local, deterministic, and non-broadcasting.

## Confirmed cleanup

After an inbound-reference search excluding only the candidate files, these unreferenced stale artifacts were removed:

- Five Lepton-only submission/demo documents under `docs/lepton-*`.
- Four obsolete Discord QR PNGs under `docs/qr-*`.
- Four obsolete `docs/superpowers` design/plan artifacts.

They are recoverable from Git history. No legacy public deck/video assets, CI, screenshots, or historical audit data were removed.

## Verification

Baseline on canonical `origin/main` before edits:

```bash
pnpm test       # passed: 142 tests / 10 files
pnpm lint       # passed
pnpm typecheck  # passed
pnpm build      # passed
```

Final integration verification:

```bash
pnpm test       # passed: 147 tests / 13 files
pnpm lint       # passed
pnpm typecheck  # passed
pnpm build      # passed
pnpm smoke      # passed against local production server
```

The production-browser proof invoked the x402 CTA and observed `ALLOW`, audit ID, spend envelope, receipt, `fundsMoved: false`, and `broadcast: false`. The browser recorded no console errors. The smoke server used `AGENTPAY_AUDIT_LOG_PATH` outside the repository and wrote four temporary records; the historical repository audit log was not rewritten. The rebuilt seven-page PDF was rendered to PNG and visually reviewed. Poppler emitted non-fatal Unicode resource warnings while rendering but produced all seven pages.

## Public-link probe

Checked with `curl -L` on 2026-08-02:

| Asset | Result |
| --- | --- |
| Repository | `200` |
| Raw README | `200` |
| Reviewer one-pager | `200` |
| Deck | `200` |
| YouTube | `200`, one redirect to `youtube.com` |
| Fallback MP4 | `200` |
| Live demo | timed out after 5.008 seconds; no HTTP response was received |

The public `main` documents and deck links still resolve to the pre-merge assets until this integration PR is merged. The live demo must be manually redeployed from merged `main` and then rechecked. The existing YouTube/MP4 links are preserved, but their content has not been re-recorded for the x402-first path and needs manual media review before the final Encode submission.

## Remaining manual release actions

1. Review and merge the integration PR; do not force-push main.
2. Manually redeploy the live demo from merged `main`, then recheck the public URL.
3. Review or re-record the YouTube and fallback video for the x402-first click path.
4. Submit the final Encode form only after the previous actions are complete.
