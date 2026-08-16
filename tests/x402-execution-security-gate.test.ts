/**
 * x402-execution-security-gate.test.ts
 *
 * I2 — pure, fail-closed execution security gate tests: the local security
 * boundary deciding whether an already-issued Guard ExecutionAuthorization v1
 * may become ELIGIBLE FOR A FUTURE EXTERNAL SIGNER REQUEST for one exact x402
 * PaymentRequirement.
 *
 * Conventions (matching the repo suite): no mocks of execution, no fake
 * transaction hashes/wallets/signatures anywhere; temp audit paths only
 * (mkdtempSync + AGENTPAY_AUDIT_LOG_PATH restored in afterEach); deterministic
 * TEST-ONLY addresses (0x1111.../0x2222...) that are never real sellers;
 * explicit `now` values — no sleeps, no machine-clock dependence, no
 * Date.now() inside the gate.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import type { ReplayEvidence } from "@/domain/audit/replay-evidence";
import { evaluatePaymentIntent } from "@/domain/payment-intent/evaluate";
import { validatePaymentIntent } from "@/domain/payment-intent/validation";
import { evaluatePolicy } from "@/domain/policy/engine";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";
import { loadPolicyConfig, type PolicyConfig } from "@/domain/policy/policy-config";
import { DecimalNotRepresentableError, decimalToAtomicUnits } from "@/lib/decimal";
import {
  fingerprintX402PaymentRequirement,
  validateX402PaymentRequirement,
  type X402PaymentRequirement
} from "@/domain/x402/payment-requirement";
import {
  buildPaymentRequirementEvidence,
  type PaymentRequirementEvidence
} from "@/domain/x402/payment-requirement-evidence";
import {
  evaluateX402ExecutionGate,
  X402_EXECUTION_GATE_ALLOWED_REASON_CODE,
  type X402ExecutionGateInput,
  type X402ExecutionGateRejectionCode,
  type X402ExecutionGateResult,
  type X402RecipientBinding
} from "@/domain/x402/execution-security-gate";
import type { X402ExecutionAuthorizationV2 } from "@/domain/x402/execution-authorization-v2";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const TEST_PAYTO = "0x1111111111111111111111111111111111111111";
const TEST_PAYTO_ALT = "0x2222222222222222222222222222222222222222";

const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-gate-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

afterEach(() => {
  if (previousAuditPath === undefined) {
    delete process.env.AGENTPAY_AUDIT_LOG_PATH;
  } else {
    process.env.AGENTPAY_AUDIT_LOG_PATH = previousAuditPath;
  }
  if (previousObservationPath === undefined) {
    delete process.env.AGENTPAY_OBSERVATION_LOG_PATH;
  } else {
    process.env.AGENTPAY_OBSERVATION_LOG_PATH = previousObservationPath;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Deterministic v1 authorization fixture. Defaults are current-policy
 * attributed (policyVersion "3" + live fingerprint) with FIXED timestamps
 * (issuedAt 10:15:30.000Z, expiresAt 10:20:30.000Z = issued + 300 s TTL) so
 * expiry tests are exact and machine-clock independent.
 */
function makeV1Authorization(overrides: Partial<ExecutionAuthorization> = {}): ExecutionAuthorization {
  return {
    authorizationType: "execution_authorization",
    version: "v1",
    authorizationId: `auth_${"a".repeat(64)}`,
    scope: "single_intent",
    intentId: "intent_demo_001",
    idempotencyKey: "demo-auth-001",
    auditId: "audit_20260707_000001",
    agentId: "agent_auth_demo_001",
    recipient: "trusted-x402-api.demo",
    asset: "USDC",
    maxAmountUSDC: "0.08",
    paymentRail: "mock_x402_service",
    rail: "mock_x402_service",
    decision: "ALLOW",
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyFingerprint: fingerprintPolicy(policy),
    issuedAt: "2026-07-07T10:15:30.000Z",
    expiresAt: "2026-07-07T10:20:30.000Z",
    executionScope: ["prepare", "simulate"],
    executionStatus: "not_executed",
    fundsMoved: false,
    ...overrides
  };
}

/** Deterministic replay evidence: exact replay, no mismatch, no drift. */
function makeReplayEvidence(overrides: Partial<ReplayEvidence> = {}): ReplayEvidence {
  return {
    replayed: true,
    replayMismatch: false,
    policyChanged: false,
    storedIntentFingerprint: `sha256:${"b".repeat(64)}`,
    currentIntentFingerprint: `sha256:${"b".repeat(64)}`,
    storedPolicyVersion: policy.policyVersion,
    currentPolicyVersion: policy.policyVersion,
    storedPolicyFingerprint: fingerprintPolicy(policy),
    currentPolicyFingerprint: fingerprintPolicy(policy),
    ...overrides
  };
}

/**
 * Raw official fixture per integration-feasibility.md (S17/S20/S21/S24/S25):
 * Arc Testnet, official USDC ERC-20 interface (6 decimals), official Gateway
 * EIP-712 domain, official maxTimeoutSeconds 604900, TEST-ONLY deterministic
 * payTo. `validateX402PaymentRequirement` normalizes it.
 */
function makeRequirementRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scheme: "exact",
    network: ARC_TESTNET_NETWORK,
    amount: "80000", // 0.08 USDC at 6 decimals, matching the canonical ALLOW fixture amount
    asset: ARC_USDC_ASSET,
    payTo: TEST_PAYTO,
    maxTimeoutSeconds: 604900,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: GATEWAY_WALLET
    },
    ...overrides
  };
}

