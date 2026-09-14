/**
 * I5.6 — durable SettlementEvidence store: immutable, write-exclusive
 * settlement-outcome evidence keyed by authorizationId, indexed by EIP-3009
 * nonce and (when a validated transfer UUID exists) by Gateway transfer UUID
 * (pre-Phase-9 Circle integration track; Option B of the frozen design — a
 * dedicated directory distinct from the canonical policy audit).
 *
 * PURPOSE: persist every validated remote-interpretation snapshot of one
 * execution attempt as a NEW immutable numbered file, so that (a) a process
 * restart recovers the full lifecycle from disk, (b) crash-recovery replay
 * is idempotent (the same digest → EQUIVALENT, which is what lets the caller
 * reuse the digest and re-run the idempotent I3 transition), and (c) I5.7
 * marks the I3 record `confirmed` only with a digest that already exists
 * durably.
 *
 * SECURITY PRIMITIVE — filesystem-exclusive creation: snapshots and index
 * records are created with `fs.open(path, "wx")` (O_CREAT | O_EXCL on POSIX,
 * CREATE_NEW on Windows) and fsynced before close — the same cross-process
 * primitive as execution-store.ts. No in-memory-lock-only guarantees exist
 * anywhere in this module. TRUST BOUNDARY: this store is a SAME-FILESYSTEM
 * durability and crash-recovery mechanism, NOT a tamper-proof or WORM (write
 * once read many) archive — any process/user able to write into the store
 * directory is inside the trust boundary (the same assumption as
 * data/audit-log.jsonl). Append-only-ness is enforced fail-closed by
 * O_EXCL + strict parsing + never rewriting, not by cryptography.
 *
 * NO SECRETS: the store holds no private key, no signature, no
 * mnemonic/seed, no raw signed PaymentPayload, and no raw Gateway response
 * body — only strictly validated SettlementEvidence objects (digests and
 * official response fields) and non-secret self-describing index pointer
 * records. Official Gateway status is preserved VERBATIM in
 * `gatewayTransferStatus` / `gatewaySuccess` / `gatewayErrorReason` /
 * `batchTxHash`; `outcome` is AgentPay's LOCAL interpretation stored
 * alongside it, never a replacement for it.
 *
 * IMMUTABILITY: there is no mutable overwrite path anywhere in this module.
 * A later `confirmed` snapshot is appended as a NEW numbered file; the
 * earlier `received` snapshot is never rewritten. Reads never mutate.
 * Corruption is fail-closed: reads throw X402SettlementEvidenceStoreError,
 * appends return conflict reason codes — the store is NEVER auto-repaired
 * and NEVER deleted.
 *
 * WRITE ORDER AND INDEX INTEGRITY: append order is snapshot-first, then
 * nonce index, then transfer index (only when a validated UUID exists).
 * Because the index is only ensured after the snapshot it references exists,
 * an index record can never dangle toward a missing snapshot. Index records
 * follow first-reference semantics: an existing index for the SAME
 * authorization is a replay (later lifecycle snapshots reuse the first
 * pointer and never overwrite it); an index owned by a DIFFERENT
 * authorization fails closed (X402_SETTLEMENT_EVIDENCE_CONFLICT). In that
 * ultra-rare race a just-created truthful snapshot file may remain under its
 * own authorization directory (never repaired or removed); the lookup index
 * simply never references it.
 *
 * LAYOUT (exact):
 *   <root>/
 *     authorizations/
 *       auth_<64hex>/
 *         0001.json   (immutable, sequence-numbered evidence snapshots)
 *         0002.json
 *     nonces/
 *       0x<64hex>.json   (nonce → first snapshot reference)
 *     transfers/
 *       <validated-transfer-uuid>.json  (only when a validated UUID exists)
 *
 * Path construction is guarded: authorizationId MUST match
 * `auth_<64 lowercase hex>`, nonce MUST match `0x<64 lowercase hex>`, and a
 * transfer id MUST match the official UUID format before any path is built —
 * user-controlled strings can never select an arbitrary path.
 */
