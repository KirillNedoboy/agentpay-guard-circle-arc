import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readRecentAuditRecords } from "@/domain/audit/audit-log";
import { evaluatePaymentIntent } from "@/domain/payment-intent/evaluate";
import { x402JudgePreset } from "@/domain/payment-intent/judge-preset";

const originalAuditPath = process.env.AUDIT_LOG_PATH;
const tempDirectories: string[] = [];

afterEach(() => {
  if (originalAuditPath === undefined) {
    delete process.env.AUDIT_LOG_PATH;
  } else {
    process.env.AUDIT_LOG_PATH = originalAuditPath;
  }

  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evaluates the x402 judge preset into an idempotent policy-envelope receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentpay-judge-x402-"));
  tempDirectories.push(directory);
  const auditPath = join(directory, "audit-log.jsonl");
  process.env.AUDIT_LOG_PATH = auditPath;

  const first = await evaluatePaymentIntent(x402JudgePreset.intent);
  const replay = await evaluatePaymentIntent(x402JudgePreset.intent);
  const records = readRecentAuditRecords(auditPath, 10);

  expect(first.decision).toBe("ALLOW");
  expect(first.railPreview).toMatchObject({
    rail: "mock_x402_service",
    settlementAsset: "USDC",
    executionMode: "mock_preview",
    recipientId: "trusted-x402-api.demo",
    amountUSDC: "0.08"
  });
  expect(first.spendControls).toEqual({
    currency: "USDC",
    requestedAmount: "0.08",
    maxAmountPerPayment: "10.00",
    reviewThreshold: "0.20",
    dailyLimit: "25.00",
    dailyAllowedSpend: "0",
    dailyRemainingBeforeRequest: "25",
    projectedDailySpend: "0.08",
    velocityWindowSeconds: 60,
    velocityAttempts: 0,
    velocityMaxAttempts: 5
  });
  expect(replay.auditId).toBe(first.auditId);
  expect(replay.spendControls).toEqual(first.spendControls);
  expect(records).toHaveLength(1);
  expect(records[0].spendControls).toEqual(first.spendControls);
  expect(JSON.stringify(records[0])).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase/i);
});
