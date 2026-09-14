/**
 * x402-settlement-evidence.test.ts
 *
 * I5.5 — SettlementEvidence strict-contract tests: literals, formats,
 * unknown-field rejection, every cross-field consistency rule from the
 * frozen design (confirmed/completed thresholds, accepted_pending gating,
 * failed = known rejection only, remote_outcome_unknown carries NO invented
 * Gateway fields, source/outcome implications), the UUID-vs-chain-hash
 * distinctness of gatewayTransferId/batchTxHash, and the stable fingerprint
 * (key-order-independent, change-sensitive, computed only over the strictly
 * validated normalized object).
 *
 * Conventions: no network, no Gateway data — deterministic TEST-ONLY
 * fixtures; typed values are fabricated locally with the official formats.
 */
import { describe, expect, test } from "vitest";
import {
  SETTLEMENT_EVIDENCE_OUTCOMES,
  SETTLEMENT_EVIDENCE_SOURCES,
  SETTLEMENT_EVIDENCE_TYPE,
  SETTLEMENT_EVIDENCE_VERSION,
  SettlementEvidenceError,
  buildSettlementEvidence,
  fingerprintSettlementEvidence,
  validateSettlementEvidence,
  type BuildSettlementEvidenceInput,
  type SettlementEvidence
} from "@/domain/x402/settlement-evidence";

const AUTH_A = `auth_${"a".repeat(64)}`;
const AUTH_PARENT = `auth_${"b".repeat(64)}`;
const NONCE = `0x${"e".repeat(64)}`;
const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const PAYER = "0x1111111111111111111111111111111111111111";
const PAYTO = "0x2222222222222222222222222222222222222222";
const TRANSFER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TRANSFER_ID_2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
/** Batch-level chain hash: 0x + 64 hex — deliberately NOT a UUID shape. */
const BATCH_TX_HASH = `0x${"f".repeat(64)}`;
const BATCH_TX_HASH_2 = `0x${"9".repeat(64)}`;
const RECORDED_AT = "2026-08-17T10:00:00.000Z";

function baseInput(
  overrides: Partial<BuildSettlementEvidenceInput> = {}
): BuildSettlementEvidenceInput {
  return {
    authorizationId: AUTH_A,
    parentAuthorizationId: AUTH_PARENT,
    auditId: "audit-test-0001",
    agentId: "agent-test-0001",
    paymentRequirementDigest: `sha256:${"c".repeat(64)}`,
    signerPayloadDigest: `sha256:${"d".repeat(64)}`,
    network: ARC_TESTNET_NETWORK,
    assetAddress: ARC_USDC_ASSET,
    payerAddress: PAYER,
    payTo: PAYTO,
    amountAtomic: "80000",
    nonce: NONCE,
    source: "settle_response",
    outcome: "accepted_pending",
    gatewayTransferId: TRANSFER_ID,
    gatewayTransferStatus: "received",
    gatewaySuccess: true,
    gatewayErrorReason: null,
    batchTxHash: null,
    recordedAt: RECORDED_AT,
    ...overrides
  };
}

function evidence(overrides: Partial<BuildSettlementEvidenceInput> = {}): SettlementEvidence {
  return buildSettlementEvidence(baseInput(overrides));
}

