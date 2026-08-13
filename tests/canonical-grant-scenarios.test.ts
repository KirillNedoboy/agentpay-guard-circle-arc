import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { GET as getPilotMetrics } from "@/app/api/pilot-metrics/route";
import { readAllAuditRecords } from "@/domain/audit/audit-log";
import { readEvaluationObservations } from "@/domain/observability/evaluation-observation-log";
import { buildPilotMetrics } from "@/domain/observability/pilot-metrics";
import { evaluatePaymentIntent } from "@/domain/payment-intent/evaluate";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";

const root = process.cwd();
const examplesPath = join(root, "examples");
const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-canonical-"));
  tempDirs.push(dir);
  return dir;
}

function makeTempAuditPath() {
  return join(makeTempDir(), "audit-log.jsonl");
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

function loadScenarioIntent(fileName: string) {
  const parsed = JSON.parse(readFileSync(join(examplesPath, fileName), "utf8")) as Record<string, unknown>;
  const { expectedDecision, ...intent } = parsed;
  return {
    expectedDecision: expectedDecision as string,
    intent: validatePaymentIntent(intent)
  };
}

function countJsonlLines(auditPath: string): number {
  return readFileSync(auditPath, "utf8").trim().split("\n").filter((line) => line.length > 0).length;
}

type EvaluationBody = {
  decision: string;
  reasonCodes: string[];
  executionStatus: string;
  replayEvidence: {
    replayed: boolean;
    replayMismatch: boolean | null;
    policyChanged: boolean | null;
  };
  executionAuthorization?: {
    authorizationId: string;
    decision: string;
    scope: string;
    maxAmountUSDC: string;
    executionScope: string[];
    executionStatus: string;
    fundsMoved: boolean;
  };
  pilotObservability: { observationRecorded: boolean };
};

describe("canonical grant scenarios (end to end)", () => {
  test("ALLOW scenario issues a single-intent authorization with no execution", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-allow-api.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as EvaluationBody;

    expect(expectedDecision).toBe("ALLOW");
    expect(body.decision).toBe("ALLOW");
    expect(body.executionStatus).toBe("not_executed");
    expect(body.replayEvidence).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });
    expect(body.executionAuthorization).toMatchObject({
      decision: "ALLOW",
      scope: "single_intent",
      maxAmountUSDC: "0.08",
      executionScope: ["prepare", "simulate"],
      executionStatus: "not_executed",
      fundsMoved: false
    });
    expect(body.executionAuthorization?.authorizationId).toMatch(/^auth_[0-9a-f]{64}$/);
    expect(countJsonlLines(auditPath)).toBe(1);
    expect(body.pilotObservability).toEqual({ observationRecorded: true });
    expect(readEvaluationObservations(join(dirname(auditPath), "evaluation-observations.jsonl"))).toHaveLength(1);
  });

  test("REVIEW scenario returns review evidence and no authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-review-machine.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as EvaluationBody;

    expect(expectedDecision).toBe("REVIEW");
    expect(body.decision).toBe("REVIEW");
    expect(body.executionStatus).toBe("not_executed");
    expect(body.replayEvidence).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });
    expect(body.reasonCodes).toContain("RECIPIENT_REVIEW_REQUIRED");
    expect(body).not.toHaveProperty("executionAuthorization");
    expect(countJsonlLines(auditPath)).toBe(1);
    expect(body.pilotObservability).toEqual({ observationRecorded: true });
    const reviewObservations = readEvaluationObservations(join(dirname(auditPath), "evaluation-observations.jsonl"));
    expect(reviewObservations).toHaveLength(1);
    expect(reviewObservations[0].authorizationIssued).toBe(false);
  });

  test("BLOCK scenario returns block evidence and no authorization", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-block-risky.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as EvaluationBody;

    expect(expectedDecision).toBe("BLOCK");
    expect(body.decision).toBe("BLOCK");
    expect(body.executionStatus).toBe("not_executed");
    expect(body.replayEvidence).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });
    expect(body.reasonCodes).toContain("RECIPIENT_BLOCKED");
    expect(body).not.toHaveProperty("executionAuthorization");
    expect(countJsonlLines(auditPath)).toBe(1);
    expect(body.pilotObservability).toEqual({ observationRecorded: true });
    const blockObservations = readEvaluationObservations(join(dirname(auditPath), "evaluation-observations.jsonl"));
    expect(blockObservations).toHaveLength(1);
    expect(blockObservations[0].authorizationIssued).toBe(false);
  });

  test("REPLAY is a two-evaluation sequence preserving one audit line and the same authorization", async () => {
    const descriptor = JSON.parse(readFileSync(join(examplesPath, "scenario-replay.json"), "utf8")) as {
      scenarioType: string;
      replayOf: string;
      expectedDecision: string;
      expectedReplay: boolean;
      expectedReplayMismatch: boolean;
      expectedPolicyChanged: boolean;
      expectedAuthorization: boolean;
    };
    expect(descriptor.scenarioType).toBe("replay");

    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { intent } = loadScenarioIntent(descriptor.replayOf);

    const first = (await evaluatePaymentIntent(intent)) as unknown as EvaluationBody & { auditId: string };
    const second = (await evaluatePaymentIntent(intent)) as unknown as EvaluationBody & {
      auditId: string;
      pilotObservability: { observationRecorded: boolean };
    };

    expect(first.decision).toBe(descriptor.expectedDecision);
    expect(first.replayEvidence).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });

    expect(second.decision).toBe("ALLOW");
    expect(second.replayEvidence.replayed).toBe(true);
    expect(second.replayEvidence.replayMismatch).toBe(false);
    expect(second.replayEvidence.policyChanged).toBe(false);
    expect(second.auditId).toBe(first.auditId);
    expect(first.executionAuthorization).toBeDefined();
    expect(second.executionAuthorization).toBeDefined();
    expect(second.executionAuthorization?.authorizationId).toBe(first.executionAuthorization?.authorizationId);
    expect(second.executionAuthorization?.executionStatus).toBe("not_executed");
    expect(second.executionAuthorization?.fundsMoved).toBe(false);
    expect(countJsonlLines(auditPath)).toBe(1);
    expect(second.pilotObservability).toEqual({ observationRecorded: true });
    expect(readEvaluationObservations(join(dirname(auditPath), "evaluation-observations.jsonl"))).toHaveLength(2);
  });

  test("observability metrics combine one canonical intent with two evaluation attempts", async () => {
    const dir = makeTempDir();
    const auditPath = join(dir, "audit-log.jsonl");
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { intent } = loadScenarioIntent("scenario-allow-api.json");

    await evaluatePaymentIntent(intent);
    await evaluatePaymentIntent(intent);

    const metrics = buildPilotMetrics(
      readAllAuditRecords(auditPath),
      readEvaluationObservations(join(dir, "evaluation-observations.jsonl"))
    );

    expect(metrics.canonicalIntentCount).toBe(1);
    expect(metrics.decisionCounts).toEqual({ ALLOW: 1, REVIEW: 0, BLOCK: 0 });
    expect(metrics.observedEvaluationAttemptCount).toBe(2);
    expect(metrics.replayAttemptCount).toBe(1);
    expect(metrics.exactReplayAttemptCount).toBe(1);
    expect(metrics.replayMismatchAttemptCount).toBe(0);
    expect(metrics.policyDriftAttemptCount).toBe(0);
    expect(metrics.authorizationIssuedAttemptCount).toBe(2);
    expect(metrics.p95PolicyEvaluationDurationMs).not.toBeNull();
    expect(metrics.p95PolicyEvaluationDurationMs).toBeGreaterThanOrEqual(0);
    expect(countJsonlLines(auditPath)).toBe(1);
  });

  test("a failed observation append never changes the persisted decision or authorization", async () => {
    const dir = makeTempDir();
    const auditPath = join(dir, "audit-log.jsonl");
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "this is a regular file, not a directory", "utf8");
    process.env.AGENTPAY_OBSERVATION_LOG_PATH = join(blocker, "evaluation-observations.jsonl");
    const { intent } = loadScenarioIntent("scenario-allow-api.json");

    const body = (await evaluatePaymentIntent(intent)) as unknown as {
      decision: string;
      pilotObservability: { observationRecorded: boolean };
      executionAuthorization?: { authorizationId: string };
    };

    expect(body.decision).toBe("ALLOW");
    expect(body.executionAuthorization?.authorizationId).toMatch(/^auth_[0-9a-f]{64}$/);
    expect(body.pilotObservability).toEqual({ observationRecorded: false });
    expect(countJsonlLines(auditPath)).toBe(1);
    expect(readdirSync(dir).filter((name) => name.includes("evaluation-observations"))).toEqual([]);
  });

  test("GET /api/pilot-metrics returns the summary shape and mutates nothing", async () => {
    const dir = makeTempDir();
    process.env.AGENTPAY_AUDIT_LOG_PATH = join(dir, "audit-log.jsonl");
    process.env.AGENTPAY_OBSERVATION_LOG_PATH = join(dir, "evaluation-observations.jsonl");

    const response = await getPilotMetrics();
    const body = (await response.json()) as { metrics: Record<string, unknown> };

    expect(body.metrics).toMatchObject({
      schemaVersion: "v1",
      canonicalIntentCount: 0,
      observedEvaluationAttemptCount: 0,
      p95PolicyEvaluationDurationMs: null
    });
    expect(response.status).toBe(200);
    expect(readdirSync(dir)).toEqual([]);
  });
});
