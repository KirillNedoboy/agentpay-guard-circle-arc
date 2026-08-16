import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildCircleRailPreview } from "@/domain/payment-intent/rail-preview";
import { buildArcTestnetSimulation } from "@/domain/payment-intent/arc-testnet-simulation";
import { buildProgrammablePaymentContext } from "@/domain/payment-intent/programmable-payment-context";
import { fingerprintIntent } from "@/domain/payment-intent/intent-fingerprint";
import type { AuditRecord } from "@/domain/audit/types";
import type { PaymentIntent, PolicyDecision } from "@/domain/payment-intent/types";

const auditLog = vi.hoisted(() => ({
  createOrReuseAuditRecordWithEvidence: vi.fn(),
  readRecentAuditRecords: vi.fn(() => [])
}));

vi.mock("@/domain/audit/audit-log", () => auditLog);

import { safeEvaluatePaymentIntent } from "@/domain/payment-intent/evaluate";

function makeAuditRecord(intent: PaymentIntent, decision: PolicyDecision): AuditRecord {
  const railPreview = buildCircleRailPreview(intent);
  const programmablePaymentContext = buildProgrammablePaymentContext(intent);

  return {
    eventType: "agent_payment_guard_evaluated",
    auditId: "audit_api_evidence_000001",
    timestamp: "2026-07-16T12:00:00.000Z",
    intentId: intent.idempotencyKey,
    idempotencyKey: intent.idempotencyKey,
    agentId: intent.agentId,
    intent: intent.intent,
    amount: intent.amount,
    amountUSDC: intent.amount,
    currency: intent.currency,
    recipient: intent.recipient,
    recipientId: intent.recipient,
    recipientLabel: intent.recipient,
    scenario: intent.scenario,
    paymentRail: intent.paymentRail,
    rail: railPreview.rail,
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
    ...(programmablePaymentContext ? { programmablePaymentContext } : {}),
    ...(decision.spendControls ? { spendControls: decision.spendControls } : {}),
    arcTestnetSimulation: buildArcTestnetSimulation(intent),
    executionMode: railPreview.executionMode,
    railPreview
  };
}

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent_api_evidence_001",
    intent: "Propose a trusted USDC API payment",
    amount: "0.08",
    currency: "USDC",
    recipient: "trusted-x402-api.demo",
    scenario: "api_access",
    paymentRail: "mock_x402_service",
    idempotencyKey: "api-evidence-default",
    ...overrides
  };
}

const tempDirs: string[] = [];
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

beforeEach(() => {
  auditLog.createOrReuseAuditRecordWithEvidence.mockReset();
  auditLog.readRecentAuditRecords.mockReset();
  auditLog.readRecentAuditRecords.mockReturnValue([]);
  auditLog.createOrReuseAuditRecordWithEvidence.mockImplementation(async (_auditPath: string, intent: PaymentIntent, decision: PolicyDecision) => ({
    record: makeAuditRecord(intent, decision),
    replayed: false
  }));
  const dir = mkdtempSync(join(tmpdir(), "agentpay-api-obs-"));
  tempDirs.push(dir);
  process.env.AGENTPAY_OBSERVATION_LOG_PATH = join(dir, "evaluation-observations.jsonl");
});