describe("contract literals and enums", () => {
  test("type/version literals and enum tables match the frozen contract", () => {
    expect(SETTLEMENT_EVIDENCE_TYPE).toBe("settlement_evidence");
    expect(SETTLEMENT_EVIDENCE_VERSION).toBe("v1");
    expect(SETTLEMENT_EVIDENCE_SOURCES).toEqual([
      "settle_response",
      "transfer_snapshot",
      "settle_transport"
    ]);
    expect(SETTLEMENT_EVIDENCE_OUTCOMES).toEqual([
      "remote_outcome_unknown",
      "accepted_pending",
      "confirmed",
      "completed",
      "failed"
    ]);
  });

  test("valid settle-response evidence round-trips normalized with fixed key order", () => {
    const validated = validateSettlementEvidence(evidence());
    expect(validated).toEqual(evidence());
    expect(Object.keys(validated)).toEqual([
      "evidenceType",
      "version",
      "authorizationId",
      "parentAuthorizationId",
      "auditId",
      "agentId",
      "paymentRequirementDigest",
      "signerPayloadDigest",
      "network",
      "assetAddress",
      "payerAddress",
      "payTo",
      "amountAtomic",
      "nonce",
      "source",
      "outcome",
      "gatewayTransferId",
      "gatewayTransferStatus",
      "gatewaySuccess",
      "gatewayErrorReason",
      "batchTxHash",
      "recordedAt"
    ]);
  });

  test("valid transfer-snapshot evidence (confirmed)", () => {
    const snapshot = evidence({
      source: "transfer_snapshot",
      outcome: "confirmed",
      gatewayTransferStatus: "confirmed",
      gatewaySuccess: null,
      batchTxHash: BATCH_TX_HASH
    });
    expect(validateSettlementEvidence(snapshot)).toEqual(snapshot);
  });

  test("valid transfer-snapshot evidence (completed — stronger terminal status)", () => {
    const snapshot = evidence({
      source: "transfer_snapshot",
      outcome: "completed",
      gatewayTransferStatus: "completed",
      gatewaySuccess: null,
      batchTxHash: BATCH_TX_HASH
    });
    expect(snapshot.outcome).toBe("completed");
  });

  test("valid unknown-transport evidence: all Gateway fields null", () => {
    const unknown = evidence({
      source: "settle_transport",
      outcome: "remote_outcome_unknown",
      gatewayTransferId: null,
      gatewayTransferStatus: null,
      gatewaySuccess: null,
      gatewayErrorReason: null,
      batchTxHash: null
    });
    expect(validateSettlementEvidence(unknown)).toEqual(unknown);
  });

  test("valid known-failure evidence (nonce_already_used)", () => {
    const failed = evidence({
      outcome: "failed",
      gatewayTransferId: null,
      gatewayTransferStatus: null,
      gatewaySuccess: false,
      gatewayErrorReason: "nonce_already_used",
      batchTxHash: null
    });
    expect(validateSettlementEvidence(failed)).toEqual(failed);
  });

  test("buildSettlementEvidence round-trips validateSettlementEvidence", () => {
    const built = evidence();
    expect(() =>
      buildSettlementEvidence(baseInput({ outcome: "confirmed" }))
    ).toThrow(SettlementEvidenceError);
    expect(validateSettlementEvidence(built)).toEqual(built);
  });
});

