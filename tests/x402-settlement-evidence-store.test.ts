/**
 * x402-settlement-evidence-store.test.ts
 *
 * I5.6 — durable SettlementEvidence store tests: immutable, write-exclusive
 * lifecycle snapshots keyed by authorizationId, indexed by EIP-3009 nonce and
 * Gateway transfer UUID. No signer, no payment, no Gateway call, no network.
 *
 * Conventions (matching the repo suite): temp store paths ONLY
 * (mkdtempSync — never data/settlement-evidence/); no mocks of the store, no
 * fake wallets/signatures; deterministic TEST-ONLY addresses; explicit
 * recordedAt timestamps — no sleeps, no machine-clock dependence.
 *
 * Race proof strategy: the sequence-conflict case uses Promise.all over two
 * appends with the SAME base linkage but DIFFERENT content. This is
 * deterministic by the event-loop model, not by OS timing: both calls suspend
 * at their first readdir (inside the read-only precheck) long before either
 * `open(path, "wx")` is issued, so both observe the same pre-state and
 * exactly one wins the atomic exclusive create at sequence 2. Which of the two
 * identities wins is scheduler-dependent; the REASON CODES and file counts
 * are not. (A purely out-of-band pre-creation of the next sequence file
 * cannot reach this branch: loadSnapshots would count it and the append would
 * target the sequence AFTER it instead — see the gap tests for that path.)
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildSettlementEvidence,
  fingerprintSettlementEvidence,
  SettlementEvidenceError,
  type BuildSettlementEvidenceInput,
  type SettlementEvidence
} from "@/domain/x402/settlement-evidence";
import {
  X402_SETTLEMENT_EVIDENCE_APPENDED,
  X402_SETTLEMENT_EVIDENCE_CONFLICT,
  X402_SETTLEMENT_EVIDENCE_EQUIVALENT,
  X402_SETTLEMENT_EVIDENCE_SEQUENCE_CONFLICT,
  X402SettlementEvidenceStoreError,
  appendSettlementEvidence,
  findSettlementEvidenceByNonce,
  findSettlementEvidenceByTransferId,
  latestSettlementEvidence,
  listSettlementEvidenceAuthorizations,
  readSettlementEvidence
} from "@/domain/x402/settlement-evidence-store";

// ---------------------------------------------------------------------------
// Fixtures (same TEST-ONLY values as tests/x402-settlement-evidence.test.ts).
// ---------------------------------------------------------------------------

const AUTH_A = `auth_${"a".repeat(64)}`;
const AUTH_B = `auth_${"c".repeat(64)}`;
const AUTH_PARENT = `auth_${"b".repeat(64)}`;
const NONCE = `0x${"e".repeat(64)}`;
const NONCE_B = `0x${"d".repeat(64)}`;
const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const PAYER = "0x1111111111111111111111111111111111111111";
const PAYTO = "0x2222222222222222222222222222222222222222";
const TRANSFER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TRANSFER_ID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const BATCH_TX_HASH = `0x${"f".repeat(64)}`;

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
    recordedAt: "2026-08-17T10:00:00.000Z",
    ...overrides
  };
}

function evidence(overrides: Partial<BuildSettlementEvidenceInput> = {}): SettlementEvidence {
  return buildSettlementEvidence(baseInput(overrides));
}

/** Lifecycle snapshot 1: settle response accepted, transfer "received". */
function snapReceived(): SettlementEvidence {
  return evidence();
}
/** Lifecycle snapshot 2: official snapshot shows transfer "batched". */
function snapBatched(
  overrides: Partial<BuildSettlementEvidenceInput> = {}
): SettlementEvidence {
  return evidence({
    source: "transfer_snapshot",
    gatewayTransferStatus: "batched",
    batchTxHash: BATCH_TX_HASH,
    recordedAt: "2026-08-17T10:01:00.000Z",
    ...overrides
  });
}
/** Lifecycle snapshot 3: official "confirmed" status. */
function snapConfirmed(): SettlementEvidence {
  return evidence({
    source: "transfer_snapshot",
    outcome: "confirmed",
    gatewayTransferStatus: "confirmed",
    gatewaySuccess: true,
    batchTxHash: BATCH_TX_HASH,
    recordedAt: "2026-08-17T10:02:00.000Z"
  });
}

