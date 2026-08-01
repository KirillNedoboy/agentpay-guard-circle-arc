import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createOrReuseAuditRecord, readRecentAuditRecords } from "@/domain/audit/audit-log";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import { buildSpendControls } from "@/domain/policy/spend-controls";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";

const tempDirs: string[] = [];
const policy = loadPolicyConfig(join(process.cwd(), "data", "policies.default.json"));

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-audit-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("audit log", () => {
  test("reuses an existing audit record for the same idempotency key", async () => {
    const auditPath = makeTempAuditPath();
    const intent = validatePaymentIntent({
      agentId: "agent_market_data_001",
      intent: "Pay $0.005 USDC for market data API access",
      amount: "0.005",
      currency: "USDC",
      recipient: "market-data-api.demo",
      scenario: "api_access",
      paymentRail: "x402_gateway_nanopayment",
      idempotencyKey: "same-key"
    });
    const decision = evaluatePolicy(intent, policy, []);
    const spendControls = buildSpendControls({ intent, policy, recentAuditRecords: [] });

    const first = await createOrReuseAuditRecord(auditPath, intent, decision, spendControls);
    const second = await createOrReuseAuditRecord(auditPath, intent, decision, spendControls);
    const lines = readFileSync(auditPath, "utf8").trim().split("\n");

    expect(second.auditId).toBe(first.auditId);
    expect(second.spendControls).toEqual(spendControls);
    expect(lines).toHaveLength(1);
  });

  test("writes valid JSONL audit records with required fields", async () => {
    const auditPath = makeTempAuditPath();
    const intent = validatePaymentIntent({
      agentId: "device_telemetry_042",
      intent: "Device wants to pay $0.001 USDC for telemetry attestation",
      amount: "0.001",
      currency: "USDC",
      recipient: "telemetry-attestation.demo",
      scenario: "machine_to_machine",
      paymentRail: "x402_gateway_nanopayment",
      idempotencyKey: "jsonl-required-fields"
    });
    const decision = evaluatePolicy(intent, policy, []);
    const spendControls = buildSpendControls({ intent, policy, recentAuditRecords: [] });

    await createOrReuseAuditRecord(auditPath, intent, decision, spendControls);

    const records = readRecentAuditRecords(auditPath, 10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventType: "agent_payment_guard_evaluated",
      intentId: "jsonl-required-fields",
      idempotencyKey: "jsonl-required-fields",
      agentId: "device_telemetry_042",
      amount: "0.001",
      amountUSDC: "0.001",
      currency: "USDC",
      recipientId: "telemetry-attestation.demo",
      recipientLabel: "telemetry-attestation.demo",
      decision: "REVIEW",
      policyId: "default-agentpay-policy-v1",
      purpose: "verification_or_attestation",
      rail: "mock_x402_service",
      executionMode: "mock_preview",
      railPreview: {
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "telemetry-attestation.demo",
        amountUSDC: "0.001"
      },
      spendControls
    });
    expect(records[0].reasonCodes).toContain("RAIL_PREVIEW_ONLY");
    expect(JSON.stringify(records[0])).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase/i);
    expect(records[0].auditId).toMatch(/^audit_/);
    expect(Date.parse(records[0].timestamp)).not.toBeNaN();
  });

  test("maps legacy audit records to structured preview fields without appending", () => {
    const auditPath = makeTempAuditPath();
    writeFileSync(
      auditPath,
      `${JSON.stringify({
        auditId: "audit_20260527_000001",
        timestamp: "2026-05-27T20:25:26.560Z",
        idempotencyKey: "legacy-same-key",
        agentId: "agent_market_data_001",
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
      })}\n`,
      "utf8"
    );

    const records = readRecentAuditRecords(auditPath, 10);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventType: "agent_payment_guard_evaluated",
      intentId: "legacy-same-key",
      amountUSDC: "0.005",
      recipientLabel: "market-data-api.demo",
      purpose: "api_data_purchase",
      rail: "mock_x402_service",
      reasonCodes: [],
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_x402_service",
        amountUSDC: "0.005",
        recipientId: "market-data-api.demo"
      }
    });
    expect(readFileSync(auditPath, "utf8").trim().split("\n")).toHaveLength(1);
  });
});
