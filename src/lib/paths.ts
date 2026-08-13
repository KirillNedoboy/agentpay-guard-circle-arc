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
