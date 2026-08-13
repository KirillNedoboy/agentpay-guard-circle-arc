import { createHash } from "node:crypto";
import type { AuditRecord } from "@/domain/audit/types";
import type { CircleRail, ProgrammablePaymentContext } from "@/domain/payment-intent/types";
import type { PolicyConfig } from "@/domain/policy/policy-config";

export type ExecutionAuthorization = {
  authorizationType: "execution_authorization";
  version: "v1";
  authorizationId: string;
  scope: "single_intent";
  intentId: string;
  idempotencyKey: string;
  auditId: string;
  agentId: string;
  recipient: string;
  asset: "USDC";
  maxAmountUSDC: string;
  paymentRail: string;
  rail: CircleRail;
  programmablePaymentContext?: ProgrammablePaymentContext;
  decision: "ALLOW";
  policyId: string;
  policyVersion: string;
  policyFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  executionScope: ["prepare", "simulate"];
  executionStatus: "not_executed";
  fundsMoved: false;
};

function addSeconds(isoTimestamp: string, seconds: number): string {
  return new Date(Date.parse(isoTimestamp) + seconds * 1000).toISOString();
}

function buildAuthorizationId(parts: string[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
  return `auth_${digest}`;
}

export function buildExecutionAuthorization(
  audit: AuditRecord,
  policy: PolicyConfig
): ExecutionAuthorization | null {
  if (audit.decision !== "ALLOW") {
    return null;
  }
  if (audit.policyVersion === null || audit.policyFingerprint === null) {
    return null;
  }
  const rail = audit.rail ?? audit.railPreview?.rail;
  if (!rail) {
    return null;
  }

  const issuedAt = audit.timestamp;
  const expiresAt = addSeconds(issuedAt, policy.authorization.ttlSeconds);
  const maxAmountUSDC = audit.amountUSDC ?? audit.amount;
  const authorizationId = buildAuthorizationId([
    audit.intentId ?? audit.idempotencyKey,
    audit.idempotencyKey,
    audit.auditId,
    audit.agentId,
    audit.recipient,
    maxAmountUSDC,
    audit.paymentRail,
    audit.policyVersion,
    audit.policyFingerprint,
    issuedAt,
    expiresAt
  ]);

  return {
    authorizationType: "execution_authorization",
    version: "v1",
    authorizationId,
    scope: "single_intent",
    intentId: audit.intentId ?? audit.idempotencyKey,
    idempotencyKey: audit.idempotencyKey,
    auditId: audit.auditId,
    agentId: audit.agentId,
    recipient: audit.recipient,
    asset: "USDC",
    maxAmountUSDC,
    paymentRail: audit.paymentRail,
    rail,
    ...(audit.programmablePaymentContext ? { programmablePaymentContext: audit.programmablePaymentContext } : {}),
    decision: "ALLOW",
    policyId: audit.policyId,
    policyVersion: audit.policyVersion,
    policyFingerprint: audit.policyFingerprint,
    issuedAt,
    expiresAt,
    executionScope: ["prepare", "simulate"],
    executionStatus: "not_executed",
    fundsMoved: false
  };
}
