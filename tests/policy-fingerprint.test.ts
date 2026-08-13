import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";
import { loadPolicyConfig } from "@/domain/policy/policy-config";

describe("policy fingerprint", () => {
  test("produces the sha256 format", () => {
    expect(fingerprintPolicy({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("same content hashes equal", () => {
    const a = fingerprintPolicy({ policyId: "p", limits: { max: "10.00" } });
    const b = fingerprintPolicy({ policyId: "p", limits: { max: "10.00" } });
    expect(a).toBe(b);
  });

  test("equivalent objects with different key insertion order hash equal", () => {
    const a = fingerprintPolicy({
      policyId: "p",
      limits: { maxAmountPerPayment: "10.00", dailyLimitPerAgent: "25.00" },
      velocity: { windowSeconds: 60 }
    });
    const b = fingerprintPolicy({
      velocity: { windowSeconds: 60 },
      limits: { dailyLimitPerAgent: "25.00", maxAmountPerPayment: "10.00" },
      policyId: "p"
    });
    expect(a).toBe(b);
  });

  test("one meaningful value change changes the hash", () => {
    const a = fingerprintPolicy({ policyId: "p", limits: { maxAmountPerPayment: "10.00" } });
    const b = fingerprintPolicy({ policyId: "p", limits: { maxAmountPerPayment: "10.01" } });
    expect(a).not.toBe(b);
  });

  test("array order is significant", () => {
    const a = fingerprintPolicy({ allowlistedRecipients: ["a", "b"] });
    const b = fingerprintPolicy({ allowlistedRecipients: ["b", "a"] });
    expect(a).not.toBe(b);
  });

  test("rejects non-JSON-safe values", () => {
    expect(() => fingerprintPolicy({ bad: undefined })).toThrow();
    expect(() => fingerprintPolicy({ bad: Number.NaN })).toThrow();
    expect(() => fingerprintPolicy({ bad: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => fingerprintPolicy({ bad: () => 1 })).toThrow();
  });

  test("the default policy fingerprint is deterministic across loads", () => {
    const first = loadPolicyConfig(join(process.cwd(), "data", "policies.default.json"));
    const second = loadPolicyConfig(join(process.cwd(), "data", "policies.default.json"));
    expect(fingerprintPolicy(first)).toBe(fingerprintPolicy(second));
  });
});
