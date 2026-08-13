# Circle Grants 2026 — Pilot Plan (Proposal)

**This is a proposal. Nothing has run. No partners exist.** Every future pilot
activity described in this document is explicitly PROPOSED; the only thing that
exists today is the deterministic product evidence indexed in
[evidence.md](./evidence.md).

## Hypothesis

> Agent builders and API providers may adopt a deterministic pre-spend policy
> layer if it reduces accidental autonomous spending, makes decisions
> explainable, and produces replayable audit evidence without requiring custody.

Marked explicitly: this is a **hypothesis, not validated traction**.

## Proposed targets

Targets only — not commitments:

- 3–5 design partners;
- 100–500 proposed payment intents evaluated during the pilot;
- a 12-week pilot.

No partners are named; none have been contacted under this plan.

## Proposed 12-week milestones

- Weeks 1–2: design-partner discovery and integration requirements;
- Weeks 3–4: integration hardening around validated payment-intent contract;
- Weeks 5–7: partner sandbox / controlled proposed-intent evaluation;
- Weeks 8–9: policy-gap analysis and replay/evidence review;
- Weeks 10–11: integration feedback and security-boundary refinement;
- Week 12: pilot report and next-stage recommendation.

**No week has happened.** This is a proposed structure for a pilot that has not
started.

## Proposed metrics

Two groups are deliberately kept distinct (see
[pilot-observability.md](./pilot-observability.md)).

**SYSTEM-DERIVED TODAY** — these ten are already produced by
[`src/domain/observability/pilot-metrics.ts`](../../../src/domain/observability/pilot-metrics.ts)
and served read-only by `GET /api/pilot-metrics` today:

1. canonical intent count;
2. ALLOW / REVIEW / BLOCK counts;
3. evaluation attempt count;
4. replay count;
5. exact replay count;
6. mismatch count;
7. policy-drift observations;
8. policy-evaluation p95 (nearest-rank);
9. policy-gap reason-code signals;
10. evidence-attribution coverage (intent/policy fingerprint, policy version).

**PROPOSED / MANUAL PILOT MEASURES** — require the pilot; not measured today:

1. design-partner count;
2. integration time;
3. structured partner feedback;
4. policy gaps requiring new rules;
5. adoption willingness;
6. independent decision reproducibility (defined protocol).

Exact replay consistency is NOT the same claim as independent decision
reproducibility: the system measures idempotent replay consistency with the
persisted decision/evidence today; independent decision reproducibility remains a
PROPOSED pilot protocol.

## Budget

Budget: TBD — requires grant-program constraints and applicant decision.

Proposed budget categories (no dollar amounts):

- engineering/integration (validated payment-intent contract, adapter boundary);
- security hardening (tamper-evident audit options, authenticated identity,
  expiry enforcement — execution preconditions from
  [threat-model.md](./threat-model.md));
- pilot support (partner onboarding, sandbox operation, evidence review);
- documentation and developer experience (integration guides, fresh-clone
  reproducibility);
- controlled testnet research **only if separately authorized** — not authorized
  today.

## External grant-program facts

NOT YET VALIDATED — verify against the official current grant source before any
submission:

- deadline;
- max amount;
- required chain;
- form fields;
- eligibility;
- review process;
- decision dates.

The evidence package does not block on missing external program information: the
repository evidence in [evidence.md](./evidence.md) is complete and verifiable on
the grant branch regardless of the program's external requirements.

## Risks and dependencies

Honest, brief list (each is documented in
[threat-model.md](./threat-model.md) / [limitations.md](./limitations.md)):

- **Identity not authenticated** — `agentId` is self-asserted; spend controls are
  keyed by it (ADD-1 residual).
- **Audit log not tamper-evident** — append-only JSONL by application convention,
  in-process only; no hash chain or signature (T13 residual).
- **No cross-process concurrency control** — same-process lock only; concurrent
  processes could collide `auditId`s (T14 residual).
- **Expiry is metadata only** — `expiresAt` has no runtime enforcement; a future
  adapter must enforce it (T09 residual).
- **Demo/media parity unverified** — the deployed demo (https://138-124-108-146.nip.io)
  parity with this branch and the YouTube/MP4 walkthrough parity with the
  x402-first path are NOT YET VALIDATED.
- **Screenshots pending** — Phase 6 grant-evidence screenshots are not yet
  captured ([screenshots.md](../../screenshots.md) says pending).
- **No pilot participants** — design partners, pilot usage, and adoption all
  remain PROPOSED.