import { open, mkdir, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import {
  SETTLEMENT_EVIDENCE_OUTCOMES,
  isGatewayTransferId,
  validateSettlementEvidence,
  fingerprintSettlementEvidence,
  type SettlementEvidence,
  type SettlementEvidenceOutcome
} from "./settlement-evidence";
// ---------------------------------------------------------------------------

export const X402_SETTLEMENT_EVIDENCE_APPENDED = "X402_SETTLEMENT_EVIDENCE_APPENDED" as const;
export const X402_SETTLEMENT_EVIDENCE_EQUIVALENT = "X402_SETTLEMENT_EVIDENCE_EQUIVALENT" as const;
export const X402_SETTLEMENT_EVIDENCE_CONFLICT = "X402_SETTLEMENT_EVIDENCE_CONFLICT" as const;
export const X402_SETTLEMENT_EVIDENCE_SEQUENCE_CONFLICT =
  "X402_SETTLEMENT_EVIDENCE_SEQUENCE_CONFLICT" as const;

// ---------------------------------------------------------------------------
// Index records (self-describing, non-secret, immutable pointer files).
// ---------------------------------------------------------------------------

export const SETTLEMENT_EVIDENCE_INDEX_TYPE = "x402_settlement_evidence_index" as const;
export const SETTLEMENT_EVIDENCE_INDEX_VERSION = "v1" as const;

/**
 * One pointer from a lookup key (nonce or Gateway transfer UUID) to the
 * FIRST durable snapshot established for its authorization.
 * `sequence` + `evidenceDigest` pin the exact immutable snapshot file: the
 * digest is recomputed from the snapshot content and must match on every
 * lookup (fail closed). Non-secret: identifiers, one outcome label, one
 * timestamp, one digest — nothing else.
 */
export type SettlementEvidenceIndexRecord =
  | {
      evidenceType: "x402_settlement_evidence_index";
      version: "v1";
      kind: "nonce";
      nonce: string;
      transferId: null;
      authorizationId: string;
      sequence: number;
      evidenceDigest: string;
      outcome: SettlementEvidenceOutcome;
      recordedAt: string;
    }
  | {
      evidenceType: "x402_settlement_evidence_index";
      version: "v1";
      kind: "transfer";
      nonce: null;
      transferId: string;
      authorizationId: string;
      sequence: number;
      evidenceDigest: string;
      outcome: SettlementEvidenceOutcome;
      recordedAt: string;
    };

// ---------------------------------------------------------------------------
// Results.
// ---------------------------------------------------------------------------

export type AppendSettlementEvidenceResult =
  | {
      appended: true;
      reasonCode: typeof X402_SETTLEMENT_EVIDENCE_APPENDED;
      evidenceDigest: string;
      sequence: number;
    }
  | {
      appended: false;
      reasonCode: typeof X402_SETTLEMENT_EVIDENCE_EQUIVALENT;
      evidenceDigest: string;
      sequence: number;
    }
  | {
      appended: false;
      reasonCode:
        | typeof X402_SETTLEMENT_EVIDENCE_CONFLICT
        | typeof X402_SETTLEMENT_EVIDENCE_SEQUENCE_CONFLICT;
      evidenceDigest: string | null;
      sequence: number | null;
    };

export type SettlementEvidenceLoad =
  | { kind: "missing" }
  | { kind: "snapshots"; snapshots: SettlementEvidence[] };

// ---------------------------------------------------------------------------
// Fail-closed error: thrown by reads on corrupt history (never auto-repaired).
// ---------------------------------------------------------------------------

export class X402SettlementEvidenceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402SettlementEvidenceStoreError";
  }
}

// ---------------------------------------------------------------------------
// Format validation (path-traversal guard + strict parsing).
// ---------------------------------------------------------------------------

const AUTHORIZATION_ID_PATTERN = /^auth_[0-9a-f]{64}$/;
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT_FILE_PATTERN = /^(\d{4})\.json$/;


const INDEX_KNOWN_FIELDS: Record<string, true> = {
  evidenceType: true,
  version: true,
  kind: true,
  nonce: true,
  transferId: true,
  authorizationId: true,
  sequence: true,
  evidenceDigest: true,
  outcome: true,
  recordedAt: true
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  knownFields: Readonly<Record<string, true>>,
  container: string
): void {
  for (const field of Object.keys(record)) {
    if (!knownFields[field]) {
      throw new X402SettlementEvidenceStoreError(
        `${container} contains an unsupported field: ${field}.`
      );
    }
  }
}

function requireStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new X402SettlementEvidenceStoreError(`${field} must be a non-empty string.`);
  }
  return value;
}

function requirePatternField(
  record: Record<string, unknown>,
  field: string,
  pattern: RegExp
): string {
  const value = requireStringField(record, field);
  if (!pattern.test(value)) {
    throw new X402SettlementEvidenceStoreError(`${field} has an invalid format.`);
  }
  return value;
}

function requireIsoTimestampField(record: Record<string, unknown>, field: string): string {
  const value = requireStringField(record, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new X402SettlementEvidenceStoreError(
      `${field} must be a valid ISO-8601 timestamp.`
    );
  }
  return value;
}

function requireSequenceField(record: Record<string, unknown>): number {
  const value = record.sequence;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new X402SettlementEvidenceStoreError(
      "sequence must be a positive safe integer."
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Durable exclusive-create primitive (mirrors execution-store.ts).
// ---------------------------------------------------------------------------

/**
 * Write `value` as one JSON line to `filePath` with exclusive creation
 * (fs.open(path, "wx") → O_CREAT | O_EXCL). The file is fsynced before close
 * where the platform supports it. If the file already exists the caller
 * observes error.code === "EEXIST" and MUST re-read / fail closed — this is
 * the cross-process concurrency primitive. A crash mid-write can leave a
 * partial file; strict parsing rejects it (fail closed, never repaired).
 */
async function writeJsonFileExclusive(filePath: string, value: unknown): Promise<void> {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Strict snapshot parsing.
// ---------------------------------------------------------------------------

/**
 * Parse one snapshot file body under the full I5.5 contract. A
 * SettlementEvidenceError from the contract is rethrown as a typed store
 * corrupt error so every read surface fails closed through
 * X402SettlementEvidenceStoreError. The snapshot's authorizationId must
 * match the directory it was read from.
 */
function parseSnapshotFile(content: string, authorizationId: string): SettlementEvidence {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence snapshot is not valid JSON."
    );
  }
  let evidence: SettlementEvidence;
  try {
    evidence = validateSettlementEvidence(raw);
  } catch (error) {
    if (error instanceof Error) {
      throw new X402SettlementEvidenceStoreError(
        `settlement evidence snapshot failed contract validation: ${error.message}`
      );
    }
    throw error;
  }
  if (evidence.authorizationId !== authorizationId) {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence snapshot authorizationId does not match its directory."
    );
  }
  return evidence;
}

// ---------------------------------------------------------------------------
// Strict index parsing (filename ↔ content key match included).
// ---------------------------------------------------------------------------

