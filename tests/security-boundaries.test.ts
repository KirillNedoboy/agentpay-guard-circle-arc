/**
 * security-boundaries.test.ts
 *
 * Security-boundary evidence for the guard layer: replay substitution,
 * tamper detection limits, policy drift, legacy records, authorization scope,
 * concurrency idempotency, junk-field dropping, and fail-closed posture.
 *
 * Threat IDs (T02–T15) mirror the boundary review. Residual pins document
 * ACTUAL behavior that is not enforced, with honest names — nothing here is
 * fixed, only pinned.
 *
 * Conventions: temp paths only (mkdtempSync + AGENTPAY_* env overrides
 * restored in afterEach), no writes to data/, no mocks of execution, no fake
 * transaction hashes/wallets/signatures. Junk fields in T15 are INPUT only
 * and asserted dropped.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createOrReuseAuditRecordWithEvidence, readAllAuditRecords } from "@/domain/audit/audit-log";
import { buildExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import { buildReplayEvidence } from "@/domain/audit/replay-evidence";
import { evaluatePaymentIntent, safeEvaluatePaymentIntent } from "@/domain/payment-intent/evaluate";
import { fingerprintIntent } from "@/domain/payment-intent/intent-fingerprint";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import type { PolicyConfig } from "@/domain/policy/policy-config";

const policy = loadPolicyConfig(join(process.cwd(), "data", "policies.default.json"));

const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-boundaries-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

afterEach(() => {
  if (previousAuditPath === undefined) {
    delete process.env.AGENTPAY_AUDIT_LOG_PATH;
  } else {
    process.env.AGENTPAY_AUDIT_LOG_PATH = previousAuditPath;
  }
  if (previousObservationPath === undefined) {
    delete process.env.AGENTPAY_OBSERVATION_LOG_PATH;
  } else {
    process.env.AGENTPAY_OBSERVATION_LOG_PATH = previousObservationPath;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeApiIntent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent_boundary_001",
    intent: "Buy premium verification data from a trusted x402 API for an agent research task",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "boundary-key-001",
    ...overrides
  };
}

function countJsonlLines(auditPath: string): number {
  const content = readFileSync(auditPath, "utf8");
  if (content.trim().length === 0) {
    return 0;
  }
  return content.trim().split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function rewriteLastAuditLine(auditPath: string, mutate: (record: Record<string, unknown>) => void) {
  const lines = readFileSync(auditPath, "utf8").trim().split(/\r?\n/);
  const record = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  mutate(record);
  lines[lines.length - 1] = JSON.stringify(record);
  writeFileSync(auditPath, `${lines.join("\n")}\n`, "utf8");
}

type EvaluationBody = {
  decision: string;
  reasonCodes: string[];
  auditId: string;
  executionAuthorization?: {
    authorizationId: string;
    recipient: string;
    agentId: string;
    scope: string;
    executionScope: string[];
    executionStatus: string;
    fundsMoved: boolean;
    maxAmountUSDC: string;
    issuedAt: string;
    expiresAt: string;
  };
  replayEvidence: {
    replayed: boolean;
    replayMismatch: boolean | null;
    policyChanged: boolean | null;
    storedIntentFingerprint: string | null;
    currentIntentFingerprint: string;
  };
  pilotObservability: { observationRecorded: boolean };
};

describe("security boundaries: replay substitution and binding (T02–T04)", () => {
  test("T02 recipient substitution: same key, changed recipient → mismatch, no authorization, stored recipient preserved", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t02-recipient-substitution";

    const original = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;
    expect(original.decision).toBe("ALLOW");
    expect(original.executionAuthorization).toBeDefined();

    const substituted = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: key, recipient: "market-data-api.demo" })
    )) as unknown as EvaluationBody;

    expect(substituted.replayEvidence).toMatchObject({ replayed: true, replayMismatch: true, policyChanged: false });
    expect(substituted).not.toHaveProperty("executionAuthorization");
    expect(substituted.decision).toBe("ALLOW"); // historical decision preserved, never re-evaluated
    expect(countJsonlLines(auditPath)).toBe(1);

    const [stored] = readAllAuditRecords(auditPath);
    expect(stored.idempotencyKey).toBe(key);
    expect(stored.recipient).toBe("trusted-x402-api.demo"); // original recipient preserved
    expect(stored.recipient).not.toBe("market-data-api.demo");
  });

  test("T03 binding: authorization.recipient === request recipient === persisted audit recipient", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t03-binding";

    const body = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;

    expect(body.executionAuthorization?.recipient).toBe("trusted-x402-api.demo");
    const [stored] = readAllAuditRecords(auditPath);
    expect(stored.recipient).toBe("trusted-x402-api.demo");
    expect(body.executionAuthorization?.recipient).toBe(stored.recipient);
    expect(body.executionAuthorization?.agentId).toBe("agent_boundary_001");
  });

  test("T04 amount substitution: same key, changed amount → fingerprint differs, mismatch, no authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t04-amount-substitution";

    const first = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;
    const second = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: key, amount: "0.09" })
    )) as unknown as EvaluationBody;

    expect(first.replayEvidence.currentIntentFingerprint).not.toBe(
      fingerprintIntent(validatePaymentIntent(makeApiIntent({ idempotencyKey: key, amount: "0.09" })))
    );
    expect(second.replayEvidence).toMatchObject({ replayed: true, replayMismatch: true });
    expect(second).not.toHaveProperty("executionAuthorization");
    expect(countJsonlLines(auditPath)).toBe(1);
    const [stored] = readAllAuditRecords(auditPath);
    expect(stored.amount).toBe("0.08");
  });

  test("T04 binding: maxAmountUSDC equals the proposed amount, not the policy max (4.20 example)", () => {
    // Reality pin: amount "4.20" exceeds reviewThreshold "0.20", so it is REVIEW
    // under the DEFAULT policy and would never authorize. To demonstrate the
    // brief's example we evaluate against an in-memory clone of the default
    // policy with reviewThreshold raised — the stored maxAmountUSDC must still
    // bind the PROPOSED amount ("4.20"), never the policy cap ("10.00").
    const clonedPolicy: PolicyConfig = { ...policy, limits: { ...policy.limits, reviewThreshold: "5.00" } };
    const intent = validatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t04-amount-binding", amount: "4.20" })
    );

    const decision = evaluatePolicy(intent, clonedPolicy, []);
    expect(decision.decision).toBe("ALLOW");

    const authorization = buildExecutionAuthorization(
      {
        eventType: "agent_payment_guard_evaluated",
        auditId: "audit_t04_binding_000001",
        timestamp: "2026-08-14T10:00:00.000Z",
        intentId: "boundary-t04-amount-binding",
        idempotencyKey: "boundary-t04-amount-binding",
        agentId: intent.agentId,
        intent: intent.intent,
        amount: intent.amount,
        amountUSDC: intent.amount,
        currency: intent.currency,
        recipient: intent.recipient,
        recipientId: intent.recipient,
        recipientLabel: intent.recipient,
        scenario: intent.scenario,
        purpose: "api_data_purchase",
        paymentRail: intent.paymentRail,
        rail: "mock_x402_service",
        decision: decision.decision,
        riskScore: decision.riskScore,
        policyId: decision.policyId,
        policyVersion: decision.policyVersion,
        policyFingerprint: decision.policyFingerprint,
        intentFingerprint: fingerprintIntent(intent),
        executionStatus: "not_executed",
        matchedRules: decision.matchedRules,
        reasonCodes: decision.reasonCodes,
        reason: decision.reason,
        executionMode: "mock_preview",
        railPreview: {
          rail: "mock_x402_service",
          networkLabel: "x402-compatible paid API",
          settlementAsset: "USDC",
          executionMode: "mock_preview",
          recipientId: intent.recipient,
          amountUSDC: intent.amount,
          explanation: "Preview only."
        }
      },
      clonedPolicy
    );

    expect(authorization).not.toBeNull();
    expect(authorization?.maxAmountUSDC).toBe("4.20");
    expect(authorization?.maxAmountUSDC).not.toBe(clonedPolicy.limits.maxAmountPerPayment);
  });
});

describe("security boundaries: route and programmable-context substitution (T05)", () => {
  test("T05 route substitution: changed routeContext.destinationChain → mismatch, no authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t05-route-destination";
    const route = (destinationChain: string) => ({
      routeContext: { transferMode: "single-chain", sourceChain: "ethereum", destinationChain }
    });

    const first = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: key, ...route("ethereum") })
    )) as unknown as EvaluationBody;
    expect(first.decision).toBe("ALLOW");

    const second = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: key, ...route("base") })
    )) as unknown as EvaluationBody;

    expect(second.replayEvidence).toMatchObject({ replayed: true, replayMismatch: true });
    expect(second).not.toHaveProperty("executionAuthorization");
    expect(countJsonlLines(auditPath)).toBe(1);
  });

  test("T05 route substitution: changed routeContext.estimatedFee (0.50 → 1.25) → mismatch, no authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t05-route-fee";
    const route = (estimatedFee: string) => ({
      routeContext: {
        transferMode: "cctp",
        sourceChain: "ethereum",
        destinationChain: "base",
        estimatedFee,
        feeAsset: "USDC"
      }
    });

    const first = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: key, ...route("0.50") })
    )) as unknown as EvaluationBody;
    expect(first.decision).toBe("ALLOW");

    const second = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: key, ...route("1.25") })
    )) as unknown as EvaluationBody;

    expect(second.replayEvidence).toMatchObject({ replayed: true, replayMismatch: true });
    expect(second).not.toHaveProperty("executionAuthorization");
    expect(countJsonlLines(auditPath)).toBe(1);
  });

  test("T05 operation/spender/amountBaseUnits substitution: each participates in the fingerprint when present", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    // operation substitution
    const keyOp = "boundary-t05-op-substitution";
    const opFirst = (await evaluatePaymentIntent(
      makeApiIntent({
        idempotencyKey: keyOp,
        operation: "approve",
        spender: "trusted-agent-service",
        amountBaseUnits: "80000"
      })
    )) as unknown as EvaluationBody;
    expect(opFirst.decision).toBe("ALLOW");
    const opSecond = (await evaluatePaymentIntent(
      makeApiIntent({
        idempotencyKey: keyOp,
        operation: "transferFrom",
        spender: "trusted-agent-service",
        amountBaseUnits: "80000"
      })
    )) as unknown as EvaluationBody;
    expect(opSecond.replayEvidence.replayMismatch).toBe(true);
    expect(opSecond).not.toHaveProperty("executionAuthorization");

    // spender substitution (approve does not consult the spender allowlist, both ALLOW)
    const keySp = "boundary-t05-spender-substitution";
    const spFirst = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: keySp, operation: "approve", spender: "spender-a.demo" })
    )) as unknown as EvaluationBody;
    expect(spFirst.decision).toBe("ALLOW");
    const spSecond = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: keySp, operation: "approve", spender: "spender-b.demo" })
    )) as unknown as EvaluationBody;
    expect(spSecond.replayEvidence.replayMismatch).toBe(true);
    expect(spSecond).not.toHaveProperty("executionAuthorization");

    // amountBaseUnits substitution
    const keyUnits = "boundary-t05-units-substitution";
    const unitsFirst = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: keyUnits, amountBaseUnits: "80000" })
    )) as unknown as EvaluationBody;
    expect(unitsFirst.decision).toBe("ALLOW");
    const unitsSecond = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: keyUnits, amountBaseUnits: "81000" })
    )) as unknown as EvaluationBody;
    expect(unitsSecond.replayEvidence.replayMismatch).toBe(true);
    expect(unitsSecond).not.toHaveProperty("executionAuthorization");

    // direct fingerprint participation evidence
    expect(fingerprintIntent(validatePaymentIntent(makeApiIntent({ operation: "approve", spender: "s.demo" })))).not.toBe(
      fingerprintIntent(validatePaymentIntent(makeApiIntent({ operation: "transfer", spender: "s.demo" })))
    );
    expect(fingerprintIntent(validatePaymentIntent(makeApiIntent({ spender: "spender-a.demo" })))).not.toBe(
      fingerprintIntent(validatePaymentIntent(makeApiIntent({ spender: "spender-b.demo" })))
    );
    expect(fingerprintIntent(validatePaymentIntent(makeApiIntent({ amountBaseUnits: "80000" })))).not.toBe(
      fingerprintIntent(validatePaymentIntent(makeApiIntent({ amountBaseUnits: "81000" })))
    );

    expect(countJsonlLines(auditPath)).toBe(3);
  });
});

describe("security boundaries: policy drift and legacy records (T06–T07)", () => {
  test("T06 policy drift: same key replayed under a changed policy (same version) → policyChanged, no authorization", async () => {
    const auditPath = makeTempAuditPath();
    const key = "boundary-t06-policy-drift";
    const intent = validatePaymentIntent(makeApiIntent({ idempotencyKey: key }));
    // evaluatePaymentIntent always loads the on-disk default policy; a modified
    // policy must be injected at the domain layer (in-memory clone, never a
    // change to data/policies.default.json).
    const driftedPolicy: PolicyConfig = { ...policy, limits: { ...policy.limits, maxAmountPerPayment: "10.01" } };
    expect(driftedPolicy.policyVersion).toBe(policy.policyVersion); // same version "2", different fingerprint

    const firstDecision = evaluatePolicy(intent, policy, []);
    const { record, replayed } = await createOrReuseAuditRecordWithEvidence(auditPath, intent, firstDecision);
    expect(replayed).toBe(false);
    expect(record.decision).toBe("ALLOW");

    const replayedDecision = evaluatePolicy(intent, driftedPolicy, [record]);
    const replay = await createOrReuseAuditRecordWithEvidence(auditPath, intent, replayedDecision);
    expect(replay.replayed).toBe(true);

    const evidence = buildReplayEvidence(replay.record, fingerprintIntent(intent), driftedPolicy, replay.replayed);
    expect(evidence).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: true });
    expect(buildExecutionAuthorization(replay.record, driftedPolicy)).toBeNull();
    // sanity: the same stored record still authorizes under the policy it was written under
    expect(buildExecutionAuthorization(replay.record, policy)).not.toBeNull();
    expect(countJsonlLines(auditPath)).toBe(1);
  });

  test("T07 legacy record: no stored attribution → replay reports null, no authorization, file bytes unchanged", async () => {
    const auditPath = makeTempAuditPath();
    const key = "boundary-t07-legacy";
    const legacyLine = JSON.stringify({
      auditId: "audit_20260527_000001",
      timestamp: "2026-05-27T20:25:26.560Z",
      idempotencyKey: key,
      agentId: "agent_boundary_001",
      intent: "Pay $0.005 USDC for market data API access",
      amount: "0.005",
      currency: "USDC",
      recipient: "market-data-api.demo",
      scenario: "api_access",
      paymentRail: "x402_gateway_nanopayment",
      decision: "ALLOW",
      riskScore: 10,
      policyId: "default-agentpay-policy-v1",
      matchedRules: ["recipient_allowlisted", "scenario_allowed", "amount_below_per_payment_limit"],
      reason: "Recipient is allowlisted, amount is below limits, and scenario is allowed."
    });
    writeFileSync(auditPath, `${legacyLine}\n`, "utf8");
    const before = readFileSync(auditPath);

    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const body = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;

    expect(body.replayEvidence).toMatchObject({ replayed: true, replayMismatch: null, policyChanged: null });
    expect(body.replayEvidence.storedIntentFingerprint).toBeNull();
    expect(body).not.toHaveProperty("executionAuthorization");
    expect(body.decision).toBe("ALLOW"); // historical stored decision preserved
    expect(readFileSync(auditPath)).toEqual(before); // exact bytes unchanged after reading
    expect(countJsonlLines(auditPath)).toBe(1);
  });
});

describe("security boundaries: authorization scope and derivation (T08–T09)", () => {
  test("T08 scope: single_intent, prepare/simulate only, not_executed, fundsMoved false", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const body = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: "boundary-t08-scope" }))) as unknown as EvaluationBody;
    const authorization = body.executionAuthorization;

    expect(authorization).toBeDefined();
    expect(authorization?.scope).toBe("single_intent");
    expect(authorization?.executionScope).toEqual(["prepare", "simulate"]);
    expect(authorization?.executionScope).not.toEqual(
      expect.arrayContaining(["execute", "submit", "broadcast", "sign", "settle", "verify"])
    );
    expect(authorization?.executionStatus).toBe("not_executed");
    expect(authorization?.fundsMoved).toBe(false);
  });

  test("T09 derivation: expiresAt === issuedAt + ttlSeconds (300), deterministic", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const first = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: "boundary-t09-ttl" }))) as unknown as EvaluationBody;
    const second = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: "boundary-t09-ttl" }))) as unknown as EvaluationBody;

    const auth = first.executionAuthorization;
    expect(auth).toBeDefined();
    expect(Date.parse(auth!.expiresAt) - Date.parse(auth!.issuedAt)).toBe(policy.authorization.ttlSeconds * 1000);
    expect(second.executionAuthorization?.issuedAt).toBe(auth?.issuedAt);
    expect(second.executionAuthorization?.expiresAt).toBe(auth?.expiresAt);
    expect(second.executionAuthorization?.authorizationId).toBe(auth?.authorizationId);
  });

  test("T09 residual: no runtime expiry enforcement — tampered past timestamp still authorizes", async () => {
    // documents T09 residual: issuedAt/expiresAt are read from the STORED record;
    // nothing re-checks that the authorization is still valid at replay time.
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t09-expiry-residual";

    const first = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;
    expect(first.executionAuthorization).toBeDefined();

    // Rewrite the stored record's timestamp to ~10 minutes ago: the authorization
    // derived from it is already expired (issued 10min ago + 5min TTL).
    const tamperedTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    rewriteLastAuditLine(auditPath, (record) => {
      record.timestamp = tamperedTimestamp;
    });

    const replayed = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;

    expect(replayed.replayEvidence).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: false });
    expect(replayed.executionAuthorization).toBeDefined(); // still issued — no runtime expiry check
    expect(replayed.executionAuthorization?.issuedAt).toBe(tamperedTimestamp);
    expect(replayed.executionAuthorization?.expiresAt).toBe(
      new Date(Date.parse(tamperedTimestamp) + policy.authorization.ttlSeconds * 1000).toISOString()
    );
    expect(Date.parse(replayed.executionAuthorization!.expiresAt)).toBeLessThan(Date.now()); // already expired
  });
});

describe("security boundaries: limits, daily spend, and identity (T11)", () => {
  test("T11 hard max: amount 99.00 (> 10.00) → BLOCK, no authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const body = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-hard-max", amount: "99.00" })
    )) as unknown as EvaluationBody;

    expect(body.decision).toBe("BLOCK");
    expect(body.reasonCodes).toContain("AMOUNT_EXCEEDS_SINGLE_PAYMENT_LIMIT");
    expect(body).not.toHaveProperty("executionAuthorization");
    expect(countJsonlLines(auditPath)).toBe(1);
  });

  test("T11 daily projected spend exceeded → BLOCK via daily_limit_exceeded (cloned policy)", async () => {
    // Reality pin: under the DEFAULT policy the per-payment reviewThreshold
    // (0.20) caps ALLOW amounts at 0.20, so the daily limit (25.00) can never
    // be reached through ALLOW records in a test. The daily-projected rule is
    // pinned against an in-memory clone with dailyLimitPerAgent "0.30".
    const auditPath = makeTempAuditPath();
    const dailyPolicy: PolicyConfig = { ...policy, limits: { ...policy.limits, dailyLimitPerAgent: "0.30" } };
    const agentId = "agent_daily_boundary_001";

    const intentA1 = validatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-daily-1", agentId, amount: "0.20" })
    );
    const decisionA1 = evaluatePolicy(intentA1, dailyPolicy, []);
    expect(decisionA1.decision).toBe("ALLOW");
    await createOrReuseAuditRecordWithEvidence(auditPath, intentA1, decisionA1);

    const intentA2 = validatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-daily-2", agentId, amount: "0.20" })
    );
    const recordsBeforeA2 = readAllAuditRecords(auditPath);
    const decisionA2 = evaluatePolicy(intentA2, dailyPolicy, recordsBeforeA2);
    expect(decisionA2.decision).toBe("BLOCK");
    expect(decisionA2.matchedRules).toContain("daily_limit_exceeded");
    expect(decisionA2.matchedRules).not.toContain("amount_above_hard_max"); // 0.20 ≤ 10.00 — daily rule alone
    expect(decisionA2.reasonCodes).toContain("SESSION_BUDGET_EXCEEDED");
    expect(decisionA2.reasonCodes).not.toContain("AMOUNT_EXCEEDS_SINGLE_PAYMENT_LIMIT");
    await createOrReuseAuditRecordWithEvidence(auditPath, intentA2, decisionA2);

    const records = readAllAuditRecords(auditPath);
    expect(records.map((record) => record.decision)).toEqual(["ALLOW", "BLOCK"]);
  });

  test("T11 reality pin: 10.00 then 20.00 under the default policy (10.00 is REVIEW, 20.00 BLOCKs on hard max)", async () => {
    // The brief's example assumed a 10.00 payment ALLOWs and that the second
    // evaluation BLOCKs on projected daily spend (30 > 25). Under the actual
    // default policy, 10.00 > reviewThreshold 0.20 → REVIEW (never ALLOW), and
    // daily accounting only counts ALLOW records, so 20.00 BLOCKs on the hard
    // max, not the daily rule. Pinning actual behavior; the pure daily rule is
    // pinned separately with a cloned policy.
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const agentId = "agent_t11_reality_001";

    const first = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-reality-1", agentId, amount: "10.00" })
    )) as unknown as EvaluationBody;
    expect(first.decision).toBe("REVIEW");
    expect(first.reasonCodes).toContain("AMOUNT_EXCEEDS_REVIEW_THRESHOLD");
    expect(first).not.toHaveProperty("executionAuthorization");

    const second = (await evaluatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-reality-2", agentId, amount: "20.00" })
    )) as unknown as EvaluationBody;
    expect(second.decision).toBe("BLOCK");
    expect(second.reasonCodes).toContain("AMOUNT_EXCEEDS_SINGLE_PAYMENT_LIMIT");
    expect(second.reasonCodes).not.toContain("SESSION_BUDGET_EXCEEDED"); // 20 ≤ 25 projected — daily rule not the cause
    expect(second).not.toHaveProperty("executionAuthorization");
  });

  test("T11 residual: rotating self-asserted agentId resets daily context (identity not authenticated)", async () => {
    // documents T11 residual: limits are enforced per CLAIMED agentId; the
    // claim is self-asserted, so a different agentId starts a fresh daily
    // bucket for the same actor.
    const auditPath = makeTempAuditPath();
    const dailyPolicy: PolicyConfig = { ...policy, limits: { ...policy.limits, dailyLimitPerAgent: "0.30" } };
    const agentA = "agent_daily_identity_a";

    const intentA1 = validatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-identity-1", agentId: agentA, amount: "0.20" })
    );
    await createOrReuseAuditRecordWithEvidence(auditPath, intentA1, evaluatePolicy(intentA1, dailyPolicy, []));

    const intentA2 = validatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-identity-2", agentId: agentA, amount: "0.20" })
    );
    const decisionA2 = evaluatePolicy(intentA2, dailyPolicy, readAllAuditRecords(auditPath));
    expect(decisionA2.decision).toBe("BLOCK"); // agentA exhausted 0.30 daily budget

    const intentB = validatePaymentIntent(
      makeApiIntent({ idempotencyKey: "boundary-t11-identity-3", agentId: "agent_daily_identity_b", amount: "0.20" })
    );
    const decisionB = evaluatePolicy(intentB, dailyPolicy, readAllAuditRecords(auditPath));
    expect(decisionB.decision).toBe("ALLOW"); // fresh claimed agentId → fresh daily bucket
  });
});

describe("security boundaries: stored-record tamper (T12–T13) and corrupt input (T13b)", () => {
  test("T12 tamper: edited stored intentFingerprint → replayMismatch, no authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t12-fingerprint-tamper";

    const first = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;
    expect(first.executionAuthorization).toBeDefined();

    rewriteLastAuditLine(auditPath, (record) => {
      record.intentFingerprint = `sha256:${"f".repeat(64)}`;
    });

    const replayed = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;

    expect(replayed.replayEvidence).toMatchObject({ replayed: true, replayMismatch: true });
    expect(replayed.replayEvidence.storedIntentFingerprint).toBe(`sha256:${"f".repeat(64)}`);
    expect(replayed).not.toHaveProperty("executionAuthorization");
    expect(replayed.decision).toBe("ALLOW"); // historical decision preserved
    expect(countJsonlLines(auditPath)).toBe(1);
  });

  test("T13 residual: edited stored amount fields are trusted as-is (no per-record signature)", async () => {
    // documents T13 residual: only the stored intentFingerprint is verified on
    // replay. Editing other stored fields (amount/amountUSDC here) leaves the
    // fingerprint intact, so the re-issued authorization carries the EDITED
    // amount. There is no per-record signature over the stored fields.
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t13-amount-tamper";

    const first = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;
    expect(first.executionAuthorization?.maxAmountUSDC).toBe("0.08");

    rewriteLastAuditLine(auditPath, (record) => {
      record.amount = "0.99";
      record.amountUSDC = "0.99";
    });

    // Replay the ORIGINAL request (amount 0.08): fingerprint still matches the
    // stored (unedited) intentFingerprint.
    const replayed = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: key }))) as unknown as EvaluationBody;

    expect(replayed.replayEvidence).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: false });
    expect(replayed.executionAuthorization).toBeDefined(); // authorization re-issued from the tampered record
    expect(replayed.executionAuthorization?.maxAmountUSDC).toBe("0.99"); // edited amount trusted as-is
    expect(replayed.executionAuthorization?.maxAmountUSDC).not.toBe("0.08"); // differs from the replayed request
  });

  test("T13b corrupt audit line: evaluation fails closed — never ALLOW, never an authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const first = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: "boundary-t13b-valid" }))) as unknown as EvaluationBody;
    expect(first.decision).toBe("ALLOW");
    expect(first.executionAuthorization).toBeDefined();

    writeFileSync(auditPath, `${readFileSync(auditPath, "utf8")}this-line-is-not-json\n`, "utf8");
    const before = readFileSync(auditPath);

    const freshKeyIntent = makeApiIntent({ idempotencyKey: "boundary-t13b-corrupt-read" });
    // readRecentAuditRecords JSON.parse throws → evaluatePaymentIntent rejects
    await expect(evaluatePaymentIntent(freshKeyIntent)).rejects.toThrow();

    const response = await safeEvaluatePaymentIntent(freshKeyIntent);
    const body = (await response.json()) as {
      decision: string;
      matchedRules: string[];
      auditId: string | null;
      executionAuthorization?: unknown;
    };
    expect(response.status).toBe(500);
    expect(body.decision).toBe("REVIEW");
    expect(body.decision).not.toBe("ALLOW");
    expect(body.matchedRules).toEqual(["internal_evaluation_failure"]);
    expect(body.auditId).toBeNull();
    expect(body).not.toHaveProperty("executionAuthorization");
    expect(readFileSync(auditPath)).toEqual(before); // no new line was appended
  });
});

describe("security boundaries: concurrency and junk input (T14–T15, ADD-1)", () => {
  test("T14 Promise.all of 10 same-key evaluations → exactly one canonical line, one fresh replay", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const intent = makeApiIntent({ idempotencyKey: "boundary-t14-concurrency" });

    const results = (await Promise.all(
      Array.from({ length: 10 }, () => evaluatePaymentIntent(intent))
    )) as unknown as EvaluationBody[];

    const fresh = results.filter((result) => result.replayEvidence.replayed === false);
    const replayed = results.filter((result) => result.replayEvidence.replayed === true);

    expect(fresh).toHaveLength(1);
    expect(replayed).toHaveLength(9);
    expect(countJsonlLines(auditPath)).toBe(1);
    for (const result of results) {
      expect(result.decision).toBe("ALLOW");
      expect(result.executionAuthorization).toBeDefined();
    }
    // exact replays re-issue the same deterministic authorization
    const authorizationIds = new Set(results.map((result) => result.executionAuthorization?.authorizationId));
    expect(authorizationIds.size).toBe(1);
  });

  test("T15 junk top-level fields are dropped: validation, fingerprint, decision, authorization identical", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const key = "boundary-t15-junk-fields";

    const cleanBody = makeApiIntent({ idempotencyKey: key });
    const junkBody = {
      ...cleanBody,
      transactionHash: "junk-field-txhash-not-real",
      signature: "junk-field-signature-not-real",
      to: "junk-field-to-not-an-address",
      data: "junk-field-calldata",
      programmablePaymentContext: { operation: "transfer", spender: "junk-field-spender" }
    };

    // validation drops junk fields entirely
    const intentClean = validatePaymentIntent(cleanBody);
    const intentJunk = validatePaymentIntent(junkBody);
    expect(intentJunk).toEqual(intentClean);
    expect(Object.keys(intentJunk).sort()).toEqual([
      "agentId",
      "amount",
      "currency",
      "idempotencyKey",
      "intent",
      "paymentRail",
      "recipient",
      "scenario"
    ]);
    expect(fingerprintIntent(intentJunk)).toBe(fingerprintIntent(intentClean));

    const first = (await evaluatePaymentIntent(junkBody)) as unknown as EvaluationBody;
    const second = (await evaluatePaymentIntent(cleanBody)) as unknown as EvaluationBody;

    expect(first.decision).toBe("ALLOW");
    expect(second.decision).toBe("ALLOW");
    expect(first.executionAuthorization?.authorizationId).toBe(second.executionAuthorization?.authorizationId);
    expect(first.executionAuthorization?.recipient).toBe("trusted-x402-api.demo");

    // junk values never reach the audit file or the authorization
    const fileContent = readFileSync(auditPath, "utf8");
    expect(fileContent).not.toContain("junk-field-txhash-not-real");
    expect(fileContent).not.toContain("junk-field-signature-not-real");
    expect(fileContent).not.toContain("junk-field-to-not-an-address");
    expect(fileContent).not.toContain("junk-field-calldata");
    expect(fileContent).not.toContain("junk-field-spender");
    const [stored] = readAllAuditRecords(auditPath);
    expect(stored).not.toHaveProperty("transactionHash");
    expect(stored).not.toHaveProperty("signature");
    expect(stored).not.toHaveProperty("to");
    expect(stored).not.toHaveProperty("data");
    // request-supplied programmablePaymentContext is ignored; none was derived
    expect(stored).not.toHaveProperty("programmablePaymentContext");
    const authorization = first.executionAuthorization!;
    expect(JSON.stringify(authorization)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase/i);
  });

  test("ADD-1 authorization envelope carries no execution fields", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const body = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: "boundary-add1-no-execution" }))) as unknown as EvaluationBody;
    const authorization = body.executionAuthorization!;

    expect(authorization).not.toHaveProperty("transactionHash");
    expect(authorization).not.toHaveProperty("txHash");
    expect(authorization).not.toHaveProperty("signature");
    expect(authorization).not.toHaveProperty("broadcast");
    expect(authorization).not.toHaveProperty("rawTransaction");
    expect(authorization).not.toHaveProperty("signedTransaction");
    expect(JSON.stringify(authorization)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase|broadcast/i);
  });
});
