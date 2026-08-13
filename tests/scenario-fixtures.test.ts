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

  const canonicalFixtures = [
    ["scenario-allow-api.json", "ALLOW"],
    ["scenario-review-machine.json", "REVIEW"],
    ["scenario-block-risky.json", "BLOCK"]
  ] as const;

  test.each(canonicalFixtures)("canonical scenario %s evaluates to %s", (fileName, expectedDecision) => {
    const fixture = loadFixture(fileName);
    const result = evaluatePolicy(fixture.intent, policy, []);

    expect(fixture.expectedDecision).toBe(expectedDecision);
    expect(result.decision).toBe(expectedDecision);
    expect(JSON.stringify(fixture.intent)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase|settled|settlementStatus|confirmed/i);
  });

  test("the replay descriptor references an existing ALLOW fixture consistently", () => {
    const descriptor = JSON.parse(readFileSync(join(examplesPath, "scenario-replay.json"), "utf8")) as {
      scenarioType: string;
      replayOf: string;
      expectedDecision: string;
      expectedReplay: boolean;
      expectedReplayMismatch: boolean;
      expectedPolicyChanged: boolean;
      expectedAuthorization: boolean;
    };

    expect(descriptor.scenarioType).toBe("replay");
    expect(descriptor.expectedDecision).toBe("ALLOW");
    expect(descriptor.expectedReplay).toBe(true);
    expect(descriptor.expectedReplayMismatch).toBe(false);
    expect(descriptor.expectedPolicyChanged).toBe(false);
    expect(descriptor.expectedAuthorization).toBe(true);

    const referenced = loadFixture(descriptor.replayOf);
    expect(referenced.expectedDecision).toBe("ALLOW");
  });
});
