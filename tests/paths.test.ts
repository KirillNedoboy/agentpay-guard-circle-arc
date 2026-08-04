import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import { auditLogPath } from "@/lib/paths";

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
