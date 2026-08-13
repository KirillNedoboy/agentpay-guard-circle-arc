import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { buildExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import { buildReplayEvidence } from "@/domain/audit/replay-evidence";
import { evaluatePaymentIntent } from "@/domain/payment-intent/evaluate";
import { fingerprintIntent } from "@/domain/payment-intent/intent-fingerprint";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";
import type { AuditRecord } from "@/domain/audit/types";
import type { PolicyConfig } from "@/domain/policy/policy-config";

const policy = loadPolicyConfig(join(process.cwd(), "data", "policies.default.json"));
const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-auth-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

afterEach(() => {
  if (previousAuditPath === undefined) {
    delete process.env.AGENTPAY_AUDIT_LOG_PATH;
  } else {
    process.env.AGENTPAY_AUDIT_LOG_PATH = previousAuditPath;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeAuditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_20260707_000001",
    timestamp: "2026-07-07T10:15:30.000Z",
    intentId: "intent_demo_001",
    idempotencyKey: "demo-auth-001",
    agentId: "agent_auth_demo_001",
    intent: "Buy trusted verification data for an agent report",
    amount: "0.08",
    amountUSDC: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    recipientId: "trusted-x402-api.demo",
    recipientLabel: "trusted-x402-api.demo",
    scenario: "api_access",
    purpose: "api_data_purchase",
    paymentRail: "mock_x402_service",
    rail: "mock_x402_service",
    decision: "ALLOW",
    riskScore: 10,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyFingerprint: fingerprintPolicy(policy),
    intentFingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    executionStatus: "not_executed",
    matchedRules: ["recipient_allowlisted", "scenario_allowed", "amount_below_per_payment_limit"],
    reasonCodes: ["RECIPIENT_TRUSTED", "PURPOSE_ALLOWED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"],
    reason: "Recipient is allowlisted, amount is below limits, and scenario is allowed.",
    executionMode: "mock_preview",
    railPreview: {
      rail: "mock_x402_service",
      networkLabel: "x402-compatible paid API",
      settlementAsset: "USDC",
      executionMode: "mock_preview",
      recipientId: "trusted-x402-api.demo",
      amountUSDC: "0.08",
      explanation: "Preview only."
    },
    ...overrides
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function makeApiIntent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent_auth_api_001",
    intent: "Buy premium verification data from a trusted x402 API for an agent research task",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "phase3-auth-key-001",
    ...overrides
  };
}

describe("ExecutionAuthorization envelope", () => {
  test("ALLOW creates an authorization with the full typed shape", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization).not.toBeNull();
    expect(authorization).toMatchObject({
      authorizationType: "execution_authorization",
      version: "v1",
      scope: "single_intent",
      decision: "ALLOW",
      asset: "USDC",
      executionScope: ["prepare", "simulate"],
      executionStatus: "not_executed",
      fundsMoved: false,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion
    });
    expect(authorization?.authorizationId).toMatch(/^auth_[0-9a-f]{64}$/);
  });

  test("binds the exact proposed amount, not the policy cap", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.maxAmountUSDC).toBe("0.08");
    expect(authorization?.maxAmountUSDC).not.toBe(policy.limits.maxAmountPerPayment);
  });

  test("REVIEW produces no authorization", () => {
    expect(buildExecutionAuthorization(makeAuditRecord({ decision: "REVIEW" }), policy)).toBeNull();
  });

  test("BLOCK produces no authorization", () => {
    expect(buildExecutionAuthorization(makeAuditRecord({ decision: "BLOCK" }), policy)).toBeNull();
  });

  test("authorizationId is deterministic for the same audit and policy", () => {
    const first = buildExecutionAuthorization(makeAuditRecord(), policy);
    const second = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(first?.authorizationId).toBe(second?.authorizationId);

    const differentAudit = buildExecutionAuthorization(makeAuditRecord({ auditId: "audit_20260707_000002" }), policy);
    const differentAmount = buildExecutionAuthorization(makeAuditRecord({ amount: "0.09", amountUSDC: "0.09" }), policy);
    expect(first?.authorizationId).not.toBe(differentAudit?.authorizationId);
    expect(first?.authorizationId).not.toBe(differentAmount?.authorizationId);
  });

  test("timestamps are deterministic from persisted evidence and the policy TTL", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.issuedAt).toBe("2026-07-07T10:15:30.000Z");
    expect(authorization?.expiresAt).toBe("2026-07-07T10:20:30.000Z");

    const later = buildExecutionAuthorization(makeAuditRecord({ timestamp: "2026-07-07T11:00:00.000Z" }), policy);
    expect(later?.issuedAt).toBe("2026-07-07T11:00:00.000Z");
    expect(later?.expiresAt).toBe("2026-07-07T11:05:00.000Z");
  });

  test("policy attribution matches the persisted evidence exactly", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.policyVersion).toBe(policy.policyVersion);
    expect(authorization?.policyFingerprint).toBe(fingerprintPolicy(policy));
    expect(authorization?.policyId).toBe(policy.policyId);
  });

  test("legacy ALLOW without policy attribution or intent fingerprint produces no authorization", () => {
    expect(buildExecutionAuthorization(makeAuditRecord({ policyVersion: null }), policy)).toBeNull();
    expect(buildExecutionAuthorization(makeAuditRecord({ policyFingerprint: null }), policy)).toBeNull();
    expect(buildExecutionAuthorization(makeAuditRecord({ intentFingerprint: null }), policy)).toBeNull();
  });

  test("refuses to mix a stored old policy attribution with a changed current policy", () => {
    const record = makeAuditRecord();

    const changedVersion: PolicyConfig = { ...policy, policyVersion: "3" };
    expect(buildExecutionAuthorization(record, changedVersion)).toBeNull();

    const changedLimits: PolicyConfig = { ...policy, limits: { ...policy.limits, maxAmountPerPayment: "10.01" } };
    expect(buildExecutionAuthorization(record, changedLimits)).toBeNull();
  });

  test("carries programmable payment context when persisted", () => {
    const authorization = buildExecutionAuthorization(
      makeAuditRecord({
        programmablePaymentContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          finalityMode: "standard",
          attestationStatus: "not_requested",
          estimatedFee: "0.02",
          feeAsset: "USDC",
          gasPaymentMode: "native-gas",
          totalProposedSpendUSDC: "0.1"
        }
      }),
      policy
    );

    expect(authorization?.programmablePaymentContext).toEqual({
      transferMode: "cctp",
      sourceChain: "ethereum",
      destinationChain: "base",
      finalityMode: "standard",
      attestationStatus: "not_requested",
      estimatedFee: "0.02",
      feeAsset: "USDC",
      gasPaymentMode: "native-gas",
      totalProposedSpendUSDC: "0.1"
    });
  });

  test("does not carry programmable payment context when absent", () => {
    expect(buildExecutionAuthorization(makeAuditRecord(), policy)).not.toHaveProperty("programmablePaymentContext");
  });

  test("does not mutate the audit record or policy config", () => {
    const audit = deepFreeze(makeAuditRecord());
    const frozenPolicy = deepFreeze(policy);
    const beforeAudit = JSON.stringify(audit);
    const beforePolicy = JSON.stringify(policy);

    const authorization = buildExecutionAuthorization(audit, frozenPolicy);

    expect(JSON.stringify(audit)).toBe(beforeAudit);
    expect(JSON.stringify(frozenPolicy)).toBe(beforePolicy);
    expect(authorization).not.toBeNull();
  });

  test("security invariants: exact binding and no execution capability", () => {
    const authorization = buildExecutionAuthorization(makeAuditRecord(), policy);

    expect(authorization?.recipient).toBe("trusted-x402-api.demo");
    expect(authorization?.agentId).toBe("agent_auth_demo_001");
    expect(authorization?.maxAmountUSDC).toBe("0.08");
    expect(authorization?.idempotencyKey).toBe("demo-auth-001");
    expect(authorization?.auditId).toBe("audit_20260707_000001");
    expect(authorization?.executionScope).toEqual(["prepare", "simulate"]);
    expect(authorization?.executionScope).not.toEqual(expect.arrayContaining(["execute", "submit", "broadcast", "sign", "settle", "verify"]));
    expect(authorization?.fundsMoved).toBe(false);
    expect(authorization?.executionStatus).toBe("not_executed");
    expect(JSON.stringify(authorization)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase|settlementStatus/i);
  });
});

