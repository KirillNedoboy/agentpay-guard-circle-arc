import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createOrReuseAuditRecord } from "@/domain/audit/audit-log";
import { createX402JudgePreset } from "@/domain/payment-intent/judge-preset";
import { buildAgentPayReceipt } from "@/domain/payment-intent/receipt";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import { calculateSpendControls } from "@/domain/policy/spend-controls";

const policy = loadPolicyConfig(join(process.cwd(), "data", "policies.default.json"));
const tempDirs: string[] = [];

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-judge-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("x402 judge preset", () => {
  test("allows the trusted API micropayment, persists its envelope, and replays idempotently", async () => {
    const auditPath = makeTempAuditPath();
    const intent = createX402JudgePreset();
    const spendControls = calculateSpendControls(intent, policy, [], new Date("2026-08-02T12:00:00.000Z"));
    const decision = evaluatePolicy(intent, policy, [], spendControls);

    expect(intent).toMatchObject({
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "mock_x402_service"
    });
    expect(decision.decision).toBe("ALLOW");

    const first = await createOrReuseAuditRecord(auditPath, intent, decision);
    const replay = await createOrReuseAuditRecord(auditPath, intent, decision);
    const receipt = buildAgentPayReceipt(first);

    expect(replay.auditId).toBe(first.auditId);
    expect(readFileSync(auditPath, "utf8").trim().split("\n")).toHaveLength(1);
    expect(first.spendControls).toEqual(spendControls);
    expect(first.arcTestnetSimulation).toMatchObject({
      network: "Arc Testnet",
      broadcast: false,
      status: "not_executed"
    });
    expect(receipt).toMatchObject({
      fundsMoved: false,
      spendControls,
      arcTestnetSimulation: {
        broadcast: false,
        status: "not_executed"
      }
    });
    expect(JSON.stringify({ first, receipt })).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase/i);
  });
});