// ---------------------------------------------------------------------------
// Temp-dir plumbing + helpers.
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-evidence-store-"));
  tempDirs.push(dir);
  return join(dir, "settlement-evidence");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function snapshotFiles(storePath: string, authorizationId: string): string[] {
  const dir = join(storePath, "authorizations", authorizationId);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).sort();
}

/** Every file path under the store root (recursive). */
function allFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...allFiles(path));
    } else if (entry.isFile()) {
      out.push(path);
    }
  }
  return out;
}

function append(storePath: string, ev: SettlementEvidence) {
  return appendSettlementEvidence({ storePath, evidence: ev });
}

// ---------------------------------------------------------------------------

describe("append — first immutable write + restart durability", () => {
  test("first snapshot → APPENDED with sha256 digest, sequence 1, exact layout", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    const result = await append(storePath, received);

    expect(result).toEqual({
      appended: true,
      reasonCode: X402_SETTLEMENT_EVIDENCE_APPENDED,
      evidenceDigest: fingerprintSettlementEvidence(received),
      sequence: 1
    });
    expect(result.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    // exact layout: <root>/authorizations/auth_<64hex>/0001.json +
    // <root>/nonces/0x<64hex>.json + <root>/transfers/<uuid>.json
    expect(existsSync(join(storePath, "authorizations", AUTH_A, "0001.json"))).toBe(true);
    expect(existsSync(join(storePath, "nonces", `${NONCE}.json`))).toBe(true);
    expect(existsSync(join(storePath, "transfers", `${TRANSFER_ID}.json`))).toBe(true);
    // the snapshot body round-trips to exactly the validated evidence
    const body = JSON.parse(readFileSync(join(storePath, "authorizations", AUTH_A, "0001.json"), "utf8"));
    expect(body).toEqual(received);
  });

  test("restart read (fresh call, same temp dir) returns the same snapshot", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    await append(storePath, received);

    const loaded = await readSettlementEvidence(storePath, AUTH_A);
    expect(loaded.kind).toBe("snapshots");
    if (loaded.kind !== "snapshots") return;
    expect(loaded.snapshots).toHaveLength(1);
    expect(loaded.snapshots[0]).toEqual(received);
    expect(fingerprintSettlementEvidence(loaded.snapshots[0])).toBe(
      fingerprintSettlementEvidence(received)
    );

    const latest = await latestSettlementEvidence(storePath, AUTH_A);
    expect(latest).toEqual(received);
  });

  test("missing store: missing / null / null / [] and malformed ids never build a path", async () => {
    const storePath = makeTempStorePath(); // directory does not exist
    expect(await readSettlementEvidence(storePath, AUTH_A)).toEqual({ kind: "missing" });
    expect(await latestSettlementEvidence(storePath, AUTH_A)).toBeNull();
    expect(await findSettlementEvidenceByNonce(storePath, NONCE)).toBeNull();
    expect(await findSettlementEvidenceByTransferId(storePath, TRANSFER_ID)).toBeNull();
    expect(await listSettlementEvidenceAuthorizations(storePath)).toEqual([]);

    // malformed keys → treated as missing (no throw, no path construction)
    expect(await readSettlementEvidence(storePath, "../../etc/passwd")).toEqual({
      kind: "missing"
    });
    expect(await findSettlementEvidenceByNonce(storePath, "0xdeadbeef")).toBeNull();
    // a tx hash is never a transfer UUID → null, no path built
    expect(await findSettlementEvidenceByTransferId(storePath, BATCH_TX_HASH)).toBeNull();
    expect(existsSync(storePath)).toBe(false);
  });

  test("contract-invalid candidate throws SettlementEvidenceError and writes nothing", async () => {
    const storePath = makeTempStorePath();
    const polluted = { ...snapReceived(), signature: "0x" + "ab".repeat(65) } as unknown as SettlementEvidence;
    await expect(append(storePath, polluted)).rejects.toThrow(SettlementEvidenceError);
    expect(allFiles(storePath)).toEqual([]);
  });
});