describe("replay evidence", () => {
  test("first evaluation and exact replay report no mismatch and no policy change", () => {
    const record = makeAuditRecord({ intentFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const currentIntentFingerprint = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const first = buildReplayEvidence(record, currentIntentFingerprint, policy, false);
    const replay = buildReplayEvidence(record, currentIntentFingerprint, policy, true);

    expect(first).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });
    expect(replay).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: false });
    expect(replay.storedIntentFingerprint).toBe(currentIntentFingerprint);
    expect(replay.currentPolicyFingerprint).toBe(fingerprintPolicy(policy));
  });

  test("same key with a different incoming intent reports a mismatch", () => {
    const stored = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const current = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const evidence = buildReplayEvidence(makeAuditRecord({ intentFingerprint: stored }), current, policy, true);

    expect(evidence.replayed).toBe(true);
    expect(evidence.replayMismatch).toBe(true);
    expect(evidence.storedIntentFingerprint).toBe(stored);
    expect(evidence.currentIntentFingerprint).toBe(current);
  });

  test("policy drift is reported when the current policy differs", () => {
    const record = makeAuditRecord();

    const changedLimits: PolicyConfig = { ...policy, limits: { ...policy.limits, maxAmountPerPayment: "10.01" } };
    const changedVersion: PolicyConfig = { ...policy, policyVersion: "3" };

    expect(buildReplayEvidence(record, record.intentFingerprint ?? "", policy, true).policyChanged).toBe(false);
    expect(buildReplayEvidence(record, record.intentFingerprint ?? "", changedLimits, true).policyChanged).toBe(true);
    expect(buildReplayEvidence(record, record.intentFingerprint ?? "", changedVersion, true).policyChanged).toBe(true);
  });

  test("legacy records without stored attribution report null instead of a fabricated answer", () => {
    const noIntent = buildReplayEvidence(makeAuditRecord({ intentFingerprint: null }), "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", policy, true);
    const noPolicy = buildReplayEvidence(makeAuditRecord({ policyVersion: null, policyFingerprint: null }), "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", policy, true);

    expect(noIntent.replayMismatch).toBeNull();
    expect(noPolicy.policyChanged).toBeNull();
  });

  test("replay evidence does not mutate the stored record", () => {
    const record = deepFreeze(makeAuditRecord({ intentFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }));
    const before = JSON.stringify(record);

    buildReplayEvidence(record, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", policy, true);

    expect(JSON.stringify(record)).toBe(before);
  });
});