function makeValidRequirement(overrides: Record<string, unknown> = {}): X402PaymentRequirement {
  return validateX402PaymentRequirement(makeRequirementRaw(overrides));
}

function makeEvidence(requirement: X402PaymentRequirement): PaymentRequirementEvidence {
  return buildPaymentRequirementEvidence(requirement);
}

function makeBinding(overrides: Partial<X402RecipientBinding> = {}): X402RecipientBinding {
  return { recipient: "trusted-x402-api.demo", payTo: TEST_PAYTO, ...overrides };
}

/** Between the fixture issuedAt (10:15:30Z) and expiresAt (10:20:30Z). */
const DEFAULT_NOW = new Date("2026-07-07T10:18:00.000Z");

function allowedGateInput(overrides: Partial<X402ExecutionGateInput> = {}): X402ExecutionGateInput {
  const requirement = makeValidRequirement();
  return {
    authorization: makeV1Authorization(),
    replayEvidence: makeReplayEvidence(),
    paymentRequirement: requirement,
    paymentRequirementEvidence: makeEvidence(requirement),
    recipientBinding: makeBinding(),
    policy,
    now: DEFAULT_NOW,
    ...overrides
  };
}

function expectRejected(result: X402ExecutionGateResult, codes: X402ExecutionGateRejectionCode[]): void {
  expect(result.eligibleForSignerRequest).toBe(false);
  if (result.eligibleForSignerRequest) {
    throw new Error("gate unexpectedly allowed");
  }
  expect(result.reasonCodes).toEqual(codes);
  expect(result.authorization).toBeNull();
  expect(result.executionStatus).toBe("not_executed");
  expect(result.fundsMoved).toBe(false);
}

function expectAllowed(result: X402ExecutionGateResult): X402ExecutionAuthorizationV2 {
  expect(result.eligibleForSignerRequest).toBe(true);
  if (!result.eligibleForSignerRequest) {
    throw new Error("gate unexpectedly rejected");
  }
  expect(result.reasonCodes).toEqual([X402_EXECUTION_GATE_ALLOWED_REASON_CODE]);
  return result.authorization;
}

function loadScenarioIntent(fileName: string) {
  const parsed = JSON.parse(readFileSync(join(root, "examples", fileName), "utf8")) as Record<string, unknown>;
  const { expectedDecision, ...intent } = parsed;
  return {
    expectedDecision: expectedDecision as string,
    intent: validatePaymentIntent(intent)
  };
}

