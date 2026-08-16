import { describe, expect, test } from "vitest";
import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import {
  buildAuthorizedPaymentRequirementEvidence,
  buildPaymentRequirementEvidence
} from "@/domain/x402/payment-requirement-evidence";
import {
  fingerprintX402PaymentRequirement,
  validateX402PaymentRequirement,
  X402PaymentRequirementValidationError,
  x402NetworkChainId,
  type X402PaymentRequirement
} from "@/domain/x402/payment-requirement";

/**
 * Fixture per the officially verified feasibility sources (integration-feasibility.md):
 * - network "eip155:5042002" = Arc Testnet (S17 comment, S24)
 * - asset 0x3600000000000000000000000000000000000000 = Arc Testnet USDC (S20/S25)
 * - maxTimeoutSeconds 604900 = official Gateway value (S17)
 * - extra { name: "GatewayWalletBatched", version: "1", verifyingContract } = Gateway
 *   nanopayments EIP-712 domain (S17); verifyingContract = Arc Testnet GatewayWallet (S21/S25)
 * - payTo is a deterministic TEST-ONLY fixture address (0x1111...1111), not a real seller.
 * - amount "10000" = 0.01 USDC at 6 decimals (S17)
 * No private key, signature, or transaction hash anywhere in the fixture.
 */
function makeRequirement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scheme: "exact",
    network: "eip155:5042002",
    amount: "10000",
    asset: "0x3600000000000000000000000000000000000000",
    payTo: "0x1111111111111111111111111111111111111111",
    maxTimeoutSeconds: 604900,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
    },
    ...overrides
  };
}

const EXPECTED_NORMALIZED: X402PaymentRequirement = {
  scheme: "exact",
  network: "eip155:5042002",
  amount: "10000",
  asset: "0x3600000000000000000000000000000000000000",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 604900,
  extra: {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
  }
};

function withoutKeys(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...record };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