describe("evaluation flow authorization safety", () => {
  test("first ALLOW evaluation issues an authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const response = await evaluatePaymentIntent(makeApiIntent());
    const body = response as unknown as {
      decision: string;
      replayEvidence: { replayed: boolean; replayMismatch: boolean | null; policyChanged: boolean | null };
      executionAuthorization?: { authorizationId: string };
    };

    expect(body.decision).toBe("ALLOW");
    expect(body.replayEvidence).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });
    expect(body.executionAuthorization).toBeDefined();
  });

  test("exact replay with the same policy re-issues the same deterministic authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const intent = makeApiIntent();

    const first = (await evaluatePaymentIntent(intent)) as unknown as {
      executionAuthorization?: { authorizationId: string };
      replayEvidence: { replayed: boolean };
    };
    const second = (await evaluatePaymentIntent(intent)) as unknown as {
      executionAuthorization?: { authorizationId: string };
      replayEvidence: { replayed: boolean };
    };

    expect(first.executionAuthorization?.authorizationId).toBeDefined();
    expect(second.replayEvidence.replayed).toBe(true);
    expect(second.executionAuthorization?.authorizationId).toBe(first.executionAuthorization?.authorizationId);
  });

  test("same key with a different intent suppresses the authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const first = (await evaluatePaymentIntent(makeApiIntent())) as unknown as { decision: string; replayEvidence: { replayed: boolean } };
    const second = (await evaluatePaymentIntent(
      makeApiIntent({ intent: "A completely different intent reusing the same idempotency key" })
    )) as unknown as {
      decision: string;
      replayEvidence: { replayed: boolean; replayMismatch: boolean | null };
      executionAuthorization?: unknown;
    };

    expect(first.decision).toBe("ALLOW");
    expect(second.replayEvidence.replayed).toBe(true);
    expect(second.replayEvidence.replayMismatch).toBe(true);
    expect(second).not.toHaveProperty("executionAuthorization");
    expect(second.decision).toBe("ALLOW");
  });

  test("stored record under a changed policy suppresses the authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;

    const first = (await evaluatePaymentIntent(makeApiIntent())) as unknown as { executionAuthorization?: { authorizationId: string } };
    const oldFingerprint = fingerprintPolicy({ ...policy, limits: { ...policy.limits, maxAmountPerPayment: "10.01" } });
    const changedPolicyRecord = JSON.stringify({
      eventType: "agent_payment_guard_evaluated",
      auditId: "audit_changed_policy_000001",
      timestamp: "2026-08-13T17:00:00.000Z",
      intentId: "phase3-auth-key-002",
      idempotencyKey: "phase3-auth-key-002",
      agentId: "agent_auth_api_001",
      intent: "Buy premium verification data from a trusted x402 API for an agent research task",
      amount: "0.08",
      amountUSDC: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      recipientId: "trusted-x402-api.demo",
      recipientLabel: "trusted-x402-api.demo",
      scenario: "api_access",
      purpose: "api_data_purchase",
      paymentRail: "mock_x402_service",
      rail: "mock_x402_service",
      decision: "ALLOW",
      riskScore: 10,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      policyFingerprint: oldFingerprint,
      intentFingerprint: fingerprintIntent(
        makeApiIntent({ idempotencyKey: "phase3-auth-key-002" }) as Parameters<typeof fingerprintIntent>[0]
      ),
      executionStatus: "not_executed",
      matchedRules: ["recipient_allowlisted"],
      reasonCodes: ["RAIL_PREVIEW_ONLY"],
      reason: "Stored ALLOW under a now-changed policy.",
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_x402_service",
        networkLabel: "x402-compatible paid API",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "trusted-x402-api.demo",
        amountUSDC: "0.08",
        explanation: "Preview only."
      }
    });
    writeFileSync(auditPath, `${changedPolicyRecord}\n`, "utf8");

    const replay = (await evaluatePaymentIntent(makeApiIntent({ idempotencyKey: "phase3-auth-key-002" }))) as unknown as {
      replayEvidence: { replayed: boolean; policyChanged: boolean | null };
      executionAuthorization?: unknown;
    };

    expect(replay.replayEvidence.replayed).toBe(true);
    expect(replay.replayEvidence.policyChanged).toBe(true);
    expect(replay).not.toHaveProperty("executionAuthorization");
    expect(first.executionAuthorization?.authorizationId).toBeDefined();
  });
});