describe("decimalToAtomicUnits", () => {
  test.each([
    ["0.08", "80000"],
    ["0.01", "10000"],
    ["1", "1000000"],
    ["0.000001", "1"]
  ])("maps %s to %s atomic units (official examples)", (value, expected) => {
    expect(decimalToAtomicUnits(value, 6)).toBe(expected);
  });

  test.each([
    ["0.080", "80000"],
    ["0.0100", "10000"],
    ["10", "10000000"],
    ["0.5", "500000"],
    ["123.456", "123456000"],
    ["0", "0"]
  ])("maps %s to %s atomic units (trailing zeros and larger values)", (value, expected) => {
    expect(decimalToAtomicUnits(value, 6)).toBe(expected);
  });

  test.each(["0.0000001", "0.0000009", "1.0000001", "0.0800001"])(
    "throws DecimalNotRepresentableError for %s (more than 6 fractional digits — never rounds)",
    (value) => {
      expect(() => decimalToAtomicUnits(value, 6)).toThrow(DecimalNotRepresentableError);
    }
  );

  test.each(["-0.08", "-1", "", "abc", "1e4", "1.2.3", "00.08", ".08", "0x08"])(
    "throws DecimalNotRepresentableError for non-canonical decimal %s",
    (value) => {
      expect(() => decimalToAtomicUnits(value, 6)).toThrow(DecimalNotRepresentableError);
    }
  );

  test("trims surrounding whitespace, consistent with the repo decimal parser", () => {
    expect(decimalToAtomicUnits(" 0.08 ", 6)).toBe("80000");
  });

  test.each([-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "throws DecimalNotRepresentableError for invalid decimals %s",
    (decimals) => {
      expect(() => decimalToAtomicUnits("0.08", decimals)).toThrow(DecimalNotRepresentableError);
    }
  );

  test("supports non-6 decimal precision", () => {
    expect(decimalToAtomicUnits("0.5", 18)).toBe("500000000000000000");
    expect(decimalToAtomicUnits("1.5", 2)).toBe("150");
  });

  test("uses BigInt string math, never floating point", () => {
    expect(decimalToAtomicUnits("0.1", 6)).toBe("100000"); // float 0.1 would be 0.100000000000000005...
    expect(decimalToAtomicUnits("9007199254740993", 0)).toBe("9007199254740993"); // > Number.MAX_SAFE_INTEGER whole
  });
});

describe("execution security gate: positive path", () => {
  test("allows the canonical ALLOW v1 authorization with an exact official requirement (real evaluation path)", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-allow-api.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as {
      decision: string;
      replayEvidence: ReplayEvidence;
      executionAuthorization?: ExecutionAuthorization;
    };

    expect(expectedDecision).toBe("ALLOW");
    expect(body.decision).toBe("ALLOW");
    expect(body.replayEvidence).toMatchObject({ replayed: false, replayMismatch: false, policyChanged: false });
    const v1 = body.executionAuthorization;
    expect(v1).toBeDefined();
    expect(v1?.maxAmountUSDC).toBe("0.08"); // canonical ALLOW fixture amount

    const requirement = makeValidRequirement({ amount: "80000" });
    const evidence = makeEvidence(requirement);
    const result = evaluateX402ExecutionGate({
      authorization: v1!,
      replayEvidence: body.replayEvidence,
      paymentRequirement: requirement,
      paymentRequirementEvidence: evidence,
      recipientBinding: { recipient: v1!.recipient, payTo: TEST_PAYTO },
      policy,
      now: new Date(Date.parse(v1!.expiresAt) - 1000) // explicitly before the parent TTL expiry
    });

    const v2 = expectAllowed(result);
    expect(v2.version).toBe("v2");
    expect(v2.parentAuthorizationId).toBe(v1!.authorizationId);
    expect(v2.auditId).toBe(v1!.auditId);
    expect(v2.intentId).toBe(v1!.intentId);
    expect(v2.idempotencyKey).toBe(v1!.idempotencyKey);
    expect(v2.agentId).toBe(v1!.agentId);
    expect(v2.recipient).toBe(v1!.recipient);
    expect(v2.paymentRequirementDigest).toBe(evidence.requirementDigest);
    expect(v2.paymentRequirementDigest).toBe(fingerprintX402PaymentRequirement(requirement));
    expect(v2.issuedAt).toBe(v1!.issuedAt); // parent values, never `now`
    expect(v2.expiresAt).toBe(v1!.expiresAt);
    expect(v2.policyVersion).toBe(policy.policyVersion);
    expect(v2.policyFingerprint).toBe(fingerprintPolicy(policy));
    expect(v2.executionScope).toEqual(["prepare", "simulate"]);
    expect(v2.eligibility).toBe("eligible_for_external_signer_request");
    expect(v2.executionStatus).toBe("not_executed");
    expect(v2.fundsMoved).toBe(false);
    expect(v2.x402).toEqual({
      protocolVersion: 2,
      scheme: "exact",
      network: ARC_TESTNET_NETWORK,
      chainId: "5042002",
      assetSymbol: "USDC",
      assetAddress: ARC_USDC_ASSET,
      assetDecimals: 6,
      payTo: TEST_PAYTO,
      amountAtomic: "80000",
      maxTimeoutSeconds: 604900,
      eip712: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: GATEWAY_WALLET
      },
      assetTransferMethod: "eip3009",
      paymentFlow: "authorization"
    });
  });

  test("treats omitted optional extra keys as the official defaults (assetTransferMethod eip3009, paymentFlow authorization)", () => {
    const omitted = allowedGateInput(); // fixture omits assetTransferMethod/paymentFlow
    const explicitRequirement = makeValidRequirement({
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: GATEWAY_WALLET,
        assetTransferMethod: "eip3009",
        paymentFlow: "authorization"
      }
    });
    const explicit = allowedGateInput({
      paymentRequirement: explicitRequirement,
      paymentRequirementEvidence: makeEvidence(explicitRequirement)
    });

    expectAllowed(evaluateX402ExecutionGate(omitted));
    expectAllowed(evaluateX402ExecutionGate(explicit));
  });

  test("exact replay of the same canonical ALLOW evaluation may pass and re-derives the same deterministic v2", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { intent } = loadScenarioIntent("scenario-allow-api.json");

    const first = (await evaluatePaymentIntent(intent)) as unknown as {
      replayEvidence: ReplayEvidence;
      executionAuthorization?: ExecutionAuthorization;
    };
    const second = (await evaluatePaymentIntent(intent)) as unknown as {
      replayEvidence: ReplayEvidence;
      executionAuthorization?: ExecutionAuthorization;
    };

    expect(second.replayEvidence).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: false });
    expect(second.executionAuthorization?.authorizationId).toBe(first.executionAuthorization?.authorizationId);
    const v1 = second.executionAuthorization!;

    const requirement = makeValidRequirement({ amount: "80000" });
    const evidence = makeEvidence(requirement);
    const gateInput = {
      authorization: v1,
      replayEvidence: second.replayEvidence,
      paymentRequirement: requirement,
      paymentRequirementEvidence: evidence,
      recipientBinding: { recipient: v1.recipient, payTo: TEST_PAYTO },
      policy,
      now: new Date(Date.parse(v1.expiresAt) - 1000)
    };

    const v2a = expectAllowed(evaluateX402ExecutionGate(gateInput));
    const v2b = expectAllowed(evaluateX402ExecutionGate(gateInput));

    expect(v2a.authorizationId).toBe(v2b.authorizationId);
    expect(v2a.parentAuthorizationId).toBe(v1.authorizationId);
    expect(v2a.auditId).toBe(first.executionAuthorization?.auditId);
    expect(v2a.executionStatus).toBe("not_executed");
    expect(v2a.fundsMoved).toBe(false);
  });
});