afterEach(() => {
  if (previousObservationPath === undefined) {
    delete process.env.AGENTPAY_OBSERVATION_LOG_PATH;
  } else {
    process.env.AGENTPAY_OBSERVATION_LOG_PATH = previousObservationPath;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("safe payment intent evaluation", () => {
  test.each([
    [
      "CCTP",
      makeIntent({
        idempotencyKey: "api-cctp-evidence",
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          estimatedFee: "0.02",
          feeAsset: "USDC"
        }
      }),
      "cctpRoutePreview"
    ],
    [
      "ERC-20 authority",
      makeIntent({
        idempotencyKey: "api-erc20-evidence",
        operation: "approve",
        spender: "trusted-agent-service",
        amountBaseUnits: "80000"
      }),
      "erc20AuthorityPreview"
    ],
    [
      "Paymaster preview",
      makeIntent({
        idempotencyKey: "api-paymaster-evidence",
        routeContext: {
          transferMode: "single-chain",
          sourceChain: "ethereum",
          destinationChain: "ethereum",
          estimatedFee: "0.02",
          feeAsset: "USDC",
          gasPaymentMode: "usdc-paymaster-preview"
        }
      }),
      "usdcPaymasterPreview"
    ]
  ])("returns stable evidence for a valid %s request", async (_label, input, previewField) => {
    const response = await safeEvaluatePaymentIntent(input);
    const body = (await response.json()) as {
      decision: string;
      reasonCodes: string[];
      auditId: string | null;
      railPreview: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.decision).toBe("ALLOW");
    expect(body.reasonCodes).toContain("RAIL_PREVIEW_ONLY");
    expect(body.auditId).toBe("audit_api_evidence_000001");
    expect(body.railPreview).toHaveProperty(previewField);
    expect(auditLog.createOrReuseAuditRecordWithEvidence).toHaveBeenCalledTimes(1);
  });

  test("returns the persisted x402 spend-control envelope on a successful evaluation", async () => {
    const response = await safeEvaluatePaymentIntent(makeIntent({ idempotencyKey: "api-x402-envelope" }));
    const body = (await response.json()) as {
      decision: string;
      spendControls?: {
        requestedAmount: string;
        dailyAllowedSpend: string;
        projectedDailySpend: string;
        velocityAttemptCount: number;
      };
      arcTestnetSimulation?: { broadcast: boolean; status: string };
    };

    expect(response.status).toBe(200);
    expect(body.decision).toBe("ALLOW");
    expect(body.spendControls).toMatchObject({
      requestedAmount: "0.08",
      dailyAllowedSpend: "0",
      projectedDailySpend: "0.08",
      velocityAttemptCount: 0
    });
    expect(body.arcTestnetSimulation).toMatchObject({
      broadcast: false,
      status: "not_executed"
    });
  });

  test("exposes persisted policy version, fingerprint, and execution status on success", async () => {
    const response = await safeEvaluatePaymentIntent(makeIntent({ idempotencyKey: "api-phase1-evidence" }));
    const body = (await response.json()) as {
      policyId: string;
      policyVersion: string | null;
      policyFingerprint: string | null;
      executionStatus: string;
      replayEvidence: { replayed: boolean; replayMismatch: boolean | null; policyChanged: boolean | null };
      pilotObservability: { observationRecorded: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.policyId).toBe("default-agentpay-policy-v1");
    expect(body.policyVersion).toBe("3");
    expect(body.policyFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body.executionStatus).toBe("not_executed");
    expect(body.replayEvidence).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });
    expect(body.pilotObservability).toEqual({ observationRecorded: true });
  });

  test("ALLOW returns a deterministic execution authorization without changing decision fields", async () => {
    const response = await safeEvaluatePaymentIntent(makeIntent({ idempotencyKey: "api-auth-allow" }));
    const body = (await response.json()) as {
      decision: string;
      reasonCodes: string[];
      executionAuthorization?: {
        authorizationType: string;
        authorizationId: string;
        decision: string;
        scope: string;
        maxAmountUSDC: string;
        recipient: string;
        policyVersion: string;
        executionScope: string[];
        executionStatus: string;
        fundsMoved: boolean;
        issuedAt: string;
        expiresAt: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.decision).toBe("ALLOW");
    expect(body.reasonCodes).toContain("RAIL_PREVIEW_ONLY");
    expect(body.executionAuthorization).toMatchObject({
      authorizationType: "execution_authorization",
      decision: "ALLOW",
      scope: "single_intent",
      maxAmountUSDC: "0.08",
      recipient: "trusted-x402-api.demo",
      executionScope: ["prepare", "simulate"],
      executionStatus: "not_executed",
      fundsMoved: false
    });
    expect(body.executionAuthorization?.authorizationId).toMatch(/^auth_[0-9a-f]{64}$/);
    expect(body.executionAuthorization?.policyVersion).toBe("3");
    expect(body.executionAuthorization?.issuedAt).toBe("2026-07-16T12:00:00.000Z");
    expect(body.executionAuthorization?.expiresAt).toBe("2026-07-16T12:05:00.000Z");
  });

  test("REVIEW returns no execution authorization", async () => {
    const response = await safeEvaluatePaymentIntent(
      makeIntent({ idempotencyKey: "api-auth-review", recipient: "new-api.demo" })
    );
    const body = (await response.json()) as { decision: string; executionAuthorization?: unknown };

    expect(response.status).toBe(200);
    expect(body.decision).toBe("REVIEW");
    expect(body).not.toHaveProperty("executionAuthorization");
  });

  test("BLOCK returns no execution authorization", async () => {
    const response = await safeEvaluatePaymentIntent(
      makeIntent({ idempotencyKey: "api-auth-block", recipient: "blocked-recipient.demo" })
    );
    const body = (await response.json()) as { decision: string; executionAuthorization?: unknown };

    expect(response.status).toBe(200);
    expect(body.decision).toBe("BLOCK");
    expect(body).not.toHaveProperty("executionAuthorization");
  });

  test("exact idempotent replay keeps the deterministic authorization", async () => {
    const intent = makeIntent({ idempotencyKey: "api-auth-replay" });
    auditLog.createOrReuseAuditRecordWithEvidence.mockImplementationOnce(async (_path: string, i: PaymentIntent, d: PolicyDecision) => ({
      record: makeAuditRecord(i, d),
      replayed: true
    }));

    const response = await safeEvaluatePaymentIntent(intent);
    const body = (await response.json()) as {
      replayEvidence: { replayed: boolean; replayMismatch: boolean | null; policyChanged: boolean | null };
      executionAuthorization?: { authorizationId: string };
    };

    expect(response.status).toBe(200);
    expect(body.replayEvidence).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: false });
    expect(body.executionAuthorization?.authorizationId).toMatch(/^auth_[0-9a-f]{64}$/);
  });

  test("a replayed key with a different intent never issues an authorization", async () => {
    const intent = makeIntent({ idempotencyKey: "api-auth-mismatch" });
    auditLog.createOrReuseAuditRecordWithEvidence.mockImplementationOnce(async (_path: string, i: PaymentIntent, d: PolicyDecision) => ({
      record: makeAuditRecord({ ...i, intent: "Different intent text under the same key" } as unknown as PaymentIntent, d),
      replayed: true
    }));

    const response = await safeEvaluatePaymentIntent(intent);
    const body = (await response.json()) as {
      replayEvidence: { replayed: boolean; replayMismatch: boolean | null };
      executionAuthorization?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.replayEvidence).toMatchObject({ replayed: true, replayMismatch: true });
    expect(body).not.toHaveProperty("executionAuthorization");
  });

  test("invalid nested route context never returns ALLOW or creates audit evidence", async () => {
    const response = await safeEvaluatePaymentIntent(
      makeIntent({
        routeContext: {
          transferMode: "cctp",
          sourceChain: "ethereum",
          destinationChain: "base",
          providerId: "forbidden"
        }
      })
    );
    const body = (await response.json()) as { decision: string; auditId: string | null; reason: string };

    expect(response.status).toBe(400);
    expect(body.decision).toBe("BLOCK");
    expect(body.auditId).toBeNull();
    expect(body).not.toHaveProperty("executionAuthorization");
    expect(body).not.toHaveProperty("pilotObservability");
    expect(body.reason).not.toMatch(/stack|config|C:\\|node_modules/i);
    expect(auditLog.createOrReuseAuditRecordWithEvidence).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).toContain('"policyVersion":null');
    expect(JSON.stringify(body)).toContain('"policyFingerprint":null');
    expect(JSON.stringify(body)).toContain('"executionStatus":"not_executed"');
  });

  test("storage failure remains fail-closed without partial audit evidence or internal details", async () => {
    auditLog.createOrReuseAuditRecordWithEvidence.mockRejectedValueOnce(new Error("C:\\secret\\policy-config.json"));

    const response = await safeEvaluatePaymentIntent(makeIntent({ idempotencyKey: "api-storage-failure" }));
    const body = (await response.json()) as { decision: string; auditId: string | null; reason: string };

    expect(response.status).toBe(500);
    expect(body.decision).toBe("REVIEW");
    expect(body.decision).not.toBe("ALLOW");
    expect(body.auditId).toBeNull();
    expect(body).not.toHaveProperty("executionAuthorization");
    expect(body).not.toHaveProperty("pilotObservability");
    expect(body.reason).toBe("Internal evaluation failure. Payment must not proceed.");
    expect(JSON.stringify(body)).not.toMatch(/secret|policy-config|stack|C:\\/i);
    expect(JSON.stringify(body)).toContain('"policyVersion":null');
    expect(JSON.stringify(body)).toContain('"policyFingerprint":null');
    expect(JSON.stringify(body)).toContain('"executionStatus":"not_executed"');
    expect(auditLog.createOrReuseAuditRecordWithEvidence).toHaveBeenCalledTimes(1);
  });
});