function makeAuthorization(overrides: Partial<ExecutionAuthorization> = {}): ExecutionAuthorization {  return {
    authorizationType: "execution_authorization",
    version: "v1",
    authorizationId: "auth_1111111111111111111111111111111111111111111111111111111111111111",
    scope: "single_intent",
    intentId: "intent_demo_001",
    idempotencyKey: "demo-auth-001",
    auditId: "audit_20260707_000001",
    agentId: "agent_auth_demo_001",
    recipient: "trusted-x402-api.demo",
    asset: "USDC",
    maxAmountUSDC: "0.01",
    paymentRail: "mock_x402_service",
    rail: "mock_x402_service",
    decision: "ALLOW",
    policyId: "default-agentpay-policy-v1",
    policyVersion: "2",
    policyFingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    issuedAt: "2026-07-07T10:15:30.000Z",
    expiresAt: "2026-07-07T10:20:30.000Z",
    executionScope: ["prepare", "simulate"],
    executionStatus: "not_executed",
    fundsMoved: false,
    ...overrides
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe("validateX402PaymentRequirement: valid contract", () => {
  test("validates the official Arc Testnet / Gateway exact-EVM fixture to the normalized typed object", () => {
    const validated = validateX402PaymentRequirement(makeRequirement());

    expect(validated).toEqual(EXPECTED_NORMALIZED);
    expect(validated.scheme).toBe("exact");
    expect(validated.network).toBe("eip155:5042002");
    expect(validated.amount).toBe("10000");
    expect(validated.maxTimeoutSeconds).toBe(604900);
    expect(validated.extra).toEqual({
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
    });
  });

  test("accepts explicit canonical reserved extra keys (assetTransferMethod eip3009, paymentFlow authorization)", () => {
    const validated = validateX402PaymentRequirement(
      makeRequirement({
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
          assetTransferMethod: "eip3009",
          paymentFlow: "authorization"
        }
      })
    );

    expect(validated.extra.assetTransferMethod).toBe("eip3009");
    expect(validated.extra.paymentFlow).toBe("authorization");
  });

  test("preserves address casing exactly (no checksumming, no case folding)", () => {
    const validated = validateX402PaymentRequirement(
      makeRequirement({ payTo: "0xAbCdef0123456789AbCdef0123456789AbCdef01" })
    );

    expect(validated.payTo).toBe("0xAbCdef0123456789AbCdef0123456789AbCdef01");
  });
});

describe("validateX402PaymentRequirement: format rejections", () => {
  test.each([null, undefined, "requirement", 42, true])("rejects non-object input %p", (input) => {
    expect(() => validateX402PaymentRequirement(input)).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test("rejects array input", () => {
    expect(() => validateX402PaymentRequirement([makeRequirement()])).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test("rejects a missing scheme", () => {
    expect(() => validateX402PaymentRequirement(withoutKeys(makeRequirement(), "scheme"))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test("rejects a scheme other than exact", () => {
    expect(() => validateX402PaymentRequirement(makeRequirement({ scheme: "upto" }))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test.each([
    "5042002",
    "arcTestnet",
    "eip155:",
    "eip155:0",
    "eip155:-1",
    "eip155:05042002",
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "eip155:not-a-number"
  ])("rejects invalid CAIP-2 network %p", (network) => {
    expect(() => validateX402PaymentRequirement(makeRequirement({ network }))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test.each([10000, "10000.5", "-10000", "1e4", "00010000", "0", " 10000", "10000 "])(
    "rejects non-canonical amount %p (string positive base-10 integer only)",
    (amount) => {
      expect(() => validateX402PaymentRequirement(makeRequirement({ amount }))).toThrow(
        X402PaymentRequirementValidationError
      );
    }
  );

  test.each([
    "0x123",
    "0x360000000000000000000000000000000000000",
    "0x36000000000000000000000000000000000000000",
    "0xgggg000000000000000000000000000000000000",
    "3600000000000000000000000000000000000000",
    ""
  ])("rejects invalid asset address %p", (asset) => {
    expect(() => validateX402PaymentRequirement(makeRequirement({ asset }))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test.each(["0x2222", "0x111111111111111111111111111111111111111", "0xzzz11111111111111111111111111111111111", null])(
    "rejects invalid payTo address %p",
    (payTo) => {
      expect(() => validateX402PaymentRequirement(makeRequirement({ payTo }))).toThrow(
        X402PaymentRequirementValidationError
      );
    }
  );

  test.each([604900.5, -1, 0, "604900", NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maxTimeoutSeconds %p (official schema type: positive number)",
    (maxTimeoutSeconds) => {
      expect(() => validateX402PaymentRequirement(makeRequirement({ maxTimeoutSeconds }))).toThrow(
        X402PaymentRequirementValidationError
      );
    }
  );

  test.each(["privateKey", "signature", "transactionHash", "to", "data", "execute", "rpcUrl"])(
    "rejects unknown top-level field %p (never silently dropped)",
    (field) => {
      expect(() => validateX402PaymentRequirement(makeRequirement({ [field]: "anything" }))).toThrow(
        X402PaymentRequirementValidationError
      );
    }
  );

  test("rejects unknown extra fields", () => {
    expect(() =>
      validateX402PaymentRequirement(
        makeRequirement({
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
            gatewayApiKey: "secret"
          }
        })
      )
    ).toThrow(X402PaymentRequirementValidationError);
  });

  test.each([null, "extra", 42, []])("rejects non-object extra %p", (extra) => {
    expect(() => validateX402PaymentRequirement(makeRequirement({ extra }))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test("rejects a missing extra (required for the Gateway exact-EVM path)", () => {
    expect(() => validateX402PaymentRequirement(withoutKeys(makeRequirement(), "extra"))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test.each([
    { name: "GatewayWalletBatched", version: "1" },
    { name: "GatewayWalletBatched", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
    { version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" }
  ])("rejects extra missing a required EIP-712 domain field %j", (extra) => {
    expect(() => validateX402PaymentRequirement(makeRequirement({ extra }))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test.each([
    { name: 42, version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
    { name: "GatewayWalletBatched", version: 1, verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
    { name: "", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" }
  ])("rejects malformed required extra values %j", (extra) => {
    expect(() => validateX402PaymentRequirement(makeRequirement({ extra }))).toThrow(
      X402PaymentRequirementValidationError
    );
  });

  test("rejects an invalid extra.verifyingContract", () => {
    expect(() =>
      validateX402PaymentRequirement(
        makeRequirement({
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: "0xnot-an-address"
          }
        })
      )
    ).toThrow(X402PaymentRequirementValidationError);
  });

  test.each(["permit2", "erc7710", "eip1559"])(
    "rejects unsupported extra.assetTransferMethod %p",
    (assetTransferMethod) => {
      expect(() =>
        validateX402PaymentRequirement(
          makeRequirement({
            extra: {
              name: "GatewayWalletBatched",
              version: "1",
              verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
              assetTransferMethod
            }
          })
        )
      ).toThrow(X402PaymentRequirementValidationError);
    }
  );

  test.each(["upfront", "escrow", "settle_first"])("rejects unsupported extra.paymentFlow %p", (paymentFlow) => {
    expect(() =>
      validateX402PaymentRequirement(
        makeRequirement({
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
            paymentFlow
          }
        })
      )
    ).toThrow(X402PaymentRequirementValidationError);
  });
});

describe("fingerprintX402PaymentRequirement: deterministic digest", () => {
  test("identical normalized requirements produce identical digests", () => {
    expect(fingerprintX402PaymentRequirement(validateX402PaymentRequirement(makeRequirement()))).toBe(
      fingerprintX402PaymentRequirement(validateX402PaymentRequirement(makeRequirement()))
    );
  });

  test("raw key insertion order does not change the digest", () => {
    const reordered = {
      extra: { version: "1", name: "GatewayWalletBatched", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
      maxTimeoutSeconds: 604900,
      payTo: "0x1111111111111111111111111111111111111111",
      asset: "0x3600000000000000000000000000000000000000",
      amount: "10000",
      network: "eip155:5042002",
      scheme: "exact"
    };

    expect(
      fingerprintX402PaymentRequirement(validateX402PaymentRequirement(reordered))
    ).toBe(
      fingerprintX402PaymentRequirement(validateX402PaymentRequirement(makeRequirement()))
    );
  });

  test("digest matches the repo sha256 format", () => {
    expect(fingerprintX402PaymentRequirement(validateX402PaymentRequirement(makeRequirement()))).toMatch(
      /^sha256:[0-9a-f]{64}$/
    );
  });

  test.each([
    { amount: "10001" },
    { payTo: "0x2222222222222222222222222222222222222222" },
    { asset: "0x3600000000000000000000000000000000000001" },
    { network: "eip155:84532" },
    { maxTimeoutSeconds: 604901 }
  ])("changing an authoritative field %j changes the digest", (override) => {
    const base = fingerprintX402PaymentRequirement(validateX402PaymentRequirement(makeRequirement()));
    const changed = fingerprintX402PaymentRequirement(
      validateX402PaymentRequirement(makeRequirement(override))
    );

    expect(changed).not.toBe(base);
  });

  test("changing each authoritative extra field changes the digest", () => {
    const base = fingerprintX402PaymentRequirement(validateX402PaymentRequirement(makeRequirement()));
    const cases: Array<Record<string, unknown>> = [
      {
        extra: {
          name: "GatewayWalletBatched2",
          version: "1",
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
        }
      },
      {
        extra: {
          name: "GatewayWalletBatched",
          version: "2",
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
        }
      },
      {
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B8"
        }
      },
      {
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
          assetTransferMethod: "eip3009"
        }
      },
      {
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
          paymentFlow: "authorization"
        }
      }
    ];

    for (const override of cases) {
      const changed = fingerprintX402PaymentRequirement(
        validateX402PaymentRequirement(makeRequirement(override))
      );
      expect(changed).not.toBe(base);
    }
  });

  test("injected unknown raw fields are rejected before any digesting (never silently excluded)", () => {
    expect(() =>
      validateX402PaymentRequirement(makeRequirement({ privateKey: "0xdeadbeef" }))
    ).toThrow(X402PaymentRequirementValidationError);
    expect(() =>
      validateX402PaymentRequirement(makeRequirement({ transactionHash: "0x1234" }))
    ).toThrow(X402PaymentRequirementValidationError);
  });
});

describe("payment requirement evidence", () => {
  test("exposes the exact authoritative field list and the requirement digest", () => {
    const requirement = validateX402PaymentRequirement(makeRequirement());
    const evidence = buildPaymentRequirementEvidence(requirement);

    expect(evidence).toEqual({
      evidenceType: "x402_payment_requirement",
      version: "v1",
      protocol: "x402",
      x402Version: 2,
      requirementDigest: fingerprintX402PaymentRequirement(requirement),
      scheme: "exact",
      network: "eip155:5042002",
      amountAtomic: "10000",
      asset: "0x3600000000000000000000000000000000000000",
      payTo: "0x1111111111111111111111111111111111111111",
      maxTimeoutSeconds: 604900
    });
  });

  test("contains no signature, private key, transaction hash, or settlement status", () => {
    const evidence = buildPaymentRequirementEvidence(validateX402PaymentRequirement(makeRequirement()));
    const serialized = JSON.stringify(evidence);

    expect(serialized).not.toMatch(/signature|privateKey|seedPhrase|transactionHash|txHash|settlementStatus/i);
    expect(evidence).not.toHaveProperty("signature");
    expect(evidence).not.toHaveProperty("privateKey");
    expect(evidence).not.toHaveProperty("transactionHash");
    expect(evidence).not.toHaveProperty("executionStatus");
  });

  test("is deterministic for the same requirement", () => {
    const requirement = validateX402PaymentRequirement(makeRequirement());
    expect(buildPaymentRequirementEvidence(requirement)).toEqual(
      buildPaymentRequirementEvidence(requirement)
    );
    expect(buildPaymentRequirementEvidence(requirement).requirementDigest).toBe(
      fingerprintX402PaymentRequirement(requirement)
    );
  });
});

describe("authorized payment requirement evidence (association only)", () => {
  test("derives auditId and authorizationId from the supplied authorization and requirementDigest from the payment evidence", () => {
    const authorization = makeAuthorization();
    const paymentEvidence = buildPaymentRequirementEvidence(
      validateX402PaymentRequirement(makeRequirement())
    );

    const association = buildAuthorizedPaymentRequirementEvidence(authorization, paymentEvidence);

    expect(association.auditId).toBe(authorization.auditId);
    expect(association.authorizationId).toBe(authorization.authorizationId);
    expect(association.requirementDigest).toBe(paymentEvidence.requirementDigest);
    expect(association).toEqual({
      evidenceType: "authorized_x402_payment_requirement",
      version: "v1",
      auditId: "audit_20260707_000001",
      authorizationId: authorization.authorizationId,
      requirementDigest: paymentEvidence.requirementDigest,
      executionStatus: "not_executed",
      fundsMoved: false
    });
  });

  test("executionStatus stays not_executed and fundsMoved stays false", () => {
    const association = buildAuthorizedPaymentRequirementEvidence(
      makeAuthorization(),
      buildPaymentRequirementEvidence(validateX402PaymentRequirement(makeRequirement()))
    );

    expect(association.executionStatus).toBe("not_executed");
    expect(association.fundsMoved).toBe(false);
  });

  test("does not mutate the supplied authorization object", () => {
    const authorization = deepFreeze(makeAuthorization());
    const before = JSON.stringify(authorization);
    const paymentEvidence = buildPaymentRequirementEvidence(
      validateX402PaymentRequirement(makeRequirement())
    );

    const association = buildAuthorizedPaymentRequirementEvidence(authorization, paymentEvidence);

    expect(JSON.stringify(authorization)).toBe(before);
    expect(authorization.executionStatus).toBe("not_executed");
    expect(authorization.fundsMoved).toBe(false);
    expect(association.auditId).toBe(authorization.auditId);
  });

  test("contains no execution-claiming or secret fields", () => {
    const association = buildAuthorizedPaymentRequirementEvidence(
      makeAuthorization(),
      buildPaymentRequirementEvidence(validateX402PaymentRequirement(makeRequirement()))
    );

    expect(JSON.stringify(association)).not.toMatch(
      /signature|privateKey|seedPhrase|transactionHash|txHash|settlementStatus|approved|ready|settled/i
    );
    expect(Object.keys(association).sort()).toEqual([
      "auditId",
      "authorizationId",
      "evidenceType",
      "executionStatus",
      "fundsMoved",
      "requirementDigest",
      "version"
    ]);
  });
});

describe("x402NetworkChainId helper", () => {
  test("extracts the numeric chain id from a validated network", () => {
    expect(x402NetworkChainId("eip155:5042002")).toBe("5042002");
    expect(x402NetworkChainId("eip155:84532")).toBe("84532");
  });

  test("rejects a non-eip155 input", () => {
    expect(() => x402NetworkChainId("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toThrow(
      X402PaymentRequirementValidationError
    );
  });
});