describe("append — immutable lifecycle (received → batched → confirmed)", () => {
  test("all three snapshots remain present in sequence order; nothing overwrites; latest = last", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    const batched = snapBatched();
    const confirmed = snapConfirmed();

    const r1 = await append(storePath, received);
    expect(r1).toMatchObject({ appended: true, reasonCode: X402_SETTLEMENT_EVIDENCE_APPENDED, sequence: 1 });
    const file0001 = join(storePath, "authorizations", AUTH_A, "0001.json");
    const file0001Bytes = readFileSync(file0001, "utf8");

    const r2 = await append(storePath, batched);
    expect(r2).toMatchObject({ appended: true, reasonCode: X402_SETTLEMENT_EVIDENCE_APPENDED, sequence: 2 });
    expect(r2.evidenceDigest).toBe(fingerprintSettlementEvidence(batched));

    const r3 = await append(storePath, confirmed);
    expect(r3).toMatchObject({ appended: true, reasonCode: X402_SETTLEMENT_EVIDENCE_APPENDED, sequence: 3 });

    expect(snapshotFiles(storePath, AUTH_A)).toEqual(["0001.json", "0002.json", "0003.json"]);
    // the earlier snapshot was NOT rewritten by the later appends
    expect(readFileSync(file0001, "utf8")).toBe(file0001Bytes);

    const loaded = await readSettlementEvidence(storePath, AUTH_A);
    expect(loaded.kind).toBe("snapshots");
    if (loaded.kind !== "snapshots") return;
    expect(loaded.snapshots.map((s) => s.outcome)).toEqual([
      "accepted_pending",
      "accepted_pending",
      "confirmed"
    ]);
    expect(loaded.snapshots.map((s) => s.gatewayTransferStatus)).toEqual([
      "received",
      "batched",
      "confirmed"
    ]);
    expect(loaded.snapshots[0]).toEqual(received);
    expect(loaded.snapshots[1]).toEqual(batched);
    expect(loaded.snapshots[2]).toEqual(confirmed);

    expect(await latestSettlementEvidence(storePath, AUTH_A)).toEqual(confirmed);
  });

  test("nonce index keeps FIRST-reference semantics across the lifecycle", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    await append(storePath, snapBatched());
    const ref = await findSettlementEvidenceByNonce(storePath, NONCE);
    expect(ref).not.toBeNull();
    expect(ref).toMatchObject({ authorizationId: AUTH_A, sequence: 1 });
  });
});

