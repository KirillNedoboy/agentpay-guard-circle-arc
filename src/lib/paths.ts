import { join } from "node:path";

export function policyPath(): string {
  return process.env.POLICY_CONFIG_PATH ?? join(process.cwd(), "data", "policies.default.json");
}

export function auditLogPath(): string {
  return process.env.AUDIT_LOG_PATH ?? join(process.cwd(), "data", "audit-log.jsonl");
}
