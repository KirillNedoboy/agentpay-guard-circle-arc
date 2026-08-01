import type { AuditRecord } from "@/domain/audit/types";
import type { SpendControls } from "@/domain/policy/spend-controls";
import { buildCircleRailPreview, mapScenarioToPaymentPurpose } from "./rail-preview";
import type { ArcTestnetSimulation, CircleRailPreview, Decision, PaymentPurpose, ProgrammablePaymentContext } from "./types";

const receiptSafetyNote =
  "policy/evidence artifact only; not a payment receipt. No funds moved; no allowance or balance read; no CCTP burn or mint; no Iris attestation requested; no UserOperation or permit created. preview/mock only; no live Circle, Arc, or x402 payment executed.";

export type AgentPayReceipt = {
  receiptType: "agentpay_receipt";
  version: "v1";
  agentIdentity: string | null;
  requestIdentity: string | null;
  intentId: string;
  recipientLabel: string;
  amountUSDC: string;
  purpose: PaymentPurpose;
  decision: Decision;
  reasonCodes: string[];
  programmablePaymentContext?: ProgrammablePaymentContext;
  spendControls?: SpendControls;
  arcTestnetSimulation?: ArcTestnetSimulation;
  railPreview: CircleRailPreview;
  executionMode: CircleRailPreview["executionMode"];
  fundsMoved: false;
  auditId: string;
  timestamp: string;
  safetyNote: string;
};

export function buildAgentPayReceipt(record: AuditRecord): AgentPayReceipt {
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
    receiptType: "agentpay_receipt",
    version: "v1",
    agentIdentity: record.agentId || null,
    requestIdentity: record.idempotencyKey || null,
    intentId: record.intentId ?? record.idempotencyKey,
    recipientLabel: record.recipientLabel ?? record.recipient,
    amountUSDC: record.amountUSDC ?? record.amount,
    purpose: record.purpose ?? mapScenarioToPaymentPurpose(record.scenario),
    decision: record.decision,
    reasonCodes: record.reasonCodes ?? [],
    ...(record.programmablePaymentContext ? { programmablePaymentContext: record.programmablePaymentContext } : {}),
    ...(record.spendControls ? { spendControls: record.spendControls } : {}),
    ...(record.arcTestnetSimulation ? { arcTestnetSimulation: record.arcTestnetSimulation } : {}),
    railPreview,
    executionMode: record.executionMode ?? railPreview.executionMode,
    fundsMoved: false,
    auditId: record.auditId,
    timestamp: record.timestamp,
    safetyNote: receiptSafetyNote
  };
}