describe("execution security gate: replay and policy-drift negatives", () => {
  test("replayMismatch true → X402_GATE_REPLAY_MISMATCH, no v2", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ replayEvidence: makeReplayEvidence({ replayMismatch: true }) })
    );
    expectRejected(result, ["X402_GATE_REPLAY_MISMATCH"]);
  });

  test("replayMismatch null → X402_GATE_REPLAY_STATE_UNKNOWN, no v2", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ replayEvidence: makeReplayEvidence({ replayMismatch: null }) })
    );
    expectRejected(result, ["X402_GATE_REPLAY_STATE_UNKNOWN"]);
  });

  test("policyChanged true → X402_GATE_POLICY_CHANGED, no v2", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ replayEvidence: makeReplayEvidence({ policyChanged: true }) })
    );
    expectRejected(result, ["X402_GATE_POLICY_CHANGED"]);
  });

  test("policyChanged null → X402_GATE_POLICY_STATE_UNKNOWN, no v2", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ replayEvidence: makeReplayEvidence({ policyChanged: null }) })
    );
    expectRejected(result, ["X402_GATE_POLICY_STATE_UNKNOWN"]);
  });

  test("tampered old policyVersion on the v1 authorization → X402_GATE_POLICY_ATTRIBUTION_MISMATCH", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ authorization: makeV1Authorization({ policyVersion: "2" }) })
    );
    expectRejected(result, ["X402_GATE_POLICY_ATTRIBUTION_MISMATCH"]);
  });

  test("tampered policyFingerprint on the v1 authorization → X402_GATE_POLICY_ATTRIBUTION_MISMATCH", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        authorization: makeV1Authorization({ policyFingerprint: `sha256:${"0".repeat(64)}` })
      })
    );
    expectRejected(result, ["X402_GATE_POLICY_ATTRIBUTION_MISMATCH"]);
  });

  test("multiple independent failures collect all applicable codes in fixed documented order", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        replayEvidence: makeReplayEvidence({ replayMismatch: true, policyChanged: true }),
        authorization: makeV1Authorization({ policyVersion: "2" })
      })
    );
    expectRejected(result, [
      "X402_GATE_REPLAY_MISMATCH",
      "X402_GATE_POLICY_CHANGED",
      "X402_GATE_POLICY_ATTRIBUTION_MISMATCH"
    ]);
  });
});

describe("execution security gate: runtime expiry (Guard TTL, not EIP-3009)", () => {
  test("now = expiresAt - 1ms → the expiry gate alone permits", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ now: new Date(Date.parse("2026-07-07T10:20:30.000Z") - 1) })
    );
    expectAllowed(result);
  });

  test("now === expiresAt → X402_GATE_AUTHORIZATION_EXPIRED", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ now: new Date("2026-07-07T10:20:30.000Z") })
    );
    expectRejected(result, ["X402_GATE_AUTHORIZATION_EXPIRED"]);
  });

  test("now > expiresAt → X402_GATE_AUTHORIZATION_EXPIRED", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ now: new Date("2026-07-07T10:20:30.001Z") })
    );
    expectRejected(result, ["X402_GATE_AUTHORIZATION_EXPIRED"]);
  });

  test("malformed expiresAt → X402_GATE_AUTHORIZATION_TIMESTAMP_MALFORMED (fail closed)", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ authorization: makeV1Authorization({ expiresAt: "not-a-timestamp" }) })
    );
    expectRejected(result, ["X402_GATE_AUTHORIZATION_TIMESTAMP_MALFORMED"]);
  });

  test("invalid now (NaN time) fails closed under X402_GATE_AUTHORIZATION_EXPIRED", () => {
    const result = evaluateX402ExecutionGate(allowedGateInput({ now: new Date(NaN) }));
    expectRejected(result, ["X402_GATE_AUTHORIZATION_EXPIRED"]);
  });
});

describe("execution security gate: requirement digest binding", () => {
  test("evidence built for requirement A, gate called with requirement B (changed maxTimeoutSeconds) → digest mismatch", () => {
    const requirementA = makeValidRequirement();
    const requirementB = makeValidRequirement({ maxTimeoutSeconds: 604899 });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        paymentRequirement: requirementB,
        paymentRequirementEvidence: makeEvidence(requirementA)
      })
    );
    expectRejected(result, ["X402_GATE_REQUIREMENT_DIGEST_MISMATCH"]);
  });

  test("evidence for A, requirement B with a changed amount → digest mismatch plus amount mismatch", () => {
    const requirementA = makeValidRequirement({ amount: "80000" });
    const requirementB = makeValidRequirement({ amount: "80001" });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        paymentRequirement: requirementB,
        paymentRequirementEvidence: makeEvidence(requirementA)
      })
    );
    expectRejected(result, ["X402_GATE_REQUIREMENT_DIGEST_MISMATCH", "X402_GATE_AMOUNT_MISMATCH"]);
  });

  test("the gate recomputes the digest with the I1 helper and never trusts evidence blindly", () => {
    const requirement = makeValidRequirement();
    const forgedEvidence: PaymentRequirementEvidence = {
      ...makeEvidence(requirement),
      requirementDigest: `sha256:${"f".repeat(64)}`
    };
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirementEvidence: forgedEvidence })
    );
    expectRejected(result, ["X402_GATE_REQUIREMENT_DIGEST_MISMATCH"]);
  });
});

