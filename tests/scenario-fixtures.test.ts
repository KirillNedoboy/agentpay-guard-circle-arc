import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";
import { evaluatePolicy } from "@/domain/policy/engine";
import { loadPolicyConfig } from "@/domain/policy/policy-config";

const root = process.cwd();
const examplesPath = join(root, "examples");
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

const requiredFixtures = [
  ["scenario-review-cctp-fast-transfer.json", "REVIEW"],
  ["scenario-allow-cctp-standard.json", "ALLOW"],
  ["scenario-block-cctp-route.json", "BLOCK"],
  ["scenario-review-erc20-approval.json", "REVIEW"],
  ["scenario-review-paymaster.json", "REVIEW"]
] as const;

function loadFixture(fileName: string) {
  const parsed = JSON.parse(readFileSync(join(examplesPath, fileName), "utf8")) as Record<string, unknown>;
  const { expectedDecision, ...intent } = parsed;
  return {
    expectedDecision,
    intent: validatePaymentIntent(intent)
  };
}

describe("programmable payment demo fixtures", () => {
  test("adds focused CCTP, ERC-20, and Paymaster fixtures without replacing generic scenarios", () => {
    const fileNames = readdirSync(examplesPath);

    expect(fileNames).toEqual(
      expect.arrayContaining([
        "scenario-allow-api.json",
        "scenario-review-machine.json",
        "scenario-block-risky.json",
        ...requiredFixtures.map(([fileName]) => fileName)
      ])
    );
  });

  test.each(requiredFixtures)("loads %s and evaluates it to %s", (fileName, expectedDecision) => {
    const fixture = loadFixture(fileName);
    const result = evaluatePolicy(fixture.intent, policy, []);

    expect(fixture.expectedDecision).toBe(expectedDecision);
    expect(result.decision).toBe(expectedDecision);
    expect(JSON.stringify(fixture.intent)).not.toMatch(/transactionHash|txHash|signature|privateKey|settlement/i);
  });
});