describe("append — replay, conflicts, races (nothing extra written)", () => {
  test("byte-identical re-append → EQUIVALENT with the same digest/sequence; no new file", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    await append(storePath, received);
    await append(storePath, snapBatched());
    await append(storePath, snapConfirmed());
    const filesBefore = snapshotFiles(storePath, AUTH_A);

    const replay = await append(storePath, received);
    expect(replay).toEqual({
      appended: false,
      reasonCode: X402_SETTLEMENT_EVIDENCE_EQUIVALENT,
      evidenceDigest: fingerprintSettlementEvidence(received),
      sequence: 1
    });
    expect(snapshotFiles(storePath, AUTH_A)).toEqual(filesBefore);
    expect(filesBefore).toHaveLength(3);
  });

  test("same sequence, DIFFERENT content raced via event-loop interleave → one APPENDED, one SEQUENCE_CONFLICT, no clobber", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    await append(storePath, received);
    // Two appends sharing the base linkage but with different digests both
    // observe [0001] in their read-only precheck (they suspend at readdir
    // before either exclusive create is issued), then race for 0002.json.
    const batched = snapBatched();
    const confirmed = snapConfirmed();

    const [first, second] = await Promise.all([append(storePath, batched), append(storePath, confirmed)]);
    const applied = [first, second].filter((r) => r.appended === true);
    const rejected = [first, second].filter((r) => r.appended === false);
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(applied[0].reasonCode).toBe(X402_SETTLEMENT_EVIDENCE_APPENDED);
    expect(applied[0].sequence).toBe(2);

    // The loser resolves deterministically: the winner's file is a DIFFERENT
    // digest → SEQUENCE_CONFLICT with null digest/sequence.
    expect(rejected[0]).toEqual({
      appended: false,
      reasonCode: X402_SETTLEMENT_EVIDENCE_SEQUENCE_CONFLICT,
      evidenceDigest: null,
      sequence: null
    });

    // nothing extra written, and the winner's file is the durable truth
    expect(snapshotFiles(storePath, AUTH_A)).toEqual(["0001.json", "0002.json"]);
    const loaded = await readSettlementEvidence(storePath, AUTH_A);
    expect(loaded.kind).toBe("snapshots");
    if (loaded.kind !== "snapshots") return;
    expect(fingerprintSettlementEvidence(loaded.snapshots[1])).toBe(applied[0].evidenceDigest);
  });

  test("same race, IDENTICAL content → loser replays as EQUIVALENT with winner's sequence", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    const batched = snapBatched();
    const [first, second] = await Promise.all([append(storePath, batched), append(storePath, batched)]);
    const applied = [first, second].filter((r) => r.appended === true);
    const rejected = [first, second].filter((r) => r.appended === false);
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual({
      appended: false,
      reasonCode: X402_SETTLEMENT_EVIDENCE_EQUIVALENT,
      evidenceDigest: fingerprintSettlementEvidence(batched),
      sequence: 2
    });
    expect(snapshotFiles(storePath, AUTH_A)).toEqual(["0001.json", "0002.json"]);
  });

  test("changed base linkage on a later snapshot → CONFLICT with first snapshot's digest; nothing written", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    await append(storePath, received);
    const tamperedAmount = snapBatched({ amountAtomic: "80001" });

    const conflict = await append(storePath, tamperedAmount);
    expect(conflict).toEqual({
      appended: false,
      reasonCode: X402_SETTLEMENT_EVIDENCE_CONFLICT,
      evidenceDigest: fingerprintSettlementEvidence(received),
      sequence: 1
    });
    expect(snapshotFiles(storePath, AUTH_A)).toEqual(["0001.json"]);
  });

  test("nonce owned by another authorization → CONFLICT, fail closed BEFORE any snapshot byte", async () => {
    const storePath = makeTempStorePath();
    const a = snapReceived();
    await append(storePath, a);

    // AUTH_B trying to record evidence for the SAME nonce fails closed.
    const hijack = evidence({ authorizationId: AUTH_B });
    const conflict = await append(storePath, hijack);
    expect(conflict).toEqual({
      appended: false,
      reasonCode: X402_SETTLEMENT_EVIDENCE_CONFLICT,
      evidenceDigest: fingerprintSettlementEvidence(a),
      sequence: 1
    });
    // AUTH_B got no history at all; the index still points at AUTH_A
    expect(existsSync(join(storePath, "authorizations", AUTH_B))).toBe(false);
    const ref = await findSettlementEvidenceByNonce(storePath, NONCE);
    expect(ref).toMatchObject({ authorizationId: AUTH_A, sequence: 1 });
  });
});

