import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildCircleRailPreview, mapScenarioToPaymentPurpose } from "@/domain/payment-intent/rail-preview";
import { buildArcTestnetSimulation } from "@/domain/payment-intent/arc-testnet-simulation";
import { buildProgrammablePaymentContext } from "@/domain/payment-intent/programmable-payment-context";
import type { PaymentIntent, PolicyDecision } from "@/domain/payment-intent/types";
import type { AuditRecord } from "./types";

const locks = new Map<string, Promise<unknown>>();

async function withAuditLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  const current = previous.then(task, task);
  locks.set(path, current);

  try {
    return await current;
  } finally {
    if (locks.get(path) === current) {
      locks.delete(path);
    }
  }
}

async function readAuditFile(path: string): Promise<AuditRecord[]> {
  try {
    const content = await readFile(path, "utf8");
    return parseAuditLines(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function parseAuditLines(content: string): AuditRecord[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => normalizeAuditRecord(JSON.parse(line) as AuditRecord));
}

function makeAuditId(existingCount: number, timestamp: string): string {
  const date = timestamp.slice(0, 10).replaceAll("-", "");
  return `audit_${date}_${String(existingCount + 1).padStart(6, "0")}`;
}

function normalizeAuditRecord(record: AuditRecord): AuditRecord {
  const railPreview =
    record.railPreview ??
    buildCircleRailPreview({
      agentId: record.agentId,
      intent: record.intent,
      amount: record.amount,
      currency: record.currency,
      recipient: record.recipient,
      scenario: record.scenario,
      paymentRail: record.paymentRail,
      idempotencyKey: record.idempotencyKey
    });

  return {
    ...record,
    eventType: record.eventType ?? "agent_payment_guard_evaluated",
    intentId: record.intentId ?? record.idempotencyKey,
    amountUSDC: record.amountUSDC ?? record.amount,
    recipientId: record.recipientId ?? record.recipient,
    recipientLabel: record.recipientLabel ?? record.recipient,
    purpose: record.purpose ?? mapScenarioToPaymentPurpose(record.scenario),
    rail: record.rail ?? railPreview.rail,
    reasonCodes: record.reasonCodes ?? [],
    executionMode: record.executionMode ?? railPreview.executionMode,
    railPreview
  };
}

export async function createOrReuseAuditRecord(
  auditPath: string,
  intent: PaymentIntent,
  decision: PolicyDecision
): Promise<AuditRecord> {
  return withAuditLock(auditPath, async () => {
    await mkdir(dirname(auditPath), { recursive: true });
    const records = await readAuditFile(auditPath);
    const existing = records.find((record) => record.idempotencyKey === intent.idempotencyKey);

    if (existing) {
      return existing;
    }

    const timestamp = new Date().toISOString();
    const railPreview = buildCircleRailPreview(intent);
    const programmablePaymentContext = buildProgrammablePaymentContext(intent);
    const arcTestnetSimulation = buildArcTestnetSimulation(intent);
    const record: AuditRecord = {
      eventType: "agent_payment_guard_evaluated",
      auditId: makeAuditId(records.length, timestamp),
      timestamp,
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
      purpose: mapScenarioToPaymentPurpose(intent.scenario),
      paymentRail: intent.paymentRail,
      rail: railPreview.rail,
      decision: decision.decision,
      riskScore: decision.riskScore,
      policyId: decision.policyId,
      matchedRules: decision.matchedRules,
      reasonCodes: decision.reasonCodes,
      reason: decision.reason,
      ...(programmablePaymentContext ? { programmablePaymentContext } : {}),
      ...(decision.spendControls ? { spendControls: decision.spendControls } : {}),
      arcTestnetSimulation,
      executionMode: railPreview.executionMode,
      railPreview
    };

    await appendFile(auditPath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  });
}

export function readRecentAuditRecords(auditPath: string, limit: number): AuditRecord[] {
  try {
    const content = readFileSync(auditPath, "utf8");
    return parseAuditLines(content).slice(-limit).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
