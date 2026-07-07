import type { AuditRecord } from "@/domain/audit/types";
import { buildCircleRailPreview, mapScenarioToPaymentPurpose } from "./rail-preview";
import type { CircleRailPreview, Decision, PaymentPurpose } from "./types";

const receiptSafetyNote = "preview/mock only; no live Circle, Arc, or x402 payment executed.";

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
    railPreview,
    executionMode: record.executionMode ?? railPreview.executionMode,
    fundsMoved: false,
    auditId: record.auditId,
    timestamp: record.timestamp,
    safetyNote: receiptSafetyNote
  };
}