function parseIndexFile(
  content: string,
  expectedKind: "nonce" | "transfer",
  expectedKey: string
): SettlementEvidenceIndexRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence index record is not valid JSON."
    );
  }
  if (!isPlainObject(raw)) {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence index record must be a plain object."
    );
  }
  rejectUnknownFields(raw, INDEX_KNOWN_FIELDS, "x402_settlement_evidence_index");
  if (raw.evidenceType !== SETTLEMENT_EVIDENCE_INDEX_TYPE) {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence index record has an invalid evidenceType."
    );
  }
  if (raw.version !== SETTLEMENT_EVIDENCE_INDEX_VERSION) {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence index record has an unsupported version."
    );
  }
  const kind = raw.kind;
  if (kind !== "nonce" && kind !== "transfer") {
    throw new X402SettlementEvidenceStoreError(
      'settlement evidence index record "kind" must be "nonce" or "transfer".'
    );
  }
  if (kind !== expectedKind) {
    throw new X402SettlementEvidenceStoreError(
      `settlement evidence index record kind "${kind}" found in the "${expectedKind}" index.`
    );
  }
  const outcomeValue = requireStringField(raw, "outcome");
  if (!(SETTLEMENT_EVIDENCE_OUTCOMES as readonly string[]).includes(outcomeValue)) {
    throw new X402SettlementEvidenceStoreError(
      `settlement evidence index record has an unsupported outcome: ${outcomeValue}.`
    );
  }
  const common = {
    authorizationId: requirePatternField(raw, "authorizationId", AUTHORIZATION_ID_PATTERN),
    sequence: requireSequenceField(raw),
    evidenceDigest: requirePatternField(raw, "evidenceDigest", DIGEST_PATTERN),
    outcome: outcomeValue as SettlementEvidenceOutcome,
    recordedAt: requireIsoTimestampField(raw, "recordedAt")
  };
  if (kind === "nonce") {
    const nonce = requirePatternField(raw, "nonce", NONCE_PATTERN);
    if (raw.transferId !== null) {
      throw new X402SettlementEvidenceStoreError(
        '"transferId" must be null in a nonce index record.'
      );
    }
    if (nonce !== expectedKey) {
      throw new X402SettlementEvidenceStoreError(
        "settlement evidence index record nonce does not match its file name."
      );
    }
    return {
      evidenceType: SETTLEMENT_EVIDENCE_INDEX_TYPE,
      version: SETTLEMENT_EVIDENCE_INDEX_VERSION,
      kind: "nonce",
      nonce,
      transferId: null,
      ...common
    };
  }
  const transferId = requireStringField(raw, "transferId");
  if (!isGatewayTransferId(transferId)) {
    throw new X402SettlementEvidenceStoreError(
      "transferId must be an official transfer UUID (never a tx hash)."
    );
  }
  if (raw.nonce !== null) {
    throw new X402SettlementEvidenceStoreError(
      '"nonce" must be null in a transfer index record.'
    );
  }
  if (transferId !== expectedKey) {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence index record transferId does not match its file name."
    );
  }
  return {
    evidenceType: SETTLEMENT_EVIDENCE_INDEX_TYPE,
    version: SETTLEMENT_EVIDENCE_INDEX_VERSION,
    kind: "transfer",
    nonce: null,
    transferId,
    ...common
  };
}

// ---------------------------------------------------------------------------
// Snapshot loading (reads never mutate).
// ---------------------------------------------------------------------------

/**
 * Load and strictly validate every numbered snapshot for one authorization:
 * contiguous sequences `0001..NNNN`, filename ↔ content match (the
 * contract-derived sequence is the position; snapshot bodies carry no
 * sequence field — their identity is content + file order), authorizationId
 * ↔ directory match, and full I5.5 contract validation of every body.
 * Returns "missing" when no lifecycle exists (no writes happen); throws
 * X402SettlementEvidenceStoreError on any corruption — never repaired,
 * never silently skipped.
 */
async function loadSnapshots(
  storePath: string,
  authorizationId: string
): Promise<SettlementEvidenceLoad> {
  const authDir = join(storePath, "authorizations", authorizationId);
  let entries: Dirent[];
  try {
    entries = await readdir(authDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }

  const snapshotFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      throw new X402SettlementEvidenceStoreError(
        `unexpected directory in settlement evidence directory: ${entry.name}.`
      );
    }
    if (entry.isFile() && !SNAPSHOT_FILE_PATTERN.test(entry.name)) {
      throw new X402SettlementEvidenceStoreError(
        `unexpected file in settlement evidence directory: ${entry.name}.`
      );
    }
    if (entry.isFile()) {
      snapshotFiles.push(entry.name);
    }
  }
  snapshotFiles.sort();
  if (snapshotFiles.length === 0) {
    return { kind: "missing" };
  }

  const snapshots: SettlementEvidence[] = [];
  for (let index = 0; index < snapshotFiles.length; index++) {
    const fileName = snapshotFiles[index];
    const expectedSequence = index + 1;
    const match = SNAPSHOT_FILE_PATTERN.exec(fileName);
    if (match === null) {
      throw new X402SettlementEvidenceStoreError(
        `settlement evidence history has an unexpected file: ${fileName}.`
      );
    }
    const fileSequence = Number(match[1]);
    if (fileSequence !== expectedSequence) {
      throw new X402SettlementEvidenceStoreError(
        `settlement evidence history has a sequence gap or duplicate: expected sequence ${expectedSequence}, found ${fileName}.`
      );
    }
    const content = await readFile(join(authDir, fileName), "utf8");
    snapshots.push(parseSnapshotFile(content, authorizationId));
  }
  return { kind: "snapshots", snapshots };
}

