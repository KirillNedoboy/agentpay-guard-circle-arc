import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { evaluatePaymentIntent } from "@/domain/payment-intent/evaluate";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";

const root = process.cwd();
const examplesPath = join(root, "examples");
const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-canonical-"));
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
    const second = (await evaluatePaymentIntent(intent)) as unknown as EvaluationBody & { auditId: string };

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
  });
});