describe("execution security gate: network allowlist", () => {
  test("Arc Testnet eip155:5042002 is allowed", () => {
    const result = evaluateX402ExecutionGate(allowedGateInput());
    expectAllowed(result);
  });

  test("I1 syntax accepts eip155:84532, but the gate rejects it (syntax validation != execution allowlisting)", () => {
    const requirement = validateX402PaymentRequirement(makeRequirementRaw({ network: "eip155:84532" }));
    expect(requirement.network).toBe("eip155:84532"); // syntactically valid at I1

    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectRejected(result, ["X402_GATE_NETWORK_NOT_ALLOWED"]);
  });

  test("entry-dependent checks are skipped when no allowlist entry matched", () => {
    // Weird asset + wrong amount + unallowlisted network: only the network
    // code may fire — asset/amount/domain/timeout checks apply only after an
    // entry matched.
    const requirement = validateX402PaymentRequirement(
      makeRequirementRaw({
        network: "eip155:84532",
        asset: "0x9999999999999999999999999999999999999999",
        amount: "1"
      })
    );
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        paymentRequirement: requirement,
        paymentRequirementEvidence: makeEvidence(requirement)
      })
    );
    expectRejected(result, ["X402_GATE_NETWORK_NOT_ALLOWED"]);
  });
});

describe("execution security gate: asset binding", () => {
  test("a different structurally valid EVM asset → X402_GATE_ASSET_NOT_ALLOWED", () => {
    const requirement = makeValidRequirement({ asset: "0x3600000000000000000000000000000000000001" });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectRejected(result, ["X402_GATE_ASSET_NOT_ALLOWED"]);
  });

  test("same asset address in different letter casing passes semantic comparison and preserves the exact value", () => {
    const mixedCaseAsset = "0xAbCdef0123456789AbCdef0123456789AbCdef01";
    const lowercaseAsset = "0xabcdef0123456789abcdef0123456789abcdef01";
    const entry = policy.x402Execution.allowedRequirements[0];
    const clonedPolicy: PolicyConfig = {
      ...policy,
      x402Execution: { allowedRequirements: [{ ...entry, asset: mixedCaseAsset }] }
    };

    const requirement = makeValidRequirement({ asset: lowercaseAsset });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        paymentRequirement: requirement,
        paymentRequirementEvidence: makeEvidence(requirement),
        policy: clonedPolicy,
        authorization: makeV1Authorization({ policyFingerprint: fingerprintPolicy(clonedPolicy) })
      })
    );

    const v2 = expectAllowed(result);
    expect(v2.x402.assetAddress).toBe(lowercaseAsset); // exact requirement value preserved
  });

  test("digest semantics remain exact-value-sensitive across casing (semantic equality never alters the digest)", () => {
    const mixedCaseAsset = "0xAbCdef0123456789AbCdef0123456789AbCdef01";
    const lowercaseAsset = "0xabcdef0123456789abcdef0123456789abcdef01";
    expect(fingerprintX402PaymentRequirement(makeValidRequirement({ asset: mixedCaseAsset }))).not.toBe(
      fingerprintX402PaymentRequirement(makeValidRequirement({ asset: lowercaseAsset }))
    );
  });
});

describe("execution security gate: Gateway EIP-712 domain binding", () => {
  test("changed extra.name → X402_GATE_EIP712_DOMAIN_NOT_ALLOWED", () => {
    const requirement = makeValidRequirement({
      extra: { name: "GatewayWalletBatched2", version: "1", verifyingContract: GATEWAY_WALLET }
    });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectRejected(result, ["X402_GATE_EIP712_DOMAIN_NOT_ALLOWED"]);
  });

  test("changed extra.version → X402_GATE_EIP712_DOMAIN_NOT_ALLOWED", () => {
    const requirement = makeValidRequirement({
      extra: { name: "GatewayWalletBatched", version: "2", verifyingContract: GATEWAY_WALLET }
    });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectRejected(result, ["X402_GATE_EIP712_DOMAIN_NOT_ALLOWED"]);
  });

  test("changed extra.verifyingContract → X402_GATE_EIP712_DOMAIN_NOT_ALLOWED", () => {
    const requirement = makeValidRequirement({
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B8"
      }
    });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectRejected(result, ["X402_GATE_EIP712_DOMAIN_NOT_ALLOWED"]);
  });

  test("entry-side drift: policy entry with a different domain name rejects the official requirement", () => {
    const entry = policy.x402Execution.allowedRequirements[0];
    const clonedPolicy: PolicyConfig = {
      ...policy,
      x402Execution: {
        allowedRequirements: [{ ...entry, eip712: { ...entry.eip712, name: "OtherDomain" } }]
      }
    };
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        policy: clonedPolicy,
        authorization: makeV1Authorization({ policyFingerprint: fingerprintPolicy(clonedPolicy) })
      })
    );
    expectRejected(result, ["X402_GATE_EIP712_DOMAIN_NOT_ALLOWED"]);
  });

  test("entry-side drift: policy entry with a different verifyingContract rejects the official requirement", () => {
    const entry = policy.x402Execution.allowedRequirements[0];
    const clonedPolicy: PolicyConfig = {
      ...policy,
      x402Execution: {
        allowedRequirements: [
          { ...entry, eip712: { ...entry.eip712, verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B8" } }
        ]
      }
    };
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        policy: clonedPolicy,
        authorization: makeV1Authorization({ policyFingerprint: fingerprintPolicy(clonedPolicy) })
      })
    );
    expectRejected(result, ["X402_GATE_EIP712_DOMAIN_NOT_ALLOWED"]);
  });

  test("verifyingContract comparison is case-insensitive (official Gateway wallet)", () => {
    const requirement = makeValidRequirement({
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9"
      }
    });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectAllowed(result);
  });
});