function digestSequence(
  snapshots: readonly SettlementEvidence[],
  evidenceDigest: string
): number | null {
  for (let index = 0; index < snapshots.length; index++) {
    if (fingerprintSettlementEvidence(snapshots[index]) === evidenceDigest) {
      return index + 1;
    }
  }
  return null;
}

/**
 * Snapshots under one authorization directory must all describe the SAME
 * execution attempt: the immutable base linkage of the FIRST snapshot wins.
 * A snapshot that changes any base-linkage field (while being a different
 * digest) is a CONFLICT, not a lifecycle continuation. Returns the offending
 * first snapshot's digest/sequence, or null when the linkage matches.
 */
function baseLinkageConflict(
  snapshots: readonly SettlementEvidence[],
  evidence: SettlementEvidence
): { evidenceDigest: string; sequence: number } | null {
  const first = snapshots[0];
  const sameBase =
    first.authorizationId === evidence.authorizationId &&
    first.parentAuthorizationId === evidence.parentAuthorizationId &&
    first.auditId === evidence.auditId &&
    first.agentId === evidence.agentId &&
    first.paymentRequirementDigest === evidence.paymentRequirementDigest &&
    first.signerPayloadDigest === evidence.signerPayloadDigest &&
    first.network === evidence.network &&
    first.assetAddress === evidence.assetAddress &&
    first.payerAddress === evidence.payerAddress &&
    first.payTo === evidence.payTo &&
    first.amountAtomic === evidence.amountAtomic &&
    first.nonce === evidence.nonce;
  if (sameBase) {
    return null;
  }
  return { evidenceDigest: fingerprintSettlementEvidence(first), sequence: 1 };
}

// ---------------------------------------------------------------------------
// Index write / resolve (first-reference semantics, exclusive-create only).
// ---------------------------------------------------------------------------

type IndexResolution =
  | { outcome: "created" }
  | { outcome: "replayed"; record: SettlementEvidenceIndexRecord }
  | { outcome: "conflict"; record: SettlementEvidenceIndexRecord };

/**
 * Exclusively create one index record under first-reference semantics:
 * - created: this process wrote the pointer.
 * - replayed: the pointer already exists for the SAME authorization (later
 *   lifecycle snapshots reuse the first pointer; equivalent content is a
 *   replay, NOT an error).
 * - conflict: the pointer exists and belongs to a DIFFERENT authorization
 *   (fail closed; nothing is written or overwritten).
 * A corrupt existing index file throws (never repaired).
 */