describe("contract strictness", () => {
  test("unknown-field rejection — including signature/payload fields", () => {
    const bad = { ...evidence(), signature: `0x${"a".repeat(130)}` };
    expect(() => validateSettlementEvidence(bad)).toThrow(SettlementEvidenceError);
    try {
      validateSettlementEvidence(bad);
    } catch (error) {
      expect(error).toBeInstanceOf(SettlementEvidenceError);
      expect((error as SettlementEvidenceError).code).toBe("SETTLEMENT_EVIDENCE_UNKNOWN_FIELD");
    }
    expect(() =>
      validateSettlementEvidence({ ...evidence(), paymentPayload: {} })
    ).toThrow(/unsupported field/);
  });

  test("missing fields are rejected (null is allowed only where nullable)", () => {
    const withoutNonce = { ...evidence() } as Record<string, unknown>;
    delete withoutNonce.nonce;
    expect(() => validateSettlementEvidence(withoutNonce)).toThrow(/"nonce"/);
    const gatewaySuccessUndefined = { ...evidence() } as Record<string, unknown>;
    delete gatewaySuccessUndefined.gatewaySuccess;
    expect(() => validateSettlementEvidence(gatewaySuccessUndefined)).toThrow(
      /"gatewaySuccess"/
    );
  });

  test("non-object inputs are rejected", () => {
    for (const input of [null, undefined, "evidence", 42, [], [{ ...evidence() }]]) {
      expect(() => validateSettlementEvidence(input)).toThrow(SettlementEvidenceError);
    }
  });

  test("wrong literals are rejected", () => {
    expect(() =>
      validateSettlementEvidence({ ...evidence(), evidenceType: "payment_evidence" })
    ).toThrow(/evidenceType/);
    expect(() =>
      validateSettlementEvidence({ ...evidence(), version: "v2" })
    ).toThrow(/version/);
  });

  test.each([
    ["authorizationId uppercase hex", "authorizationId", `auth_${"A".repeat(64)}`],
    ["authorizationId too short", "authorizationId", `auth_${"a".repeat(63)}`],
    ["parentAuthorizationId not auth-prefixed", "parentAuthorizationId", "0xabc"],
    ["paymentRequirementDigest no prefix", "paymentRequirementDigest", "c".repeat(64)],
    ["digest uppercase hex", "paymentRequirementDigest", `sha256:${"C".repeat(64)}`],
    ["signerPayloadDigest wrong length", "signerPayloadDigest", `sha256:${"d".repeat(63)}`],
    ["nonce without 0x", "nonce", "e".repeat(64)],
    ["nonce too short", "nonce", `0x${"e".repeat(63)}`],
    ["nonce uppercase hex", "nonce", `0x${"E".repeat(64)}`],
    ["network without eip155", "network", "5042002"],
    ["network chain id zero", "network", "eip155:0"],
    ["asset address too short", "assetAddress", "0x3600"],
    ["payer address no 0x", "payerAddress", "1".repeat(40)],
    ["payTo wrong length", "payTo", `0x${"2".repeat(39)}`],
    ["amount zero", "amountAtomic", "0"],
    ["amount leading zero", "amountAtomic", "080000"],
    ["amount negative", "amountAtomic", "-80000"],
    ["amount scientific", "amountAtomic", "8e4"],
    ["recordedAt not a timestamp", "recordedAt", "yesterday"],
    ["recordedAt empty", "recordedAt", ""],
    ["auditId empty", "auditId", ""],
    ["agentId empty", "agentId", ""],
    ["source not an enum member", "source", "manual_note"],
    ["outcome not an enum member", "outcome", "settled"],
    ["gatewayTransferStatus not official", "gatewayTransferStatus", "pending"],
    ["gatewayErrorReason not official", "gatewayErrorReason", "made_up_reason"],
    ["gatewaySuccess non-boolean", "gatewaySuccess", "false"],
    ["malformed transfer UUID", "gatewayTransferId", "550e8400-e29b-41d4-a716-44665544000"],
    ["transfer UUID with trailing text", "gatewayTransferId", `${TRANSFER_ID}x`],
    ["tx hash placed in gatewayTransferId", "gatewayTransferId", BATCH_TX_HASH],
    ["UUID placed in batchTxHash", "batchTxHash", TRANSFER_ID],
    ["batchTxHash too short", "batchTxHash", `0x${"f".repeat(63)}`],
    ["batchTxHash without 0x", "batchTxHash", "f".repeat(64)]
  ] as const)("rejects malformed field: %s", (_label, field, value) => {
    expect(() => validateSettlementEvidence({ ...evidence(), [field]: value })).toThrow(
      SettlementEvidenceError
    );
  });

  test("gatewayTransferId and batchTxHash accept DISTINCT formats only", () => {
    const both = evidence({
      source: "transfer_snapshot",
      outcome: "confirmed",
      gatewayTransferStatus: "confirmed",
      gatewaySuccess: null,
      batchTxHash: BATCH_TX_HASH
    });
    expect(both.gatewayTransferId).toBe(TRANSFER_ID);
    expect(both.batchTxHash).toBe(BATCH_TX_HASH);
    expect(both.gatewayTransferId).not.toBe(both.batchTxHash);
    // a chain hash is never accepted as a transfer id and vice versa
    expect(() =>
      validateSettlementEvidence({ ...both, gatewayTransferId: BATCH_TX_HASH })
    ).toThrow(/gatewayTransferId/);
    expect(() =>
      validateSettlementEvidence({ ...both, batchTxHash: TRANSFER_ID })
    ).toThrow(/batchTxHash/);
  });
});