describe("execution security gate: timeout policy bound", () => {
  test("configured maximum maxTimeoutSeconds (604900) passes", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        paymentRequirement: makeValidRequirement({ maxTimeoutSeconds: 604900 }),
        paymentRequirementEvidence: makeEvidence(makeValidRequirement({ maxTimeoutSeconds: 604900 }))
      })
    );
    expectAllowed(result);
  });

  test("maxTimeoutSeconds above the configured maximum → X402_GATE_TIMEOUT_EXCEEDED", () => {
    const requirement = makeValidRequirement({ maxTimeoutSeconds: 604901 });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectRejected(result, ["X402_GATE_TIMEOUT_EXCEEDED"]);
  });
});

describe("execution security gate: recipient and payTo binding", () => {
  test("changed logical recipient binding → X402_GATE_RECIPIENT_BINDING_MISMATCH", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ recipientBinding: makeBinding({ recipient: "market-data-api.demo" }) })
    );
    expectRejected(result, ["X402_GATE_RECIPIENT_BINDING_MISMATCH"]);
  });

  test("changed trusted payTo binding → X402_GATE_PAYTO_MISMATCH", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ recipientBinding: makeBinding({ payTo: TEST_PAYTO_ALT }) })
    );
    expectRejected(result, ["X402_GATE_PAYTO_MISMATCH"]);
  });

  test("the requirement's own payTo is never the trusted binding source", () => {
    // The requirement's payTo is attacker-influenceable raw input; the gate
    // compares it ONLY against the trusted binding. A requirement payTo that
    // differs from the binding must fail even though it is a valid address.
    const requirement = makeValidRequirement({ payTo: TEST_PAYTO_ALT });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        paymentRequirement: requirement,
        paymentRequirementEvidence: makeEvidence(requirement)
      })
    );
    expectRejected(result, ["X402_GATE_PAYTO_MISMATCH"]);
  });

  test("case-only payTo difference between requirement and trusted binding passes (EVM semantic equality)", () => {
    const mixedCasePayTo = "0xAbCdef0123456789AbCdef0123456789AbCdef01";
    const lowercasePayTo = "0xabcdef0123456789abcdef0123456789abcdef01";
    const requirement = makeValidRequirement({ payTo: lowercasePayTo });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        paymentRequirement: requirement,
        paymentRequirementEvidence: makeEvidence(requirement),
        recipientBinding: makeBinding({ payTo: mixedCasePayTo })
      })
    );
    const v2 = expectAllowed(result);
    expect(v2.x402.payTo).toBe(lowercasePayTo); // exact requirement value preserved
  });
});

describe("execution security gate: exact amount binding", () => {
  test("authorization 0.08 vs requirement 80001 atomic → X402_GATE_AMOUNT_MISMATCH", () => {
    const requirement = makeValidRequirement({ amount: "80001" });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expectRejected(result, ["X402_GATE_AMOUNT_MISMATCH"]);
  });

  test("authorization 0.09 vs requirement 80000 atomic → X402_GATE_AMOUNT_MISMATCH", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ authorization: makeV1Authorization({ maxAmountUSDC: "0.09" }) })
    );
    expectRejected(result, ["X402_GATE_AMOUNT_MISMATCH"]);
  });

  test("non-representable authorization amount (0.0000001 at 6 decimals) → X402_GATE_AMOUNT_NOT_REPRESENTABLE, never rounded", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ authorization: makeV1Authorization({ maxAmountUSDC: "0.0000001" }) })
    );
    expectRejected(result, ["X402_GATE_AMOUNT_NOT_REPRESENTABLE"]);
  });

  test("more-than-6-digit fractional authorization amount → X402_GATE_AMOUNT_NOT_REPRESENTABLE", () => {
    const result = evaluateX402ExecutionGate(
      allowedGateInput({ authorization: makeV1Authorization({ maxAmountUSDC: "0.0800001" }) })
    );
    expectRejected(result, ["X402_GATE_AMOUNT_NOT_REPRESENTABLE"]);
  });

  test("gate path converts exact decimals: 1 USDC ↔ 1000000 atomic", () => {
    const requirement = makeValidRequirement({ amount: "1000000" });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        authorization: makeV1Authorization({ maxAmountUSDC: "1" }),
        paymentRequirement: requirement,
        paymentRequirementEvidence: makeEvidence(requirement)
      })
    );
    const v2 = expectAllowed(result);
    expect(v2.x402.amountAtomic).toBe("1000000");
  });

  test("gate path converts exact decimals: 0.000001 USDC ↔ 1 atomic", () => {
    const requirement = makeValidRequirement({ amount: "1" });
    const result = evaluateX402ExecutionGate(
      allowedGateInput({
        authorization: makeV1Authorization({ maxAmountUSDC: "0.000001" }),
        paymentRequirement: requirement,
        paymentRequirementEvidence: makeEvidence(requirement)
      })
    );
    const v2 = expectAllowed(result);
    expect(v2.x402.amountAtomic).toBe("1");
  });
});

