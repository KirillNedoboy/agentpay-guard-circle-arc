import { afterEach, expect, test } from "vitest";
import { auditLogPath, policyPath } from "@/lib/paths";

const initialAuditPath = process.env.AUDIT_LOG_PATH;
const initialPolicyPath = process.env.POLICY_CONFIG_PATH;

afterEach(() => {
  if (initialAuditPath === undefined) {
    delete process.env.AUDIT_LOG_PATH;
  } else {
    process.env.AUDIT_LOG_PATH = initialAuditPath;
  }

  if (initialPolicyPath === undefined) {
    delete process.env.POLICY_CONFIG_PATH;
  } else {
    process.env.POLICY_CONFIG_PATH = initialPolicyPath;
  }
});

test("uses owner-provided file paths when configured", () => {
  process.env.AUDIT_LOG_PATH = "C:/tmp/agentpay-smoke-audit.jsonl";
  process.env.POLICY_CONFIG_PATH = "C:/tmp/agentpay-smoke-policy.json";

  expect(auditLogPath()).toBe("C:/tmp/agentpay-smoke-audit.jsonl");
  expect(policyPath()).toBe("C:/tmp/agentpay-smoke-policy.json");
});