describe("indexes — creation, resolution, absent keys", () => {
  test("transfer index resolvable; absent-but-valid nonce/transfer → null", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    const result = await append(storePath, received);
    expect(result.appended).toBe(true);

    expect(await findSettlementEvidenceByTransferId(storePath, TRANSFER_ID)).toEqual({
      authorizationId: AUTH_A,
      sequence: 1,
      evidenceDigest: fingerprintSettlementEvidence(received)
    });
    // valid format, never written → null
    expect(await findSettlementEvidenceByNonce(storePath, NONCE_B)).toBeNull();
    expect(await findSettlementEvidenceByTransferId(storePath, TRANSFER_ID_B)).toBeNull();
  });

  test("no transfer index when gatewayTransferId is null (remote_outcome_unknown)", async () => {
    const storePath = makeTempStorePath();
    const unknown = evidence({
      source: "settle_transport",
      outcome: "remote_outcome_unknown",
      gatewayTransferId: null,
      gatewayTransferStatus: null,
      gatewaySuccess: null,
      gatewayErrorReason: null,
      batchTxHash: null
    });
    const result = await append(storePath, unknown);
    expect(result.appended).toBe(true);
    expect(existsSync(join(storePath, "nonces", `${NONCE}.json`))).toBe(true);
    expect(existsSync(join(storePath, "transfers"))).toBe(false);
  });

  test("index record carries only non-secret pointer fields (no signature/payload material)", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    await append(storePath, received);
    const index = JSON.parse(readFileSync(join(storePath, "nonces", `${NONCE}.json`), "utf8"));
    expect(index).toEqual({
      evidenceType: "x402_settlement_evidence_index",
      version: "v1",
      kind: "nonce",
      nonce: NONCE,
      transferId: null,
      authorizationId: AUTH_A,
      sequence: 1,
      evidenceDigest: fingerprintSettlementEvidence(received),
      outcome: "accepted_pending",
      recordedAt: "2026-08-17T10:00:00.000Z"
    });
  });
});

describe("listSettlementEvidenceAuthorizations", () => {
  test("returns sorted ids; [] for a missing store", async () => {
    const storePath = makeTempStorePath();
    expect(await listSettlementEvidenceAuthorizations(storePath)).toEqual([]);

    await append(storePath, snapReceived());
    await append(storePath, evidence({ authorizationId: AUTH_B, nonce: NONCE_B, gatewayTransferId: TRANSFER_ID_B }));
    expect(await listSettlementEvidenceAuthorizations(storePath)).toEqual([AUTH_A, AUTH_B]);
  });

  test("unexpected foreign entry → typed error, fail closed, entry untouched, no repair", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    mkdirSync(join(storePath, "authorizations"), { recursive: true });
    const stray = join(storePath, "authorizations", "README.txt");
    writeFileSync(stray, "do not delete me\n");

    await expect(listSettlementEvidenceAuthorizations(storePath)).rejects.toThrow(
      X402SettlementEvidenceStoreError
    );
    // the offending file is untouched — no repair, no removal — and the
    // directory listing still shows both the stray and the real history
    expect(readFileSync(stray, "utf8")).toBe("do not delete me\n");
    expect(readdirSync(join(storePath, "authorizations")).sort()).toEqual([
      "README.txt",
      AUTH_A
    ]);
  });
});