describe("cross-field consistency (fail closed)", () => {
  function expectConsistencyFailure(mutated: Record<string, unknown>) {
    try {
      validateSettlementEvidence({ ...evidence(), ...mutated });
      expect.unreachable("expected SettlementEvidenceError");
    } catch (error) {
      expect(error).toBeInstanceOf(SettlementEvidenceError);
      expect((error as SettlementEvidenceError).code).toBe(
        "SETTLEMENT_EVIDENCE_CONSISTENCY_FAILED"
      );
    }
  }

  test("confirmed outcome requires official status confirmed", () => {
    expectConsistencyFailure({ outcome: "confirmed" }); // status received
    expectConsistencyFailure({
      outcome: "confirmed",
      source: "transfer_snapshot",
      gatewayTransferStatus: "batched"
    });
    expect(() =>
      validateSettlementEvidence(
        evidence({
          source: "transfer_snapshot",
          outcome: "confirmed",
          gatewayTransferStatus: "confirmed",
          gatewaySuccess: null
        })
      )
    ).not.toThrow();
  });

  test("completed outcome requires official status completed", () => {
    expectConsistencyFailure({ outcome: "completed", gatewayTransferStatus: "received" });
    expectConsistencyFailure({ outcome: "completed", gatewayTransferStatus: "confirmed" });
    expect(() =>
      validateSettlementEvidence(
        evidence({
          source: "transfer_snapshot",
          outcome: "completed",
          gatewayTransferStatus: "completed",
          gatewaySuccess: null
        })
      )
    ).not.toThrow();
  });

  test("accepted_pending requires status received or batched only", () => {
    expectConsistencyFailure({ gatewayTransferStatus: "confirmed" }); // outcome stays accepted_pending
    expectConsistencyFailure({ gatewayTransferStatus: "completed" });
    expectConsistencyFailure({ gatewayTransferStatus: "failed" });
    expect(() =>
      validateSettlementEvidence(evidence({ gatewayTransferStatus: "batched" }))
    ).not.toThrow();
    expect(() =>
      validateSettlementEvidence(evidence({ gatewayTransferStatus: "received" }))
    ).not.toThrow();
  });

  test("failed requires a known rejection: errorReason OR success:false OR status failed", () => {
    expectConsistencyFailure({
      outcome: "failed",
      gatewaySuccess: true,
      gatewayErrorReason: null,
      gatewayTransferStatus: "received"
    });
    expectConsistencyFailure({
      outcome: "failed",
      gatewaySuccess: null,
      gatewayErrorReason: null,
      gatewayTransferStatus: null
    });
    expect(() =>
      validateSettlementEvidence(
        evidence({
          outcome: "failed",
          gatewaySuccess: false,
          gatewayErrorReason: null,
          gatewayTransferStatus: null
        })
      )
    ).not.toThrow(); // known-deterministic settle success:false
    expect(() =>
      validateSettlementEvidence(
        evidence({
          outcome: "failed",
          gatewaySuccess: true,
          gatewayErrorReason: "nonce_already_used",
          gatewayTransferStatus: null
        })
      )
    ).not.toThrow(); // errorReason alone is a known rejection
    expect(() =>
      validateSettlementEvidence(
        evidence({
          outcome: "failed",
          gatewaySuccess: null,
          gatewayErrorReason: null,
          gatewayTransferStatus: "failed"
        })
      )
    ).not.toThrow(); // official failed status
  });

  test("remote_outcome_unknown carries NO invented Gateway fields", () => {
    const validUnknown = evidence({
      source: "settle_transport",
      outcome: "remote_outcome_unknown",
      gatewayTransferId: null,
      gatewayTransferStatus: null,
      gatewaySuccess: null,
      gatewayErrorReason: null,
      batchTxHash: null
    });
    expect(() => validateSettlementEvidence(validUnknown)).not.toThrow();
    // the canonical fabrication: never invent success:false
    expect(() =>
      validateSettlementEvidence({ ...validUnknown, gatewaySuccess: false })
    ).toThrow(SettlementEvidenceError);
    for (const field of [
      "gatewayTransferId",
      "gatewayTransferStatus",
      "gatewayErrorReason",
      "batchTxHash"
    ] as const) {
      const invented: Record<string, unknown> = { ...validUnknown };
      invented[field] =
        field === "gatewayTransferId"
          ? TRANSFER_ID
          : field === "gatewayTransferStatus"
            ? "received"
            : field === "gatewayErrorReason"
              ? "unexpected_error"
              : BATCH_TX_HASH;
      expect(() => validateSettlementEvidence(invented)).toThrow(/remote_outcome_unknown/);
    }
  });

  test("settle_transport source requires remote_outcome_unknown", () => {
    // outcome itself is legal here (accepted_pending + received); only the
    // source/outcome implication may reject it.
    expect(() =>
      validateSettlementEvidence(evidence({ source: "settle_transport" }))
    ).toThrow(/settle_transport/);
  });

  test("transfer_snapshot requires non-null status AND non-null transfer id", () => {
    // outcome "failed" tolerates a null status, so the source rule fires:
    expect(() =>
      validateSettlementEvidence(
        evidence({
          source: "transfer_snapshot",
          outcome: "failed",
          gatewaySuccess: false,
          gatewayErrorReason: null,
          gatewayTransferStatus: null
        })
      )
    ).toThrow(/transfer_snapshot/);
    expect(() =>
      validateSettlementEvidence(
        evidence({
          source: "transfer_snapshot",
          gatewayTransferId: null
        })
      )
    ).toThrow(/transfer_snapshot/);
  });

});