describe("v2 authorization identity", () => {
  test("same exact allowed inputs → same deterministic v2 authorizationId", () => {
    const first = evaluateX402ExecutionGate(allowedGateInput());
    const second = evaluateX402ExecutionGate(allowedGateInput());
    expect(expectAllowed(first).authorizationId).toBe(expectAllowed(second).authorizationId);
    expect(expectAllowed(first).authorizationId).toMatch(/^auth_[0-9a-f]{64}$/);
  });

  test("different requirement digest (changed maxTimeoutSeconds, still gate-passing) → different v2 authorizationId", () => {
    const base = expectAllowed(evaluateX402ExecutionGate(allowedGateInput()));
    const requirement = makeValidRequirement({ maxTimeoutSeconds: 604899 }); // still within the entry bound
    const variant = expectAllowed(
      evaluateX402ExecutionGate(
        allowedGateInput({
          paymentRequirement: requirement,
          paymentRequirementEvidence: makeEvidence(requirement)
        })
      )
    );
    expect(fingerprintX402PaymentRequirement(requirement)).not.toBe(
      fingerprintX402PaymentRequirement(makeValidRequirement())
    );
    expect(variant.authorizationId).not.toBe(base.authorizationId);
    expect(variant.x402.maxTimeoutSeconds).toBe(604899);
  });

  test("different trusted payTo binding with a matching valid requirement → different v2 authorizationId", () => {
    const base = expectAllowed(evaluateX402ExecutionGate(allowedGateInput()));
    const requirement = makeValidRequirement({ payTo: TEST_PAYTO_ALT });
    const variant = expectAllowed(
      evaluateX402ExecutionGate(
        allowedGateInput({
          paymentRequirement: requirement,
          paymentRequirementEvidence: makeEvidence(requirement),
          recipientBinding: makeBinding({ payTo: TEST_PAYTO_ALT })
        })
      )
    );
    expect(variant.authorizationId).not.toBe(base.authorizationId);
  });

  test("`now` does not affect the v2 authorizationId or any v2 field", () => {
    const early = expectAllowed(
      evaluateX402ExecutionGate(allowedGateInput({ now: new Date("2026-07-07T10:16:00.000Z") }))
    );
    const late = expectAllowed(
      evaluateX402ExecutionGate(allowedGateInput({ now: new Date("2026-07-07T10:19:59.000Z") }))
    );
    expect(late.authorizationId).toBe(early.authorizationId);
    expect(JSON.stringify(late)).toBe(JSON.stringify(early));
  });

  test("key-order-normalized identical raw inputs → same normalized requirement → same v2 authorizationId", () => {
    const base = expectAllowed(evaluateX402ExecutionGate(allowedGateInput()));
    const reorderedRaw = {
      extra: { version: "1", name: "GatewayWalletBatched", verifyingContract: GATEWAY_WALLET },
      maxTimeoutSeconds: 604900,
      payTo: TEST_PAYTO,
      asset: ARC_USDC_ASSET,
      amount: "80000",
      network: ARC_TESTNET_NETWORK,
      scheme: "exact"
    };
    const requirement = validateX402PaymentRequirement(reorderedRaw);
    expect(fingerprintX402PaymentRequirement(requirement)).toBe(
      fingerprintX402PaymentRequirement(makeValidRequirement())
    );
    const variant = expectAllowed(
      evaluateX402ExecutionGate(
        allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
      )
    );
    expect(variant.authorizationId).toBe(base.authorizationId);
  });

  test("v2 authorizationId directly commits the parent expiry: changed parent expiry → different id", () => {
    const base = expectAllowed(evaluateX402ExecutionGate(allowedGateInput()));
    const variant = expectAllowed(
      evaluateX402ExecutionGate(
        allowedGateInput({ authorization: makeV1Authorization({ expiresAt: "2026-07-07T10:25:30.000Z" }) })
      )
    );
    expect(variant.authorizationId).not.toBe(base.authorizationId);
    expect(variant.expiresAt).toBe("2026-07-07T10:25:30.000Z");
  });
});

describe("v2 authorization safety shape", () => {
  test("serialized v2 runtime object has none of the signing/payment/settlement fields", () => {
    const v2 = expectAllowed(evaluateX402ExecutionGate(allowedGateInput()));
    const serialized = JSON.stringify(v2);

    expect(serialized).not.toMatch(
      /privateKey|signature|nonce|transaction|transactionHash|txHash|gatewayTransferId|settlementStatus|rpcUrl|broadcast|signedTransaction|rawTransaction|seedPhrase|payerKey/i
    );
    for (const forbidden of [
      "privateKey",
      "signature",
      "nonce",
      "transaction",
      "transactionHash",
      "txHash",
      "gatewayTransferId",
      "settlementStatus",
      "rpcUrl",
      "broadcast"
    ]) {
      expect(v2).not.toHaveProperty(forbidden);
    }
    expect(v2.executionStatus).toBe("not_executed");
    expect(v2.fundsMoved).toBe(false);
  });

  test("v2 is eligibility evidence with literal non-execution fields and the parent TTL", () => {
    const v1 = makeV1Authorization();
    const v2 = expectAllowed(evaluateX402ExecutionGate(allowedGateInput()));

    expect(v2.authorizationType).toBe("execution_authorization");
    expect(v2.version).toBe("v2");
    expect(v2.decision).toBe("ALLOW");
    expect(v2.parentAuthorizationId).toBe(v1.authorizationId);
    expect(v2.executionScope).toEqual(["prepare", "simulate"]);
    expect(v2.eligibility).toBe("eligible_for_external_signer_request");
    expect(v2.executionStatus).toBe("not_executed");
    expect(v2.fundsMoved).toBe(false);
    expect(v2.issuedAt).toBe(v1.issuedAt);
    expect(v2.expiresAt).toBe(v1.expiresAt);
    expect(v2.x402.assetDecimals).toBe(6);
    expect(v2.x402.assetSymbol).toBe("USDC");
    expect(v2.x402.assetTransferMethod).toBe("eip3009");
    expect(v2.x402.paymentFlow).toBe("authorization");
    expect(v2.x402.protocolVersion).toBe(2);
  });
});