async function ensureIndexExclusive(
  containerDir: string,
  filePath: string,
  record: SettlementEvidenceIndexRecord
): Promise<IndexResolution> {
  await mkdir(containerDir, { recursive: true });
  try {
    await writeJsonFileExclusive(filePath, record);
    return { outcome: "created" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const existing = parseIndexFile(
      await readFile(filePath, "utf8"),
      record.kind,
      record.kind === "nonce" ? record.nonce : record.transferId
    );
    if (existing.authorizationId === record.authorizationId) {
      return { outcome: "replayed", record: existing };
    }
    return { outcome: "conflict", record: existing };
  }
}

function conflictResult(record: SettlementEvidenceIndexRecord): AppendSettlementEvidenceResult {
  return {
    appended: false,
    reasonCode: X402_SETTLEMENT_EVIDENCE_CONFLICT,
    evidenceDigest: record.evidenceDigest,
    sequence: record.sequence
  };
}

/**
 * Read-only pre-flight: if a nonce/transfer index already exists and is
 * owned by a DIFFERENT authorization, fail closed BEFORE any snapshot byte
 * is written (deterministic conflict → nothing written). Missing index files
 * are the normal case (they are ensured after the snapshot write). A corrupt
 * existing index file throws (fail closed, never repaired).
 */
async function preflightIndexOwnership(
  storePath: string,
  evidence: SettlementEvidence
): Promise<AppendSettlementEvidenceResult | null> {
  const checks: Array<{
    filePath: string;
    kind: "nonce" | "transfer";
    key: string;
  }> = [
    {
      filePath: join(storePath, "nonces", `${evidence.nonce}.json`),
      kind: "nonce",
      key: evidence.nonce
    }
  ];
  if (evidence.gatewayTransferId !== null) {
    checks.push({
      filePath: join(storePath, "transfers", `${evidence.gatewayTransferId}.json`),
      kind: "transfer",
      key: evidence.gatewayTransferId
    });
  }
  for (const check of checks) {
    let content: string;
    try {
      content = await readFile(check.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const existing = parseIndexFile(content, check.kind, check.key);
    if (existing.authorizationId !== evidence.authorizationId) {
      return conflictResult(existing);
    }
  }
  return null;
}

function equivalentResult(
  evidenceDigest: string,
  sequence: number
): AppendSettlementEvidenceResult {
  return {
    appended: false,
    reasonCode: X402_SETTLEMENT_EVIDENCE_EQUIVALENT,
    evidenceDigest,
    sequence
  };
}

// ---------------------------------------------------------------------------
// Append.
// ---------------------------------------------------------------------------

/**
 * Durably append one validated evidence snapshot for one authorization.
 *
 * Decision table (nothing is ever overwritten or repaired):
 * | Condition                                            | Result                                                  |
 * | ---------------------------------------------------- | ------------------------------------------------------- |
 * | input fails the I5.5 contract                         | throws SettlementEvidenceError (no write)               |
 * | corrupt existing history / index                      | throws X402SettlementEvidenceStoreError (no write)      |
 * | base linkage differs from existing snapshots          | CONFLICT {first snapshot digest, 1} (no write)          |
 * | same digest already exists (any sequence)             | EQUIVALENT {digest, that sequence} (replay; the index is ensured so a crash-window replay stays recoverable; a foreign-owned index surfaces as CONFLICT) |
 * | won exclusive create of `<next sequence>.json`        | APPENDED {digest, sequence}                             |
 * | lost the race; winner file has the SAME digest        | EQUIVALENT {digest, sequence}                           |
 * | lost the race; winner file has a DIFFERENT digest     | SEQUENCE_CONFLICT {null, null} (nothing written)        |
 * | nonce/transfer index owned by a DIFFERENT auth        | CONFLICT {their digest, their sequence} (pre-flight: nothing written; concurrent race: detected after the snapshot write, snapshot is truthful history) |
 *
 * @param input.storePath settlement-evidence root directory
 * @param input.evidence  unvalidated candidate evidence (validated here)
 */
export async function appendSettlementEvidence(input: {
  storePath: string;
  evidence: SettlementEvidence;
}): Promise<AppendSettlementEvidenceResult> {
  const { storePath } = input;
  if (typeof storePath !== "string" || storePath.length === 0) {
    throw new X402SettlementEvidenceStoreError("storePath must be a non-empty string.");
  }
  const evidence = validateSettlementEvidence(input.evidence);
  const authorizationId = evidence.authorizationId;
  const evidenceDigest = fingerprintSettlementEvidence(evidence);

  // Precheck (read-only): replay/conflict resolution before any bytes.
  const loaded = await loadSnapshots(storePath, authorizationId);
  if (loaded.kind === "snapshots") {
    const existingSequence = digestSequence(loaded.snapshots, evidenceDigest);
    if (existingSequence !== null) {
      // Crash-window replay: the snapshot already exists durably. Ensure
      // the index points at it (idempotent) before answering EQUIVALENT.
      const replay = equivalentResult(evidenceDigest, existingSequence);
      const indexFailure = await ensureIndexes(
        storePath,
        evidence,
        evidenceDigest,
        existingSequence
      );
      return indexFailure ?? replay;
    }
    const baseConflict = baseLinkageConflict(loaded.snapshots, evidence);
    if (baseConflict !== null) {
      return {
        appended: false,
        reasonCode: X402_SETTLEMENT_EVIDENCE_CONFLICT,
        evidenceDigest: baseConflict.evidenceDigest,
        sequence: baseConflict.sequence
      };
    }
  }

  // Index ownership pre-flight (read-only): a nonce/transfer pointer owned
  // by a DIFFERENT authorization fails closed BEFORE any snapshot byte.
  const ownershipConflict = await preflightIndexOwnership(storePath, evidence);
  if (ownershipConflict !== null) {
    return ownershipConflict;
  }

  const sequence = loaded.kind === "snapshots" ? loaded.snapshots.length + 1 : 1;
  const filePath = join(
    storePath,
    "authorizations",
    authorizationId,
    `${String(sequence).padStart(4, "0")}.json`
  );
  await mkdir(join(storePath, "authorizations", authorizationId), { recursive: true });
  try {
    await writeJsonFileExclusive(filePath, evidence);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    // Lost the race for this sequence: re-read and resolve. The winner wrote
    // the EXACT same evidence → replay; anything else → fail closed
    // (SEQUENCE_CONFLICT, nothing further written, no repair).
    const raced = await loadSnapshots(storePath, authorizationId);
    if (raced.kind === "snapshots") {
      const racedSequence = digestSequence(raced.snapshots, evidenceDigest);
      if (racedSequence !== null) {
        const replay = equivalentResult(evidenceDigest, racedSequence);
        const indexFailure = await ensureIndexes(
          storePath,
          evidence,
          evidenceDigest,
          racedSequence
        );
        return indexFailure ?? replay;
      }
    }
    return {
      appended: false,
      reasonCode: X402_SETTLEMENT_EVIDENCE_SEQUENCE_CONFLICT,
      evidenceDigest: null,
      sequence: null
    };
  }

  const indexConflict = await ensureIndexes(storePath, evidence, evidenceDigest, sequence);
  if (indexConflict !== null) {
    return indexConflict;
  }
  return {
    appended: true,
    reasonCode: X402_SETTLEMENT_EVIDENCE_APPENDED,
    evidenceDigest,
    sequence
  };
}

/**
 * Ensure the nonce index (always) and the transfer index (only when the
 * evidence carries a validated UUID). Returns a CONFLICT result when an
 * index belongs to a different authorization, else null.
 */
async function ensureIndexes(
  storePath: string,
  evidence: SettlementEvidence,
  evidenceDigest: string,
  sequence: number
): Promise<AppendSettlementEvidenceResult | null> {
  const common = {
    evidenceType: SETTLEMENT_EVIDENCE_INDEX_TYPE,
    version: SETTLEMENT_EVIDENCE_INDEX_VERSION,
    authorizationId: evidence.authorizationId,
    sequence,
    evidenceDigest,
    outcome: evidence.outcome,
    recordedAt: evidence.recordedAt
  };
  const nonceResolution = await ensureIndexExclusive(
    join(storePath, "nonces"),
    join(storePath, "nonces", `${evidence.nonce}.json`),
    { ...common, kind: "nonce", nonce: evidence.nonce, transferId: null }
  );
  if (nonceResolution.outcome === "conflict") {
    return conflictResult(nonceResolution.record);
  }
  if (evidence.gatewayTransferId !== null) {
    const transferResolution = await ensureIndexExclusive(
      join(storePath, "transfers"),
      join(storePath, "transfers", `${evidence.gatewayTransferId}.json`),
      { ...common, kind: "transfer", nonce: null, transferId: evidence.gatewayTransferId }
    );
    if (transferResolution.outcome === "conflict") {
      return conflictResult(transferResolution.record);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/**
 * All validated snapshots for one authorization, in file order
 * (`0001..NNNN`). Missing store/authorization → `{ kind: "missing" }`;
 * malformed authorizationId → missing (no path is ever constructed from an
 * unvalidated string); corruption → throws. Never mutates.
 */
export async function readSettlementEvidence(
  storePath: string,
  authorizationId: string
): Promise<SettlementEvidenceLoad> {
  if (typeof storePath !== "string" || storePath.length === 0) {
    throw new X402SettlementEvidenceStoreError("storePath must be a non-empty string.");
  }
  if (!AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    return { kind: "missing" };
  }
  return loadSnapshots(storePath, authorizationId);
}

/** The highest-sequence validated snapshot, or null when none exists. */
export async function latestSettlementEvidence(
  storePath: string,
  authorizationId: string
): Promise<SettlementEvidence | null> {
  const loaded = await readSettlementEvidence(storePath, authorizationId);
  if (loaded.kind === "missing") {
    return null;
  }
  return loaded.snapshots[loaded.snapshots.length - 1];
}

/**
 * Shared index lookup: strictly validate the index file, then cross-check
 * the reference it points at — the snapshot file at (authorizationId,
 * sequence) must exist, pass the full contract, and re-fingerprint to the
 * stored digest. Any mismatch is corruption (throws); a dangling or
 * tampered pointer is NEVER interpreted as a hit.
 */
async function resolveIndexReference(
  storePath: string,
  record: SettlementEvidenceIndexRecord
): Promise<{ authorizationId: string; sequence: number; evidenceDigest: string }> {
  const authDir = join(storePath, "authorizations", record.authorizationId);
  let content: string;
  try {
    content = await readFile(
      join(authDir, `${String(record.sequence).padStart(4, "0")}.json`),
      "utf8"
    );
  } catch {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence index points at a missing snapshot file."
    );
  }
  const snapshot = parseSnapshotFile(content, record.authorizationId);
  if (fingerprintSettlementEvidence(snapshot) !== record.evidenceDigest) {
    throw new X402SettlementEvidenceStoreError(
      "settlement evidence index digest does not match the referenced snapshot."
    );
  }
  return {
    authorizationId: record.authorizationId,
    sequence: record.sequence,
    evidenceDigest: record.evidenceDigest
  };
}

/**
 * Resolve a nonce to its first durable snapshot reference (index read +
 * strict cross-check). Missing store/index → null; malformed nonce → null
 * (no path is ever constructed from an unvalidated string); corruption →
 * throws. Never mutates.
 */
export async function findSettlementEvidenceByNonce(
  storePath: string,
  nonce: string
): Promise<{ authorizationId: string; sequence: number; evidenceDigest: string } | null> {
  if (typeof storePath !== "string" || storePath.length === 0) {
    throw new X402SettlementEvidenceStoreError("storePath must be a non-empty string.");
  }
  if (!NONCE_PATTERN.test(nonce)) {
    return null;
  }
  const filePath = join(storePath, "nonces", `${nonce}.json`);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const record = parseIndexFile(content, "nonce", nonce);
  return resolveIndexReference(storePath, record);
}

/**
 * Resolve a Gateway transfer UUID to its first durable snapshot reference
 * (index read + strict cross-check). Missing store/index → null; malformed
 * UUID → null; corruption → throws. Never mutates.
 */
export async function findSettlementEvidenceByTransferId(
  storePath: string,
  transferId: string
): Promise<{ authorizationId: string; sequence: number; evidenceDigest: string } | null> {
  if (typeof storePath !== "string" || storePath.length === 0) {
    throw new X402SettlementEvidenceStoreError("storePath must be a non-empty string.");
  }
  if (!isGatewayTransferId(transferId)) {
    return null;
  }
  const filePath = join(storePath, "transfers", `${transferId}.json`);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const record = parseIndexFile(content, "transfer", transferId);
  return resolveIndexReference(storePath, record);
}

/**
 * Sorted authorization directories that hold snapshot history. Missing
 * store root → []. An empty `authorizations/` root or an empty authorization
 * directory (crash between mkdir and first write) → skipped, not corruption.
 * A malformed directory name or a corrupt history throws (fail closed).
 */
export async function listSettlementEvidenceAuthorizations(storePath: string): Promise<string[]> {
  if (typeof storePath !== "string" || storePath.length === 0) {
    throw new X402SettlementEvidenceStoreError("storePath must be a non-empty string.");
  }
  const root = join(storePath, "authorizations");
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      throw new X402SettlementEvidenceStoreError(
        `unexpected file in settlement evidence authorizations directory: ${entry.name}.`
      );
    }
    if (!AUTHORIZATION_ID_PATTERN.test(entry.name)) {
      throw new X402SettlementEvidenceStoreError(
        `unexpected authorization directory name: ${entry.name}.`
      );
    }
    const loaded = await loadSnapshots(storePath, entry.name);
    if (loaded.kind === "snapshots") {
      ids.push(entry.name);
    }
  }
  ids.sort();
  return ids;
}
