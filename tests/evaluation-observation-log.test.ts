import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { appendEvaluationObservation, readEvaluationObservations } from "@/domain/observability/evaluation-observation-log";
import type { EvaluationObservation } from "@/domain/observability/evaluation-observation";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-obs-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeObservation(overrides: Partial<EvaluationObservation> = {}): EvaluationObservation {
  return {
    eventType: "agentpay_evaluation_observed",
    timestamp: "2026-08-13T12:00:00.000Z",
    auditId: "audit_obs_000001",
    decision: "ALLOW",
    replayed: false,
    replayMismatch: false,
    policyChanged: false,
    authorizationIssued: true,
    policyEvaluationDurationMs: 1.234,
    ...overrides
  };
}

describe("evaluation observation log", () => {
  test("missing file reads as an empty array", () => {
    const dir = makeTempDir();
    expect(readEvaluationObservations(join(dir, "missing.jsonl"))).toEqual([]);
  });

  test("appends one line per observation and round-trips values", async () => {
    const dir = makeTempDir();
    const path = join(dir, "evaluation-observations.jsonl");
    const first = makeObservation();
    const second = makeObservation({ auditId: "audit_obs_000002", replayed: true, policyEvaluationDurationMs: 2.5 });

    await appendEvaluationObservation(path, first);
    await appendEvaluationObservation(path, second);

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(readEvaluationObservations(path)).toEqual([first, second]);
  });

  test("observation lines contain no raw intent, recipient, agent, or amount data", async () => {
    const dir = makeTempDir();
    const path = join(dir, "evaluation-observations.jsonl");

    await appendEvaluationObservation(
      path,
      makeObservation({
        auditId: "audit_secret_ref_001",
        decision: "BLOCK"
      })
    );

    const content = readFileSync(path, "utf8");
    expect(content).not.toMatch(/agent_obs_|secret-intent|secret-recipient|1\.2345 USDC|0\.08/i);
    expect(JSON.parse(content.trim())).toEqual(
      expect.objectContaining({
        eventType: "agentpay_evaluation_observed",
        auditId: "audit_secret_ref_001"
      })
    );
  });

  test("observations never touch the canonical audit file", async () => {
    const dir = makeTempDir();
    const auditPath = join(dir, "audit-log.jsonl");
    const observationPath = join(dir, "evaluation-observations.jsonl");
    writeFileSync(auditPath, '{"eventType":"agent_payment_guard_evaluated","auditId":"audit_canonical_000001"}\n', "utf8");
    const before = readFileSync(auditPath, "utf8");

    await appendEvaluationObservation(observationPath, makeObservation());

    expect(readFileSync(auditPath, "utf8")).toBe(before);
    expect(readFileSync(observationPath, "utf8")).not.toContain("agent_payment_guard_evaluated");
  });

  test("concurrent appends do not corrupt the JSONL file", async () => {
    const dir = makeTempDir();
    const path = join(dir, "evaluation-observations.jsonl");
    const observations = Array.from({ length: 20 }, (_, index) =>
      makeObservation({ auditId: `audit_concurrent_${index}`, policyEvaluationDurationMs: index })
    );

    await Promise.all(observations.map((observation) => appendEvaluationObservation(path, observation)));

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(20);
    const parsed = lines.map((line) => JSON.parse(line) as EvaluationObservation);
    expect(new Set(parsed.map((observation) => observation.auditId)).size).toBe(20);
  });
});
