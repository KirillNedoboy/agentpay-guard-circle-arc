import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import { auditLogPath, executionStorePath } from "@/lib/paths";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("audit log path", () => {
  test("uses an explicit external audit log path for local smoke checks", () => {
    const temporaryAuditPath = join(tmpdir(), "agentpay-guard-smoke", "audit-log.jsonl");
    vi.stubEnv("AGENTPAY_AUDIT_LOG_PATH", temporaryAuditPath);

    expect(auditLogPath()).toBe(temporaryAuditPath);
  });
});

describe("execution store path", () => {
  test("uses AGENTPAY_EXECUTION_STORE_PATH when set", () => {
    const temporaryStorePath = join(tmpdir(), "agentpay-guard-smoke", "execution-store");
    vi.stubEnv("AGENTPAY_EXECUTION_STORE_PATH", temporaryStorePath);

    expect(executionStorePath()).toBe(temporaryStorePath);
  });

  test("defaults to the audit-log directory with an execution-store suffix", () => {
    expect(executionStorePath()).toBe(join(dirname(auditLogPath()), "execution-store"));
  });
});