describe("corruption — fail closed, never auto-repaired", () => {
  test("garbage JSON in a snapshot file → reads throw; file untouched", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    const file = join(storePath, "authorizations", AUTH_A, "0001.json");
    writeFileSync(file, "{not json!!\n");

    await expect(readSettlementEvidence(storePath, AUTH_A)).rejects.toThrow(
      X402SettlementEvidenceStoreError
    );
    expect(readFileSync(file, "utf8")).toBe("{not json!!\n");
    // append also refuses to touch a corrupt history
    await expect(append(storePath, snapBatched())).rejects.toThrow(
      X402SettlementEvidenceStoreError
    );
    expect(readFileSync(file, "utf8")).toBe("{not json!!\n");
  });

  test("sequence gap (0001 + 0003) → typed error, no repair", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    const dir = join(storePath, "authorizations", AUTH_A);
    const gapped = join(dir, "0003.json");
    writeFileSync(gapped, `${JSON.stringify(snapBatched())}\n`);

    await expect(readSettlementEvidence(storePath, AUTH_A)).rejects.toThrow(
      /sequence gap|0003/
    );
    expect(snapshotFiles(storePath, AUTH_A)).toEqual(["0001.json", "0003.json"]);
  });

  test("snapshot whose authorizationId does not match its directory → typed error", async () => {
    const storePath = makeTempStorePath();
    const dir = join(storePath, "authorizations", AUTH_A);
    mkdirSync(dir, { recursive: true });
    // legal contract object, WRONG directory
    const misplaced = evidence({ authorizationId: AUTH_B });
    const file = join(dir, "0001.json");
    writeFileSync(file, `${JSON.stringify(misplaced)}\n`);

    await expect(readSettlementEvidence(storePath, AUTH_A)).rejects.toThrow(
      /does not match its directory/
    );
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(misplaced)}\n`);
  });

  test("snapshot with an extra unknown field → typed error (no field is silently dropped)", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    const file = join(storePath, "authorizations", AUTH_A, "0001.json");
    const original = JSON.parse(readFileSync(file, "utf8"));
    const polluted = { ...original, signerSignature: "0x" + "cd".repeat(65) };
    writeFileSync(file, `${JSON.stringify(polluted)}\n`);

    await expect(readSettlementEvidence(storePath, AUTH_A)).rejects.toThrow(
      X402SettlementEvidenceStoreError
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(polluted);
  });

  test("unexpected file inside an authorization directory → typed error", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    const dir = join(storePath, "authorizations", AUTH_A);
    writeFileSync(join(dir, "notes.txt"), "scratch\n");
    await expect(latestSettlementEvidence(storePath, AUTH_A)).rejects.toThrow(
      /unexpected file/
    );
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });

  test("index pointing at a missing snapshot → typed error, never a silent miss", async () => {
    const storePath = makeTempStorePath();
    const received = snapReceived();
    await append(storePath, received);
    // Simulate a dangling pointer: index says sequence 2, only 0001 exists.
    const indexFile = join(storePath, "nonces", `${NONCE}.json`);
    const index = JSON.parse(readFileSync(indexFile, "utf8"));
    index.sequence = 2;
    writeFileSync(indexFile, `${JSON.stringify(index)}\n`);

    await expect(findSettlementEvidenceByNonce(storePath, NONCE)).rejects.toThrow(
      X402SettlementEvidenceStoreError
    );
  });
});

describe("secret-free persistence", () => {
  test("no 130-hex signature, no privateKey/mnemonic/seed/payload/signature keys; only known non-secret fields persist", async () => {
    const storePath = makeTempStorePath();
    await append(storePath, snapReceived());
    await append(storePath, snapBatched());
    await append(storePath, snapConfirmed());
    await append(storePath, evidence({ authorizationId: AUTH_B, nonce: NONCE_B, gatewayTransferId: TRANSFER_ID_B }));

    const snapshotKeys: Record<string, true> = {
      evidenceType: true, version: true, authorizationId: true,
      parentAuthorizationId: true, auditId: true, agentId: true,
      paymentRequirementDigest: true, signerPayloadDigest: true,
      network: true, assetAddress: true, payerAddress: true, payTo: true,
      amountAtomic: true, nonce: true, source: true, outcome: true,
      gatewayTransferId: true, gatewayTransferStatus: true,
      gatewaySuccess: true, gatewayErrorReason: true, batchTxHash: true,
      recordedAt: true
    };
    const indexKeys: Record<string, true> = {
      evidenceType: true, version: true, kind: true, nonce: true,
      transferId: true, authorizationId: true, sequence: true,
      evidenceDigest: true, outcome: true, recordedAt: true
    };

    const files = allFiles(storePath);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // a full EIP-3009 signature is 65 bytes = 130 hex — never present
      expect(text).not.toMatch(/[0-9a-fA-F]{130}/);
      // never present, even as JSON keys
      expect(text).not.toMatch(/"(privateKey|mnemonic|seed|payload|signature)"/);
      // every persisted key is a known non-secret field of the two contracts
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const container = basename(dirname(file));
      const allowed = container === "nonces" || container === "transfers" ? indexKeys : snapshotKeys;
      for (const key of Object.keys(parsed)) {
        expect(allowed[key]).toBe(true);
      }
    }
  });
});