describe("REVIEW/BLOCK regression: no v1, no gate path", () => {
  test("canonical REVIEW produces no v1 executionAuthorization (nothing can enter the gate)", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-review-machine.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as {
      decision: string;
      reasonCodes: string[];
      executionAuthorization?: unknown;
    };

    expect(expectedDecision).toBe("REVIEW");
    expect(body.decision).toBe("REVIEW");
    expect(body.reasonCodes).toContain("RECIPIENT_REVIEW_REQUIRED");
    expect(body).not.toHaveProperty("executionAuthorization");
  });

  test("canonical BLOCK produces no v1 executionAuthorization (nothing can enter the gate)", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-block-risky.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as {
      decision: string;
      reasonCodes: string[];
      executionAuthorization?: unknown;
    };

    expect(expectedDecision).toBe("BLOCK");
    expect(body.decision).toBe("BLOCK");
    expect(body.reasonCodes).toContain("RECIPIENT_BLOCKED");
    expect(body).not.toHaveProperty("executionAuthorization");
  });

  test("defense-in-depth: a v1 carrying a non-ALLOW decision (runtime cast) → X402_GATE_AUTHORIZATION_DECISION_NOT_ALLOWED, no v2", () => {
    const nonAllowV1 = { ...makeV1Authorization(), decision: "REVIEW" } as unknown as ExecutionAuthorization;
    const result = evaluateX402ExecutionGate(allowedGateInput({ authorization: nonAllowV1 }));
    expectRejected(result, ["X402_GATE_AUTHORIZATION_DECISION_NOT_ALLOWED"]);
  });
});

describe("policy behavior: decision rules unchanged under policy version 3", () => {
  test("canonical scenarios keep ALLOW/REVIEW/BLOCK with unchanged reason codes; only attribution changed", async () => {
    for (const fileName of ["scenario-allow-api.json", "scenario-review-machine.json", "scenario-block-risky.json"]) {
      const { expectedDecision, intent } = loadScenarioIntent(fileName);
      const decision = evaluatePolicy(intent, policy, []);
      expect(decision.decision).toBe(expectedDecision);
      expect(decision.policyVersion).toBe("3");
      expect(decision.policyFingerprint).toBe(fingerprintPolicy(policy));
    }

    const allow = evaluatePolicy(loadScenarioIntent("scenario-allow-api.json").intent, policy, []);
    const review = evaluatePolicy(loadScenarioIntent("scenario-review-machine.json").intent, policy, []);
    const block = evaluatePolicy(loadScenarioIntent("scenario-block-risky.json").intent, policy, []);

    expect(allow.reasonCodes).toEqual(
      expect.arrayContaining(["RAIL_PREVIEW_ONLY", "RECIPIENT_TRUSTED", "PURPOSE_ALLOWED", "AMOUNT_WITHIN_LIMIT"])
    );
    expect(review.reasonCodes).toContain("RECIPIENT_REVIEW_REQUIRED");
    expect(block.reasonCodes).toContain("RECIPIENT_BLOCKED");
  });

  test("the x402Execution section shapes policy identity but never decision rules", () => {
    expect(policy.policyVersion).toBe("3");
    expect(policy.x402Execution.allowedRequirements).toHaveLength(1);
    expect(policy.x402Execution.allowedRequirements[0]).toMatchObject({
      network: ARC_TESTNET_NETWORK,
      scheme: "exact",
      asset: ARC_USDC_ASSET,
      assetSymbol: "USDC",
      assetDecimals: 6,
      maxTimeoutSeconds: 604900,
      assetTransferMethod: "eip3009",
      paymentFlow: "authorization"
    });

    // A v2-shaped policy (no x402 execution allowlist) produces identical
    // decisions/reason codes — the section never feeds ALLOW/REVIEW/BLOCK.
    const v2Shaped: PolicyConfig = {
      ...policy,
      policyVersion: "2",
      x402Execution: { allowedRequirements: [] }
    };
    const intent = loadScenarioIntent("scenario-allow-api.json").intent;
    const v3Decision = evaluatePolicy(intent, policy, []);
    const v2Decision = evaluatePolicy(intent, v2Shaped, []);
    expect(v2Decision.decision).toBe(v3Decision.decision);
    expect(v2Decision.reasonCodes).toEqual(v3Decision.reasonCodes);
    expect(v2Decision.matchedRules).toEqual(v3Decision.matchedRules);

    // The section participates in the fingerprint (policy identity).
    const entry = policy.x402Execution.allowedRequirements[0];
    const changed = {
      ...policy,
      x402Execution: { allowedRequirements: [{ ...entry, maxTimeoutSeconds: 604901 }] }
    };
    expect(fingerprintPolicy(changed)).not.toBe(fingerprintPolicy(policy));
    const changedDecision = evaluatePolicy(intent, changed, []);
    expect(changedDecision.decision).toBe(v3Decision.decision);
    expect(changedDecision.reasonCodes).toEqual(v3Decision.reasonCodes);
  });
});