describe("fingerprintSettlementEvidence", () => {
  test("same normalized evidence → same digest; raw key order is irrelevant", () => {
    const canonical = evidence();
    const reordered = (() => {
      // build the same object with a completely different key insertion order
      const entries = Object.entries(canonical).reverse();
      const raw: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        raw[key] = value;
      }
      return raw;
    })();
    expect(fingerprintSettlementEvidence(reordered as unknown as SettlementEvidence)).toBe(
      fingerprintSettlementEvidence(canonical)
    );
  });

  test("digest matches the sha256:<64 lowercase hex> shape", () => {
    expect(fingerprintSettlementEvidence(evidence())).toMatch(
      /^sha256:[0-9a-f]{64}$/
    );
  });

  test.each([
    ["authorizationId", "authorizationId", `auth_${"1".repeat(64)}`],
    ["nonce", "nonce", `0x${"2".repeat(64)}`],
    ["amountAtomic", "amountAtomic", "80001"],
    ["gatewayTransferId", "gatewayTransferId", TRANSFER_ID_2],
    ["batchTxHash", "batchTxHash", BATCH_TX_HASH],
    ["recordedAt", "recordedAt", "2026-08-17T10:00:01.000Z"]
  ] as const)("changing %s changes the digest", (_label, field, value) => {
    const original = evidence();
    const changed = evidence({ [field]: value } as Partial<BuildSettlementEvidenceInput>);
    expect(fingerprintSettlementEvidence(changed)).not.toBe(
      fingerprintSettlementEvidence(original)
    );
  });

  test("changing gatewayTransferStatus changes the digest", () => {
    const received = evidence({ gatewayTransferStatus: "received" });
    const batched = evidence({ gatewayTransferStatus: "batched" });
    expect(fingerprintSettlementEvidence(batched)).not.toBe(
      fingerprintSettlementEvidence(received)
    );
  });

  test("distinct batchTxHash values digest distinctly from each other and from gatewayTransferId", () => {
    // Batch-level chain hash is its own carried field: swapping one official
    // tx hash for another changes the evidence identity...
    const batched = evidence({
      outcome: "accepted_pending",
      gatewayTransferStatus: "batched",
      batchTxHash: BATCH_TX_HASH
    });
    const rebatched = evidence({
      outcome: "accepted_pending",
      gatewayTransferStatus: "batched",
      batchTxHash: BATCH_TX_HASH_2
    });
    expect(fingerprintSettlementEvidence(rebatched)).not.toBe(
      fingerprintSettlementEvidence(batched)
    );
    // ...and it cannot be confused with the transfer UUID field: the same
    // evidence with the hash moved to gatewayTransferId is not even legal
    // evidence (a tx hash is never a UUID), so the two fields can never
    // collide in a digest.
    expect(() =>
      evidence({ batchTxHash: null, gatewayTransferId: BATCH_TX_HASH })
    ).toThrow(SettlementEvidenceError);
  });

  test("changing outcome changes the digest (paired with a legal status)", () => {
    // a lone outcome flip cannot satisfy the consistency rules, so change
    // the interpretation together with the status it requires: both
    // snapshots are legal evidence with different meanings.
    const rejected = evidence({
      outcome: "failed",
      gatewayTransferStatus: "received",
      gatewaySuccess: false,
      gatewayErrorReason: "insufficient_balance"
    });
    const pending = evidence({
      outcome: "accepted_pending",
      gatewayTransferStatus: "received",
      gatewaySuccess: false,
      gatewayErrorReason: "insufficient_balance"
    });
    expect(fingerprintSettlementEvidence(rejected)).not.toBe(
      fingerprintSettlementEvidence(pending)
    );
  });

  test("digest is taken over the strictly validated object only", () => {
    expect(() =>
      fingerprintSettlementEvidence({
        ...evidence(),
        signature: "0xdeadbeef"
      } as unknown as SettlementEvidence)
    ).toThrow(SettlementEvidenceError);
    expect(() =>
      fingerprintSettlementEvidence({
        ...evidence(),
        outcome: "confirmed"
      } as unknown as SettlementEvidence)
    ).toThrow(/consistency|confirmed/i);
  });
});
