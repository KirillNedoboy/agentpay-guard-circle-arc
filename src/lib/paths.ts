import { dirname, join } from "node:path";

export function policyPath(): string {
  return join(process.cwd(), "data", "policies.default.json");
}

export function auditLogPath(): string {
  if (process.env.AGENTPAY_AUDIT_LOG_PATH) {
    return process.env.AGENTPAY_AUDIT_LOG_PATH;
  }
  return join(process.cwd(), "data", "audit-log.jsonl");
}

export function observationLogPath(): string {
  if (process.env.AGENTPAY_OBSERVATION_LOG_PATH) {
    return process.env.AGENTPAY_OBSERVATION_LOG_PATH;
  }
  return join(dirname(auditLogPath()), "evaluation-observations.jsonl");
}

/**
 * I3 — root directory of the restart-safe execution state store (single-use
 * execution claims for consumed x402 ExecutionAuthorization v2 records).
 * Explicit `AGENTPAY_EXECUTION_STORE_PATH` wins; otherwise the store lives
 * next to the audit log (`<dir of auditLogPath()>/execution-store`) so
 * runtime artifacts stay together while remaining a separate evidence
 * boundary from the canonical policy/audit evidence.
 */
export function executionStorePath(): string {
  if (process.env.AGENTPAY_EXECUTION_STORE_PATH) {
    return process.env.AGENTPAY_EXECUTION_STORE_PATH;
  }
  return join(dirname(auditLogPath()), "execution-store");
}
