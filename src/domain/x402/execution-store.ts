/**
 * I3 — restart-safe, filesystem-backed execution state store (pre-Phase-9
 * Circle integration track).
 *
 * PURPOSE: consume an eligible x402 ExecutionAuthorization v2 EXACTLY ONCE
 * before any future signer can be contacted. An eligible v2 (I2 gate PASS)
 * becomes a durable single-use execution claim: a prepared execution record
 * plus a bound EIP-3009 nonce. Nothing else: no signer, no payment, no
 * Gateway call, no transaction, no settlement (I4–I6 / Phase 9 are out of
 * scope).
 *
 * SECURITY PRIMITIVE — filesystem-exclusive creation: canonical state events
 * and nonce claims are created with `fs.open(path, "wx")` (O_CREAT | O_EXCL
 * on POSIX, CREATE_NEW on Windows). The FIRST process to create a given file
 * wins; every other concurrent process observes EEXIST and must re-read the
 * store and fail closed (or, for the exact same transition, treat it as a
 * replay). This is an operating-system primitive, exclusive across processes
 * on the SAME FILESYSTEM. It is NOT distributed/multi-host safe, NOT
 * database-grade distributed consensus, NOT WORM, and NOT cryptographically
 * tamper-proof. Restart-safe application state is the claim; a process able
 * to write into the store directory is inside the trust boundary (the same
 * assumption as data/audit-log.jsonl).
 *
 * SINGLE-USE SEMANTICS: creating the FIRST prepared state event permanently
 * consumes the v2 authorization for the execution-attempt lifecycle. A
 * second prepare for the same authorizationId — even after a process
 * restart, and even when the stored state is terminal `failed` — returns a
 * stable duplicate/consumed result and NEVER writes another event or nonce.
 * Retrying after a terminal failure requires a fresh Guard authorization
 * lineage (a new v1/v2), never reuse of the consumed id.
 *
 * CRASH-WINDOW RECOVERY (designed in): the prepare order is (1) derive the
 * deterministic nonce; (2) create-or-read the nonce claim; (3) if an
 * existing nonce claim belongs to the SAME authorization (same
 * authorizationId and paymentRequirementDigest) it is reused as the durable
 * claim — a crash between nonce-claim creation and prepared-event creation
 * therefore leaves a recoverable state: a later process may finish creating
 * the prepared event; (4) exclusively create the prepared event. A nonce
 * claim pre-claimed by a DIFFERENT authorization fails closed
 * (X402_EXECUTION_NONCE_CONFLICT) and no prepared event is written for the
 * conflicting authorization.
 *
 * EXPLICIT TIME: every persistence function receives an explicit
 * `now`/`occurredAt: Date`. This module NEVER calls `Date.now()`.
 * ISO-8601 UTC timestamps are stored. An invalid Date (NaN time) fails
 * closed and writes nothing.
 *
 * STRICT PARSING: persisted events are never trusted as their TS type.
 * Every read validates eventType/version/sequence/state/authorizationId/
 * occurredAt plus state-specific fields (nonce, digests, addresses, amount,
 * failure fields, ISO timestamps) and rejects unknown fields. Histories
 * must start with a prepared event at sequence 1 and follow the allowed
 * state graph with contiguous sequences. Corrupt history fails closed:
 * reads throw X402ExecutionStoreError, transitions return
 * X402_EXECUTION_STORE_CORRUPT, and the store is NEVER auto-repaired or
 * deleted.
 *
 * STATE GRAPH (I5 extension):
 *   prepared                → submitted | failed
 *   submitted               → confirmed | failed | remote_outcome_unknown
 *   remote_outcome_unknown  → confirmed | failed
 *   confirmed / failed      → (terminal; no outgoing transitions)
 * `remote_outcome_unknown → submitted` NEVER exists. `submitted` keeps its
 * I3 meaning: the signed payload digest was committed to the LOCAL
 * execution lifecycle — it is NOT a claim that anything reached Gateway.
 * `remote_outcome_unknown` records an AMBIGUOUS remote outcome (transport
 * timeout/reset, 5xx, malformed response, crash after remote acceptance):
 * reconciliation happens by nonce against official Gateway/transfer data
 * and NEVER auto-re-signs the deterministic nonce with a fresh validity
 * window. An unreconciled record stays `remote_outcome_unknown`: at-risk,
 * never counted as settled and never counted as failed/zero.
 *
 * LAYOUT:
 *   <store>/
 *     authorizations/
 *       auth_<64hex>/
 *         0001.json   (immutable, sequence-numbered state events)
 *         0002.json
 *     nonces/
 *       0x<64hex>.json  (one durable nonce claim per nonce)
 *
 * authorizationId MUST match `auth_<64 lowercase hex>` and nonce MUST match
 * `0x<64 lowercase hex>` before any path construction — user-controlled
 * strings can never select an arbitrary path (path-traversal guard).
 */

import { open, mkdir, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { stableSha256 } from "@/lib/stable-json";
import type { X402ExecutionAuthorizationV2 } from "./execution-authorization-v2";
import type { X402ExecutionGateResult } from "./execution-security-gate";
import { X402_GATEWAY_REASON_CODES } from "./gateway-reason-codes";
import type { X402GatewayReasonCode } from "./gateway-reason-codes";

// ---------------------------------------------------------------------------
// Stable reason codes — the state-machine contract, not free-form strings.
// ---------------------------------------------------------------------------

export const X402_EXECUTION_PREPARED = "X402_EXECUTION_PREPARED" as const;
export const X402_EXECUTION_GATE_NOT_ELIGIBLE = "X402_EXECUTION_GATE_NOT_ELIGIBLE" as const;
export const X402_EXECUTION_ALREADY_CONSUMED = "X402_EXECUTION_ALREADY_CONSUMED" as const;
export const X402_EXECUTION_AUTHORIZATION_EXPIRED = "X402_EXECUTION_AUTHORIZATION_EXPIRED" as const;
export const X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED =
  "X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED" as const;
export const X402_EXECUTION_NONCE_CONFLICT = "X402_EXECUTION_NONCE_CONFLICT" as const;
export const X402_EXECUTION_STORE_CORRUPT = "X402_EXECUTION_STORE_CORRUPT" as const;
export const X402_EXECUTION_TRANSITION_APPLIED = "X402_EXECUTION_TRANSITION_APPLIED" as const;
export const X402_EXECUTION_TRANSITION_REPLAYED = "X402_EXECUTION_TRANSITION_REPLAYED" as const;
export const X402_EXECUTION_INVALID_TRANSITION = "X402_EXECUTION_INVALID_TRANSITION" as const;
export const X402_EXECUTION_STATE_CONFLICT = "X402_EXECUTION_STATE_CONFLICT" as const;
export const X402_EXECUTION_NOT_FOUND = "X402_EXECUTION_NOT_FOUND" as const;

export type X402ExecutionReasonCode =
  | typeof X402_EXECUTION_PREPARED
  | typeof X402_EXECUTION_GATE_NOT_ELIGIBLE
  | typeof X402_EXECUTION_ALREADY_CONSUMED
  | typeof X402_EXECUTION_AUTHORIZATION_EXPIRED
  | typeof X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED
  | typeof X402_EXECUTION_NONCE_CONFLICT
  | typeof X402_EXECUTION_STORE_CORRUPT
  | typeof X402_EXECUTION_TRANSITION_APPLIED
  | typeof X402_EXECUTION_TRANSITION_REPLAYED
  | typeof X402_EXECUTION_INVALID_TRANSITION
  | typeof X402_EXECUTION_STATE_CONFLICT
  | typeof X402_EXECUTION_NOT_FOUND;

export type X402ExecutionState =
  | "prepared"
  | "submitted"
  | "remote_outcome_unknown"
  | "confirmed"
  | "failed";
export type X402ExecutionFailureStage = "prepare" | "sign" | "submit" | "settle";

export const X402_EXECUTION_STATES = [
  "prepared",
  "submitted",
  "remote_outcome_unknown",
  "confirmed",
  "failed"
] as const;
export const X402_EXECUTION_FAILURE_STAGES = ["prepare", "sign", "submit", "settle"] as const;

// ---------------------------------------------------------------------------
// Event / record / claim shapes.
// ---------------------------------------------------------------------------

/** Base shape of every numbered immutable state event. */
export type X402ExecutionStateEvent = {
  eventType: "x402_execution_state";
  version: "v1";
  sequence: number;
  state: X402ExecutionState;
  authorizationId: string;
  occurredAt: string;
};

/**
 * The prepared event (sequence 1) commits the v2 evidence needed later by
 * I4/I5. All payment fields come from the successful v2 authorization
 * (network/assetAddress/payTo/amountAtomic/paymentRequirementDigest) — never
 * from a second raw requirement. NEVER stores private keys, signatures, raw
 * signed payloads, transaction hashes, Gateway transfer ids, or fake
 * settlement status.
 */
export type X402PreparedExecutionEvent = X402ExecutionStateEvent & {
  state: "prepared";
  parentAuthorizationId: string;
  auditId: string;
  idempotencyKey: string;
  agentId: string;
  recipient: string;
  paymentRequirementDigest: string;
  network: string;
  assetAddress: string;
  payTo: string;
  amountAtomic: string;
  policyVersion: string;
  policyFingerprint: string;
  authorizationExpiresAt: string;
  nonce: string;
};

/**
 * prepared → submitted: execution-state claim only; stores ONLY digests,
 * never the signature/payload. The four recovery fields (payerAddress,
 * signingRequestDigest, validAfter, validBefore — decimal Unix-second
 * strings) are non-secret EIP-3009 metadata: after a crash the signed
 * validity window CANNOT be reconstructed from the local store, so a
 * re-sign with a fresh `now` would change the payload; recovery therefore
 * reconciles by nonce and NEVER auto-re-signs. Pre-I5 legacy records omit
 * all four together (see parse: partial presence is corrupt).
 */
export type X402ExecutionSubmittedEvent = X402ExecutionStateEvent & {
  state: "submitted";
  nonce: string;
  signerPayloadDigest: string;
  payerAddress?: string;
  signingRequestDigest?: string;
  validAfter?: string;
  validBefore?: string;
};

/**
 * submitted → remote_outcome_unknown: the remote outcome is UNKNOWN (not
 * failed). Stores ONLY the bound nonce, a stable Gateway reason code, and
 * an optional transfer UUID (non-null ONLY when a validated Gateway
 * response produced one). NEVER a signature, private key, raw payload, or
 * raw Gateway error body.
 */
export type X402ExecutionRemoteOutcomeUnknownEvent = X402ExecutionStateEvent & {
  state: "remote_outcome_unknown";
  nonce: string;
  reasonCode: X402GatewayReasonCode;
  gatewayTransferId: string | null;
};

/** submitted|remote_outcome_unknown → confirmed: stores ONLY the SettlementEvidence digest reference (I5 defines the object). */
export type X402ExecutionConfirmedEvent = X402ExecutionStateEvent & {
  state: "confirmed";
  settlementEvidenceDigest: string;
};

/** prepared|submitted|remote_outcome_unknown → failed: stable stage + code; never Error.stack or secrets. */
export type X402ExecutionFailedEvent = X402ExecutionStateEvent & {
  state: "failed";
  failureStage: X402ExecutionFailureStage;
  failureCode: string;
};

/** Durable nonce registry record: one claim per nonce, exclusive-create. */
export type X402NonceClaimRecord = {
  eventType: "x402_nonce_claim";
  version: "v1";
  nonce: string;
  authorizationId: string;
  paymentRequirementDigest: string;
  claimedAt: string;
};

/** Canonical prepared evidence, available at every execution state. */
export type X402PreparedExecutionRecord = {
  authorizationId: string;
  nonce: string;
  paymentRequirementDigest: string;
  parentAuthorizationId: string;
  auditId: string;
  idempotencyKey: string;
  agentId: string;
  recipient: string;
  network: string;
  assetAddress: string;
  payTo: string;
  amountAtomic: string;
  policyVersion: string;
  policyFingerprint: string;
  authorizationExpiresAt: string;
  preparedAt: string;
};

/**
 * submitted-state read record. The four recovery fields are null ONLY for
 * legacy pre-I5 events that omitted all four together; `
 * recoveryMetadataComplete` is true iff all four are present. Downstream
 * I5 recovery MUST fail closed on incomplete metadata instead of
 * re-deriving a validity window: the EIP-3009 window signed into the
 * payload cannot be reconstructed after a crash, so re-signing the same
 * deterministic nonce with a fresh `now` would be unsafe — reconciliation
 * proceeds by nonce and NEVER auto-re-signs.
 */
export type X402SubmittedExecutionRecord = {
  sequence: number;
  occurredAt: string;
  nonce: string;
  signerPayloadDigest: string;
  payerAddress: string | null;
  signingRequestDigest: string | null;
  validAfter: string | null;
  validBefore: string | null;
  recoveryMetadataComplete: boolean;
};

/** remote_outcome_unknown read record: stable reason code + optional validated transfer UUID. */
export type X402RemoteOutcomeUnknownRecord = {
  sequence: number;
  occurredAt: string;
  nonce: string;
  reasonCode: X402GatewayReasonCode;
  gatewayTransferId: string | null;
};

export type X402TerminalExecutionRecord =
  | {
      sequence: number;
      occurredAt: string;
      state: "confirmed";
      settlementEvidenceDigest: string;
    }
  | {
      sequence: number;
      occurredAt: string;
      state: "failed";
      failureStage: X402ExecutionFailureStage;
      failureCode: string;
    };

/** Reconstructed current state from persisted events (read API). */
export type X402ExecutionRecord = {
  authorizationId: string;
  state: X402ExecutionState;
  prepared: X402PreparedExecutionRecord;
  submitted?: X402SubmittedExecutionRecord;
  remoteOutcomeUnknown?: X402RemoteOutcomeUnknownRecord;
  terminal?: X402TerminalExecutionRecord;
};

// ---------------------------------------------------------------------------
// Results.
// ---------------------------------------------------------------------------

export type X402PrepareExecutionRejectionCode =
  | typeof X402_EXECUTION_GATE_NOT_ELIGIBLE
  | typeof X402_EXECUTION_AUTHORIZATION_EXPIRED
  | typeof X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED
  | typeof X402_EXECUTION_ALREADY_CONSUMED
  | typeof X402_EXECUTION_NONCE_CONFLICT
  | typeof X402_EXECUTION_STORE_CORRUPT;

export type X402PrepareExecutionResult =
  | {
      prepared: true;
      reasonCode: typeof X402_EXECUTION_PREPARED;
      record: X402PreparedExecutionRecord;
    }
  | {
      prepared: false;
      reasonCode: X402PrepareExecutionRejectionCode;
      record: null;
    };

export type X402ExecutionTransitionResult =
  | {
      applied: true;
      reasonCode: typeof X402_EXECUTION_TRANSITION_APPLIED;
      record: X402ExecutionRecord;
    }
  | {
      applied: false;
      reasonCode:
        | typeof X402_EXECUTION_TRANSITION_REPLAYED
        | typeof X402_EXECUTION_INVALID_TRANSITION
        | typeof X402_EXECUTION_STATE_CONFLICT
        | typeof X402_EXECUTION_NOT_FOUND
        | typeof X402_EXECUTION_STORE_CORRUPT;
      record: null;
    };

export type X402PrepareExecutionAttemptInput = {
  gateResult: X402ExecutionGateResult;
  storePath: string;
  now: Date;
};

export type X402ExecutionSubmittedInput = {
  storePath: string;
  authorizationId: string;
  nonce: string;
  signerPayloadDigest: string;
  /** Non-secret recovery metadata (see X402ExecutionSubmittedEvent). */
  payerAddress: string;
  signingRequestDigest: string;
  /** Decimal Unix-second string, as signed into the EIP-3009 payload. */
  validAfter: string;
  /** Decimal Unix-second string, as signed into the EIP-3009 payload. */
  validBefore: string;
  occurredAt: Date;
};

export type X402ExecutionRemoteOutcomeUnknownInput = {
  storePath: string;
  authorizationId: string;
  nonce: string;
  reasonCode: X402GatewayReasonCode;
  /** Transfer UUID ONLY when a validated Gateway response produced one. */
  gatewayTransferId: string | null;
  occurredAt: Date;
};

export type X402ExecutionConfirmedInput = {
  storePath: string;
  authorizationId: string;
  settlementEvidenceDigest: string;
  occurredAt: Date;
};

export type X402ExecutionFailedInput = {
  storePath: string;
  authorizationId: string;
  failureStage: X402ExecutionFailureStage;
  failureCode: string;
  occurredAt: Date;
};

// ---------------------------------------------------------------------------
// Fail-closed error: thrown by reads on corrupt history (never auto-repaired).
// ---------------------------------------------------------------------------

export class X402ExecutionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402ExecutionStoreError";
  }
}

// ---------------------------------------------------------------------------
// Format validation (path-traversal guard + strict parsing).
// ---------------------------------------------------------------------------

const AUTHORIZATION_ID_PATTERN = /^auth_[0-9a-f]{64}$/;
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NETWORK_PATTERN = /^eip155:[1-9]\d*$/;
const AMOUNT_PATTERN = /^[1-9]\d*$/;
const EVENT_FILE_PATTERN = /^(\d{4})\.json$/;
/** Decimal Unix-second string (same style as the I4 EIP-3009 validity window). */
const UNIX_SECONDS_PATTERN = /^[1-9]\d*$/;
/** Gateway transfer UUID (canonical lowercase 8-4-4-4-12 hex). */
const TRANSFER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const EVENT_BASE_KNOWN_FIELDS: Record<string, true> = {
  eventType: true,
  version: true,
  sequence: true,
  state: true,
  authorizationId: true,
  occurredAt: true
};
const PREPARED_KNOWN_FIELDS: Record<string, true> = {
  ...EVENT_BASE_KNOWN_FIELDS,
  parentAuthorizationId: true,
  auditId: true,
  idempotencyKey: true,
  agentId: true,
  recipient: true,
  paymentRequirementDigest: true,
  network: true,
  assetAddress: true,
  payTo: true,
  amountAtomic: true,
  policyVersion: true,
  policyFingerprint: true,
  authorizationExpiresAt: true,
  nonce: true
};
const SUBMITTED_KNOWN_FIELDS: Record<string, true> = {
  ...EVENT_BASE_KNOWN_FIELDS,
  nonce: true,
  signerPayloadDigest: true,
  payerAddress: true,
  signingRequestDigest: true,
  validAfter: true,
  validBefore: true
};
const REMOTE_OUTCOME_UNKNOWN_KNOWN_FIELDS: Record<string, true> = {
  ...EVENT_BASE_KNOWN_FIELDS,
  nonce: true,
  reasonCode: true,
  gatewayTransferId: true
};
const CONFIRMED_KNOWN_FIELDS: Record<string, true> = {
  ...EVENT_BASE_KNOWN_FIELDS,
  settlementEvidenceDigest: true
};
const FAILED_KNOWN_FIELDS: Record<string, true> = {
  ...EVENT_BASE_KNOWN_FIELDS,
  failureStage: true,
  failureCode: true
};
const KNOWN_NONCE_CLAIM_FIELDS: Record<string, true> = {
  eventType: true,
  version: true,
  nonce: true,
  authorizationId: true,
  paymentRequirementDigest: true,
  claimedAt: true
};

const ALLOWED_TRANSITIONS: Record<X402ExecutionState, readonly X402ExecutionState[]> = {
  prepared: ["submitted", "failed"],
  submitted: ["confirmed", "failed", "remote_outcome_unknown"],
  remote_outcome_unknown: ["confirmed", "failed"],
  confirmed: [],
  failed: []
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
      throw new X402ExecutionStoreError(`${container} contains an unsupported field: ${field}.`);
    }
  }
}

function requireStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new X402ExecutionStoreError(`${field} must be a non-empty string.`);
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
    throw new X402ExecutionStoreError(`${field} has an invalid format.`);
  }
  return value;
}

function requireIsoTimestampField(record: Record<string, unknown>, field: string): string {
  const value = requireStringField(record, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new X402ExecutionStoreError(`${field} must be a valid ISO-8601 timestamp.`);
  }
  return value;
}

function requireEnumField<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T {
  const value = requireStringField(record, field);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new X402ExecutionStoreError(`${field} has an unsupported value: ${value}.`);
  }
  return value as T;
}

function requireSequenceField(record: Record<string, unknown>): number {
  const value = record.sequence;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new X402ExecutionStoreError("sequence must be a positive safe integer.");
  }
  return value;
}

/**
 * All-or-nothing legacy-tolerant recovery block: null ONLY when all four
 * fields are absent together (pre-I5 record); partial presence is CORRUPT
 * (fail closed — no auto-repair, no rewrite, nothing fabricated); full
 * presence is pattern-validated and returned.
 */
function parseRecoveryFields(
  record: Record<string, unknown>
): {
  payerAddress: string;
  signingRequestDigest: string;
  validAfter: string;
  validBefore: string;
} | null {
  const names = ["payerAddress", "signingRequestDigest", "validAfter", "validBefore"] as const;
  const present = names.filter((field) => record[field] !== undefined);
  if (present.length === 0) {
    return null;
  }
  if (present.length < names.length) {
    throw new X402ExecutionStoreError(
      `submitted event recovery metadata is partial (${present.join(", ")}); all four fields must be present together.`
    );
  }
  return {
    payerAddress: requirePatternField(record, "payerAddress", EVM_ADDRESS_PATTERN),
    signingRequestDigest: requirePatternField(record, "signingRequestDigest", DIGEST_PATTERN),
    validAfter: requirePatternField(record, "validAfter", UNIX_SECONDS_PATTERN),
    validBefore: requirePatternField(record, "validBefore", UNIX_SECONDS_PATTERN)
  };
}

/** Transfer UUID when non-null; `null` is a first-class legitimate value. */
function requireNullableTransferIdField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !TRANSFER_UUID_PATTERN.test(value)) {
    throw new X402ExecutionStoreError(`${field} must be a lowercase Gateway transfer UUID or null.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Nonce derivation (STEP 9): deterministic, cryptographically bound, no
// randomness, no clock, no private key.
// ---------------------------------------------------------------------------

/**
 * Deterministic EIP-3009 nonce for one v2 authorization:
 * `0x` + SHA-256(stable JSON of { purpose, authorizationId,
 * paymentRequirementDigest }) via the repo's stableSha256. Same v2 → same
 * nonce; different v2 → different nonce; one-to-one authorizationId ↔ nonce
 * is auditable from the nonce registry. Output is exactly 0x<64 lowercase
 * hex> (32 bytes). Malformed inputs fail closed with X402ExecutionStoreError.
 */
export function deriveX402ExecutionNonce(
  authorizationId: string,
  paymentRequirementDigest: string
): string {
  if (!AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    throw new X402ExecutionStoreError(
      "authorizationId must be auth_<64 lowercase hex> to derive an execution nonce."
    );
  }
  if (!DIGEST_PATTERN.test(paymentRequirementDigest)) {
    throw new X402ExecutionStoreError(
      "paymentRequirementDigest must be sha256:<64 lowercase hex> to derive an execution nonce."
    );
  }
  return `0x${stableSha256({
    purpose: "agentpay_eip3009_nonce_v1",
    authorizationId,
    paymentRequirementDigest
  })}`;
}

// ---------------------------------------------------------------------------
// Durable exclusive-create primitive (STEP 10).
// ---------------------------------------------------------------------------

/**
 * Write `value` as one JSON line to `filePath` with exclusive creation
 * (fs.open(path, "wx") → O_CREAT | O_EXCL). The file is fsynced before
 * close where the platform supports it. If the file already exists the
 * caller observes error.code === "EEXIST" and MUST re-read/fail closed —
 * this is the cross-process concurrency primitive. A crash mid-write can
 * leave a partial file; strict parsing rejects it (fail closed, never
 * repaired).
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

/**
 * Exclusively create one numbered state event. Returns "created" when this
 * process won the race, "exists" when another process already created the
 * same next-sequence file (caller must re-read and resolve replay/conflict).
 */
async function createEventFileExclusive(
  storePath: string,
  authorizationId: string,
  event: X402ExecutionStateEvent
): Promise<"created" | "exists"> {
  await mkdir(join(storePath, "authorizations", authorizationId), { recursive: true });
  const filePath = join(
    storePath,
    "authorizations",
    authorizationId,
    `${String(event.sequence).padStart(4, "0")}.json`
  );
  try {
    await writeJsonFileExclusive(filePath, event);
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return "exists";
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Strict event parsing (STEP 11).
// ---------------------------------------------------------------------------

function parseExecutionStateEvent(
  content: string,
  authorizationId: string,
  fileSequence: number
): X402ExecutionStateEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new X402ExecutionStoreError("execution state event is not valid JSON.");
  }
  if (!isPlainObject(raw)) {
    throw new X402ExecutionStoreError("execution state event must be a plain object.");
  }
  if (raw.eventType !== "x402_execution_state") {
    throw new X402ExecutionStoreError("execution state event has an invalid eventType.");
  }
  if (raw.version !== "v1") {
    throw new X402ExecutionStoreError("execution state event has an unsupported version.");
  }
  const sequence = requireSequenceField(raw);
  if (sequence !== fileSequence) {
    throw new X402ExecutionStoreError(
      "execution state event sequence does not match its file name."
    );
  }
  const state = requireEnumField(raw, "state", X402_EXECUTION_STATES);
  const parsedAuthorizationId = requirePatternField(raw, "authorizationId", AUTHORIZATION_ID_PATTERN);
  if (parsedAuthorizationId !== authorizationId) {
    throw new X402ExecutionStoreError(
      "execution state event authorizationId does not match its directory."
    );
  }
  const occurredAt = requireIsoTimestampField(raw, "occurredAt");
  const base = {
    eventType: "x402_execution_state" as const,
    version: "v1" as const,
    sequence,
    state,
    authorizationId: parsedAuthorizationId,
    occurredAt
  };

  switch (state) {
    case "prepared": {
      rejectUnknownFields(raw, PREPARED_KNOWN_FIELDS, "x402_execution_state prepared event");
      const event: X402PreparedExecutionEvent = {
        ...base,
        state: "prepared",
        parentAuthorizationId: requirePatternField(raw, "parentAuthorizationId", AUTHORIZATION_ID_PATTERN),
        auditId: requireStringField(raw, "auditId"),
        idempotencyKey: requireStringField(raw, "idempotencyKey"),
        agentId: requireStringField(raw, "agentId"),
        recipient: requireStringField(raw, "recipient"),
        paymentRequirementDigest: requirePatternField(raw, "paymentRequirementDigest", DIGEST_PATTERN),
        network: requirePatternField(raw, "network", NETWORK_PATTERN),
        assetAddress: requirePatternField(raw, "assetAddress", EVM_ADDRESS_PATTERN),
        payTo: requirePatternField(raw, "payTo", EVM_ADDRESS_PATTERN),
        amountAtomic: requirePatternField(raw, "amountAtomic", AMOUNT_PATTERN),
        policyVersion: requireStringField(raw, "policyVersion"),
        policyFingerprint: requirePatternField(raw, "policyFingerprint", DIGEST_PATTERN),
        authorizationExpiresAt: requireIsoTimestampField(raw, "authorizationExpiresAt"),
        nonce: requirePatternField(raw, "nonce", NONCE_PATTERN)
      };
      return event;
    }
    case "submitted": {
      rejectUnknownFields(raw, SUBMITTED_KNOWN_FIELDS, "x402_execution_state submitted event");
      const event: X402ExecutionSubmittedEvent = {
        ...base,
        state: "submitted",
        nonce: requirePatternField(raw, "nonce", NONCE_PATTERN),
        signerPayloadDigest: requirePatternField(raw, "signerPayloadDigest", DIGEST_PATTERN),
        ...(parseRecoveryFields(raw) ?? {})
      };
      return event;
    }
    case "remote_outcome_unknown": {
      rejectUnknownFields(
        raw,
        REMOTE_OUTCOME_UNKNOWN_KNOWN_FIELDS,
        "x402_execution_state remote_outcome_unknown event"
      );
      const event: X402ExecutionRemoteOutcomeUnknownEvent = {
        ...base,
        state: "remote_outcome_unknown",
        nonce: requirePatternField(raw, "nonce", NONCE_PATTERN),
        reasonCode: requireEnumField(raw, "reasonCode", X402_GATEWAY_REASON_CODES),
        gatewayTransferId: requireNullableTransferIdField(raw, "gatewayTransferId")
      };
      return event;
    }
    case "confirmed": {
      rejectUnknownFields(raw, CONFIRMED_KNOWN_FIELDS, "x402_execution_state confirmed event");
      const event: X402ExecutionConfirmedEvent = {
        ...base,
        state: "confirmed",
        settlementEvidenceDigest: requirePatternField(raw, "settlementEvidenceDigest", DIGEST_PATTERN)
      };
      return event;
    }
    case "failed": {
      rejectUnknownFields(raw, FAILED_KNOWN_FIELDS, "x402_execution_state failed event");
      const event: X402ExecutionFailedEvent = {
        ...base,
        state: "failed",
        failureStage: requireEnumField(raw, "failureStage", X402_EXECUTION_FAILURE_STAGES),
        failureCode: requireStringField(raw, "failureCode")
      };
      return event;
    }
  }
}

function parseNonceClaim(content: string, expectedNonce: string): X402NonceClaimRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new X402ExecutionStoreError("nonce claim is not valid JSON.");
  }
  if (!isPlainObject(raw)) {
    throw new X402ExecutionStoreError("nonce claim must be a plain object.");
  }
  rejectUnknownFields(raw, KNOWN_NONCE_CLAIM_FIELDS, "x402_nonce_claim");
  if (raw.eventType !== "x402_nonce_claim") {
    throw new X402ExecutionStoreError("nonce claim has an invalid eventType.");
  }
  if (raw.version !== "v1") {
    throw new X402ExecutionStoreError("nonce claim has an unsupported version.");
  }
  const nonce = requirePatternField(raw, "nonce", NONCE_PATTERN);
  if (nonce !== expectedNonce) {
    throw new X402ExecutionStoreError("nonce claim file content does not match its file name.");
  }
  return {
    eventType: "x402_nonce_claim",
    version: "v1",
    nonce,
    authorizationId: requirePatternField(raw, "authorizationId", AUTHORIZATION_ID_PATTERN),
    paymentRequirementDigest: requirePatternField(raw, "paymentRequirementDigest", DIGEST_PATTERN),
    claimedAt: requireIsoTimestampField(raw, "claimedAt")
  };
}

function validateTransitionHistory(events: readonly X402ExecutionStateEvent[]): void {
  if (events.length === 0) {
    throw new X402ExecutionStoreError("execution state history is empty.");
  }
  if (events[0].state !== "prepared") {
    throw new X402ExecutionStoreError(
      "execution state history must begin with a prepared event at sequence 1."
    );
  }
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1];
    const current = events[index];
    if (current.sequence !== previous.sequence + 1) {
      throw new X402ExecutionStoreError("execution state sequences are not contiguous.");
    }
    if (!ALLOWED_TRANSITIONS[previous.state].includes(current.state)) {
      throw new X402ExecutionStoreError(
        `invalid execution state transition ${previous.state} -> ${current.state} at sequence ${current.sequence}.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Read / reconstruction (STEP 12). Reads never mutate the store.
// ---------------------------------------------------------------------------

/**
 * Load and strictly validate every numbered state event for one
 * authorization. Returns "missing" when no lifecycle exists (no writes
 * happen), "events" with the validated, sequence-ordered events, and throws
 * X402ExecutionStoreError on any corrupt history (never repaired, never
 * silently skipped).
 */
export type X402ExecutionEventsLoad =
  | { kind: "missing" }
  | { kind: "events"; events: X402ExecutionStateEvent[] };

async function loadStateEvents(
  storePath: string,
  authorizationId: string
): Promise<X402ExecutionEventsLoad> {
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

  const eventFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && !EVENT_FILE_PATTERN.test(entry.name)) {
      throw new X402ExecutionStoreError(
        `unexpected file in execution state directory: ${entry.name}.`
      );
    }
    if (entry.isDirectory()) {
      throw new X402ExecutionStoreError(
        `unexpected directory in execution state directory: ${entry.name}.`
      );
    }
    if (entry.isFile()) {
      eventFiles.push(entry.name);
    }
  }
  eventFiles.sort();
  if (eventFiles.length === 0) {
    return { kind: "missing" };
  }

  const events: X402ExecutionStateEvent[] = [];
  for (let index = 0; index < eventFiles.length; index++) {
    const fileName = eventFiles[index];
    const expectedSequence = index + 1;
    const match = EVENT_FILE_PATTERN.exec(fileName);
    if (match === null) {
      throw new X402ExecutionStoreError(
        `execution state history has an unexpected file: ${fileName}.`
      );
    }
    const fileSequence = Number(match[1]);
    if (fileSequence !== expectedSequence) {
      throw new X402ExecutionStoreError(
        `execution state history has a sequence gap or duplicate: expected sequence ${expectedSequence}, found ${fileName}.`
      );
    }
    const content = await readFile(join(authDir, fileName), "utf8");
    events.push(parseExecutionStateEvent(content, authorizationId, fileSequence));
  }
  validateTransitionHistory(events);
  return { kind: "events", events };
}

function preparedRecordFromEvent(event: X402PreparedExecutionEvent): X402PreparedExecutionRecord {
  return {
    authorizationId: event.authorizationId,
    nonce: event.nonce,
    paymentRequirementDigest: event.paymentRequirementDigest,
    parentAuthorizationId: event.parentAuthorizationId,
    auditId: event.auditId,
    idempotencyKey: event.idempotencyKey,
    agentId: event.agentId,
    recipient: event.recipient,
    network: event.network,
    assetAddress: event.assetAddress,
    payTo: event.payTo,
    amountAtomic: event.amountAtomic,
    policyVersion: event.policyVersion,
    policyFingerprint: event.policyFingerprint,
    authorizationExpiresAt: event.authorizationExpiresAt,
    preparedAt: event.occurredAt
  };
}

function buildExecutionRecord(
  authorizationId: string,
  events: readonly X402ExecutionStateEvent[]
): X402ExecutionRecord {
  const first = events[0];
  if (first.state !== "prepared") {
    throw new X402ExecutionStoreError("execution state history must begin with a prepared event.");
  }
  const preparedEvent = first as X402PreparedExecutionEvent;
  let submitted: X402SubmittedExecutionRecord | undefined;
  let remoteOutcomeUnknown: X402RemoteOutcomeUnknownRecord | undefined;
  let terminal: X402TerminalExecutionRecord | undefined;
  for (const event of events.slice(1)) {
    if (event.state === "submitted") {
      const submittedEvent = event as X402ExecutionSubmittedEvent;
      const complete =
        submittedEvent.payerAddress !== undefined &&
        submittedEvent.signingRequestDigest !== undefined &&
        submittedEvent.validAfter !== undefined &&
        submittedEvent.validBefore !== undefined;
      submitted = {
        sequence: submittedEvent.sequence,
        occurredAt: submittedEvent.occurredAt,
        nonce: submittedEvent.nonce,
        signerPayloadDigest: submittedEvent.signerPayloadDigest,
        payerAddress: submittedEvent.payerAddress ?? null,
        signingRequestDigest: submittedEvent.signingRequestDigest ?? null,
        validAfter: submittedEvent.validAfter ?? null,
        validBefore: submittedEvent.validBefore ?? null,
        recoveryMetadataComplete: complete
      };
    } else if (event.state === "remote_outcome_unknown") {
      const unknownEvent = event as X402ExecutionRemoteOutcomeUnknownEvent;
      remoteOutcomeUnknown = {
        sequence: unknownEvent.sequence,
        occurredAt: unknownEvent.occurredAt,
        nonce: unknownEvent.nonce,
        reasonCode: unknownEvent.reasonCode,
        gatewayTransferId: unknownEvent.gatewayTransferId
      };
    } else if (event.state === "confirmed") {
      const confirmedEvent = event as X402ExecutionConfirmedEvent;
      terminal = {
        sequence: confirmedEvent.sequence,
        occurredAt: confirmedEvent.occurredAt,
        state: "confirmed",
        settlementEvidenceDigest: confirmedEvent.settlementEvidenceDigest
      };
    } else if (event.state === "failed") {
      const failedEvent = event as X402ExecutionFailedEvent;
      terminal = {
        sequence: failedEvent.sequence,
        occurredAt: failedEvent.occurredAt,
        state: "failed",
        failureStage: failedEvent.failureStage,
        failureCode: failedEvent.failureCode
      };
    }
  }
  const last = events[events.length - 1];
  return {
    authorizationId,
    state: last.state,
    prepared: preparedRecordFromEvent(preparedEvent),
    ...(submitted !== undefined ? { submitted } : {}),
    ...(remoteOutcomeUnknown !== undefined ? { remoteOutcomeUnknown } : {}),
    ...(terminal !== undefined ? { terminal } : {})
  };
}

/**
 * Reconstructs the current execution state from persisted immutable events.
 * Missing authorization → null; malformed authorizationId → null (no path is
 * ever constructed from an unvalidated id). Corrupt history throws
 * X402ExecutionStoreError (fail closed). Never mutates the store.
 */
export async function readX402ExecutionRecord(
  storePath: string,
  authorizationId: string
): Promise<X402ExecutionRecord | null> {
  if (typeof storePath !== "string" || storePath.length === 0) {
    throw new X402ExecutionStoreError("storePath must be a non-empty string.");
  }
  if (!AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    return null;
  }
  const loaded = await loadStateEvents(storePath, authorizationId);
  if (loaded.kind === "missing") {
    return null;
  }
  return buildExecutionRecord(authorizationId, loaded.events);
}

// ---------------------------------------------------------------------------
// Nonce registry (STEP 9/10): exclusive-create, same-authorization reuse.
// ---------------------------------------------------------------------------

/**
 * Claim the deterministic nonce. "claimed" = this process created the durable
 * claim; "reused" = the claim already exists and belongs to the SAME
 * authorization (crash-window recovery; no write happens); "conflict" = the
 * nonce file exists but is claimed by a DIFFERENT authorization (fail
 * closed); "corrupt" = the existing claim file is unreadable/invalid (fail
 * closed).
 */
async function claimNonceExclusive(
  storePath: string,
  claim: X402NonceClaimRecord
): Promise<"claimed" | "reused" | "conflict" | "corrupt"> {
  await mkdir(join(storePath, "nonces"), { recursive: true });
  const filePath = join(storePath, "nonces", `${claim.nonce}.json`);
  try {
    await writeJsonFileExclusive(filePath, claim);
    return "claimed";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    let existing: X402NonceClaimRecord;
    try {
      existing = parseNonceClaim(await readFile(filePath, "utf8"), claim.nonce);
    } catch (error) {
      if (error instanceof X402ExecutionStoreError) {
        return "corrupt";
      }
      throw error;
    }
    if (
      existing.authorizationId === claim.authorizationId &&
      existing.paymentRequirementDigest === claim.paymentRequirementDigest
    ) {
      return "reused";
    }
    return "conflict";
  }
}

// ---------------------------------------------------------------------------
// Prepare (STEP 8): consume an eligible v2 exactly once.
// ---------------------------------------------------------------------------

/** Returns a defect description when the v2 shape is not well-formed, else null. */
function v2AuthorizationDefect(v2: X402ExecutionAuthorizationV2): string | null {
  if (!isPlainObject(v2)) {
    return "authorization must be a plain object.";
  }
  if (!AUTHORIZATION_ID_PATTERN.test(v2.authorizationId)) {
    return "authorizationId must be auth_<64 lowercase hex>.";
  }
  if (!AUTHORIZATION_ID_PATTERN.test(v2.parentAuthorizationId)) {
    return "parentAuthorizationId must be auth_<64 lowercase hex>.";
  }
  if (typeof v2.auditId !== "string" || v2.auditId.length === 0) {
    return "auditId must be a non-empty string.";
  }
  if (typeof v2.idempotencyKey !== "string" || v2.idempotencyKey.length === 0) {
    return "idempotencyKey must be a non-empty string.";
  }
  if (typeof v2.agentId !== "string" || v2.agentId.length === 0) {
    return "agentId must be a non-empty string.";
  }
  if (typeof v2.recipient !== "string" || v2.recipient.length === 0) {
    return "recipient must be a non-empty string.";
  }
  if (!DIGEST_PATTERN.test(v2.paymentRequirementDigest)) {
    return "paymentRequirementDigest must be sha256:<64 lowercase hex>.";
  }
  if (typeof v2.policyVersion !== "string" || v2.policyVersion.length === 0) {
    return "policyVersion must be a non-empty string.";
  }
  if (!DIGEST_PATTERN.test(v2.policyFingerprint)) {
    return "policyFingerprint must be sha256:<64 lowercase hex>.";
  }
  if (!isPlainObject(v2.x402)) {
    return "x402 must be a plain object.";
  }
  if (!NETWORK_PATTERN.test(v2.x402.network)) {
    return "x402.network must be a CAIP-2 EVM identifier.";
  }
  if (!EVM_ADDRESS_PATTERN.test(v2.x402.assetAddress)) {
    return "x402.assetAddress must be an EVM address.";
  }
  if (!EVM_ADDRESS_PATTERN.test(v2.x402.payTo)) {
    return "x402.payTo must be an EVM address.";
  }
  if (!AMOUNT_PATTERN.test(v2.x402.amountAtomic)) {
    return "x402.amountAtomic must be a canonical positive integer string.";
  }
  return null;
}

/**
 * Public single-use consumption entry point. Requires a real I2
 * X402ExecutionGateResult with `eligibleForSignerRequest === true` and a
 * non-null v2 authorization; anything else writes NOTHING and returns
 * X402_EXECUTION_GATE_NOT_ELIGIBLE. Expiry is re-checked against `now`
 * (defense-in-depth — time may pass between I2 evaluation and I3
 * persistence): now < expiresAt may prepare; now >= expiresAt rejects with
 * X402_EXECUTION_AUTHORIZATION_EXPIRED; unparseable expiresAt rejects with
 * X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED; NaN `now` fails closed
 * under EXPIRED. Rejected expiry writes no nonce claim and no execution
 * directory. The FIRST prepared event permanently consumes the
 * authorization; every later prepare returns
 * X402_EXECUTION_ALREADY_CONSUMED (even after restart, even after terminal
 * failure) with no new event and no new nonce.
 */
export async function prepareX402ExecutionAttempt(
  input: X402PrepareExecutionAttemptInput
): Promise<X402PrepareExecutionResult> {
  const { gateResult, storePath, now } = input;

  if (typeof storePath !== "string" || storePath.length === 0) {
    return { prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
  }
  if (!gateResult.eligibleForSignerRequest || gateResult.authorization === null) {
    return { prepared: false, reasonCode: X402_EXECUTION_GATE_NOT_ELIGIBLE, record: null };
  }
  const v2 = gateResult.authorization;

  // Expiry re-check FIRST (defense-in-depth — time may pass between I2
  // evaluation and I3 persistence): now < expiresAt may prepare; now >=
  // expiresAt rejects under EXPIRED; an unparseable expiresAt fails closed
  // under TIMESTAMP_MALFORMED; a NaN `now` fails closed under EXPIRED. No
  // nonce claim and no execution directory on any rejected expiry.
  if (Number.isNaN(now.getTime())) {
    return { prepared: false, reasonCode: X402_EXECUTION_AUTHORIZATION_EXPIRED, record: null };
  }
  const expiresAtMs = Date.parse(v2.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return { prepared: false, reasonCode: X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED, record: null };
  }
  if (now.getTime() >= expiresAtMs) {
    return { prepared: false, reasonCode: X402_EXECUTION_AUTHORIZATION_EXPIRED, record: null };
  }
  let occurredAt: string;
  try {
    occurredAt = now.toISOString();
  } catch {
    return { prepared: false, reasonCode: X402_EXECUTION_AUTHORIZATION_EXPIRED, record: null };
  }

  const defect = v2AuthorizationDefect(v2);
  if (defect !== null) {
    return { prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
  }

  // Consumed check (read-only) before any write.
  let existing: X402ExecutionEventsLoad;
  try {
    existing = await loadStateEvents(storePath, v2.authorizationId);
  } catch (error) {
    if (error instanceof X402ExecutionStoreError) {
      return { prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
    }
    throw error;
  }
  if (existing.kind === "events") {
    return { prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null };
  }

  // Durable nonce claim first (crash-window recovery: claim may exist while
  // the prepared event does not; a same-authorization claim is reusable).
  const nonce = deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest);
  const claimOutcome = await claimNonceExclusive(storePath, {
    eventType: "x402_nonce_claim",
    version: "v1",
    nonce,
    authorizationId: v2.authorizationId,
    paymentRequirementDigest: v2.paymentRequirementDigest,
    claimedAt: occurredAt
  });
  if (claimOutcome === "conflict") {
    return { prepared: false, reasonCode: X402_EXECUTION_NONCE_CONFLICT, record: null };
  }
  if (claimOutcome === "corrupt") {
    return { prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
  }

  // Re-check consumption (a concurrent process may have prepared between the
  // two reads) before exclusively creating the prepared event.
  try {
    existing = await loadStateEvents(storePath, v2.authorizationId);
  } catch (error) {
    if (error instanceof X402ExecutionStoreError) {
      return { prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
    }
    throw error;
  }
  if (existing.kind === "events") {
    return { prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null };
  }

  const preparedEvent: X402PreparedExecutionEvent = {
    eventType: "x402_execution_state",
    version: "v1",
    sequence: 1,
    state: "prepared",
    authorizationId: v2.authorizationId,
    occurredAt,
    parentAuthorizationId: v2.parentAuthorizationId,
    auditId: v2.auditId,
    idempotencyKey: v2.idempotencyKey,
    agentId: v2.agentId,
    recipient: v2.recipient,
    paymentRequirementDigest: v2.paymentRequirementDigest,
    network: v2.x402.network,
    assetAddress: v2.x402.assetAddress,
    payTo: v2.x402.payTo,
    amountAtomic: v2.x402.amountAtomic,
    policyVersion: v2.policyVersion,
    policyFingerprint: v2.policyFingerprint,
    authorizationExpiresAt: v2.expiresAt,
    nonce
  };

  const outcome = await createEventFileExclusive(storePath, v2.authorizationId, preparedEvent);
  if (outcome === "exists") {
    try {
      const current = await loadStateEvents(storePath, v2.authorizationId);
      return current.kind === "events"
        ? { prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null }
        : { prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
    } catch (error) {
      if (error instanceof X402ExecutionStoreError) {
        return { prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
      }
      throw error;
    }
  }

  return {
    prepared: true,
    reasonCode: X402_EXECUTION_PREPARED,
    record: preparedRecordFromEvent(preparedEvent)
  };
}

// ---------------------------------------------------------------------------
// Transitions (STEP 13) — storage primitives for I4/I5. NONE of these call
// a signer or Gateway; submitted/confirmed are execution-state claims only.
// ---------------------------------------------------------------------------

function invalidTransitionResult(): X402ExecutionTransitionResult {
  return { applied: false, reasonCode: X402_EXECUTION_INVALID_TRANSITION, record: null };
}

/** Loads events for a transition, mapping missing → NOT_FOUND and corrupt → STORE_CORRUPT. */
async function loadEventsForTransition(
  storePath: string,
  authorizationId: string
): Promise<X402ExecutionEventsLoad | { kind: "corrupt" }> {
  try {
    return await loadStateEvents(storePath, authorizationId);
  } catch (error) {
    if (error instanceof X402ExecutionStoreError) {
      return { kind: "corrupt" };
    }
    throw error;
  }
}

function notFoundResult(): X402ExecutionTransitionResult {
  return { applied: false, reasonCode: X402_EXECUTION_NOT_FOUND, record: null };
}

function corruptResult(): X402ExecutionTransitionResult {
  return { applied: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null };
}

function replayedResult(): X402ExecutionTransitionResult {
  return { applied: false, reasonCode: X402_EXECUTION_TRANSITION_REPLAYED, record: null };
}

function conflictResult(): X402ExecutionTransitionResult {
  return { applied: false, reasonCode: X402_EXECUTION_STATE_CONFLICT, record: null };
}

function eventsEquivalent(
  left: X402ExecutionStateEvent,
  right: X402ExecutionStateEvent
): boolean {
  if (left.state !== right.state || left.sequence !== right.sequence) {
    return false;
  }
  switch (left.state) {
    case "prepared": {
      const leftEvent = left as X402PreparedExecutionEvent;
      const rightEvent = right as X402PreparedExecutionEvent;
      return (
        leftEvent.nonce === rightEvent.nonce &&
        leftEvent.paymentRequirementDigest === rightEvent.paymentRequirementDigest
      );
    }
    case "submitted": {
      const leftEvent = left as X402ExecutionSubmittedEvent;
      const rightEvent = right as X402ExecutionSubmittedEvent;
      return (
        leftEvent.nonce === rightEvent.nonce &&
        leftEvent.signerPayloadDigest === rightEvent.signerPayloadDigest &&
        (leftEvent.payerAddress ?? null) === (rightEvent.payerAddress ?? null) &&
        (leftEvent.signingRequestDigest ?? null) === (rightEvent.signingRequestDigest ?? null) &&
        (leftEvent.validAfter ?? null) === (rightEvent.validAfter ?? null) &&
        (leftEvent.validBefore ?? null) === (rightEvent.validBefore ?? null)
      );
    }
    case "remote_outcome_unknown": {
      const leftEvent = left as X402ExecutionRemoteOutcomeUnknownEvent;
      const rightEvent = right as X402ExecutionRemoteOutcomeUnknownEvent;
      return (
        leftEvent.nonce === rightEvent.nonce &&
        leftEvent.reasonCode === rightEvent.reasonCode &&
        leftEvent.gatewayTransferId === rightEvent.gatewayTransferId
      );
    }
    case "confirmed": {
      const leftEvent = left as X402ExecutionConfirmedEvent;
      const rightEvent = right as X402ExecutionConfirmedEvent;
      return leftEvent.settlementEvidenceDigest === rightEvent.settlementEvidenceDigest;
    }
    case "failed": {
      const leftEvent = left as X402ExecutionFailedEvent;
      const rightEvent = right as X402ExecutionFailedEvent;
      return (
        leftEvent.failureStage === rightEvent.failureStage &&
        leftEvent.failureCode === rightEvent.failureCode
      );
    }
  }
}

/**
 * After losing an exclusive-create race on the next sequence, re-read and
 * resolve: the winner applied the EXACT same transition → replay; anything
 * else → conflict. Never writes a compensating event.
 */
async function resolveTransitionRace(
  storePath: string,
  authorizationId: string,
  requested: X402ExecutionStateEvent
): Promise<X402ExecutionTransitionResult> {
  const loaded = await loadEventsForTransition(storePath, authorizationId);
  if (loaded.kind !== "events") {
    return conflictResult();
  }
  const winner = loaded.events.find((event) => event.sequence === requested.sequence);
  if (winner !== undefined && eventsEquivalent(winner, requested)) {
    return replayedResult();
  }
  return conflictResult();
}

async function appliedResult(
  storePath: string,
  authorizationId: string
): Promise<X402ExecutionTransitionResult> {
  const record = await readX402ExecutionRecord(storePath, authorizationId);
  if (record === null) {
    return corruptResult();
  }
  return { applied: true, reasonCode: X402_EXECUTION_TRANSITION_APPLIED, record };
}

/**
 * prepared → submitted (execution-state claim only). Requires the stored
 * nonce, a `sha256:<64 hex>` signerPayloadDigest, and the four non-secret
 * recovery fields (payerAddress, signingRequestDigest, validAfter/validBefore
 * as decimal Unix-second strings); stores ONLY digests/metadata, never the
 * signature or payload. No statement that Gateway accepted anything.
 */
export async function markX402ExecutionSubmitted(
  input: X402ExecutionSubmittedInput
): Promise<X402ExecutionTransitionResult> {
  const {
    storePath,
    authorizationId,
    nonce,
    signerPayloadDigest,
    payerAddress,
    signingRequestDigest,
    validAfter,
    validBefore,
    occurredAt
  } = input;
  if (typeof storePath !== "string" || storePath.length === 0) {
    return invalidTransitionResult();
  }
  if (!AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    return invalidTransitionResult();
  }
  if (!NONCE_PATTERN.test(nonce)) {
    return invalidTransitionResult();
  }
  if (!DIGEST_PATTERN.test(signerPayloadDigest)) {
    return invalidTransitionResult();
  }
  if (!EVM_ADDRESS_PATTERN.test(payerAddress)) {
    return invalidTransitionResult();
  }
  if (!DIGEST_PATTERN.test(signingRequestDigest)) {
    return invalidTransitionResult();
  }
  if (!UNIX_SECONDS_PATTERN.test(validAfter) || !UNIX_SECONDS_PATTERN.test(validBefore)) {
    return invalidTransitionResult();
  }
  if (Number(validBefore) <= Number(validAfter)) {
    return invalidTransitionResult();
  }
  if (Number.isNaN(occurredAt.getTime())) {
    return invalidTransitionResult();
  }
  let occurredAtIso: string;
  try {
    occurredAtIso = occurredAt.toISOString();
  } catch {
    return invalidTransitionResult();
  }

  const loaded = await loadEventsForTransition(storePath, authorizationId);
  if (loaded.kind === "missing") {
    return notFoundResult();
  }
  if (loaded.kind === "corrupt") {
    return corruptResult();
  }
  const events = loaded.events;
  const current = events[events.length - 1];
  if (current.state !== "prepared") {
    if (current.state === "submitted") {
      const existing = current as X402ExecutionSubmittedEvent;
      if (
        existing.nonce === nonce &&
        existing.signerPayloadDigest === signerPayloadDigest &&
        (existing.payerAddress ?? null) === payerAddress &&
        (existing.signingRequestDigest ?? null) === signingRequestDigest &&
        (existing.validAfter ?? null) === validAfter &&
        (existing.validBefore ?? null) === validBefore
      ) {
        return replayedResult();
      }
      return conflictResult();
    }
    return invalidTransitionResult();
  }
  const prepared = events[0] as X402PreparedExecutionEvent;
  if (prepared.nonce !== nonce) {
    return invalidTransitionResult();
  }

  const event: X402ExecutionSubmittedEvent = {
    eventType: "x402_execution_state",
    version: "v1",
    sequence: current.sequence + 1,
    state: "submitted",
    authorizationId,
    occurredAt: occurredAtIso,
    nonce,
    signerPayloadDigest,
    payerAddress,
    signingRequestDigest,
    validAfter,
    validBefore
  };
  const outcome = await createEventFileExclusive(storePath, authorizationId, event);
  if (outcome === "exists") {
    return resolveTransitionRace(storePath, authorizationId, event);
  }
  return appliedResult(storePath, authorizationId);
}

/**
 * submitted|remote_outcome_unknown → confirmed. Requires a `sha256:<64 hex>`
 * settlementEvidenceDigest — a naked confirmed is impossible without this
 * durable settlement-evidence commitment, and a reconciled remote outcome may
 * only confirm with the same evidence reference. No transaction hashes or
 * fake outcome data are ever stored (I5 defines the actual SettlementEvidence
 * object; I3 stores only its digest reference).
 */
export async function markX402ExecutionConfirmed(
  input: X402ExecutionConfirmedInput
): Promise<X402ExecutionTransitionResult> {
  const { storePath, authorizationId, settlementEvidenceDigest, occurredAt } = input;
  if (typeof storePath !== "string" || storePath.length === 0) {
    return invalidTransitionResult();
  }
  if (!AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    return invalidTransitionResult();
  }
  if (!DIGEST_PATTERN.test(settlementEvidenceDigest)) {
    return invalidTransitionResult();
  }
  if (Number.isNaN(occurredAt.getTime())) {
    return invalidTransitionResult();
  }
  let occurredAtIso: string;
  try {
    occurredAtIso = occurredAt.toISOString();
  } catch {
    return invalidTransitionResult();
  }

  const loaded = await loadEventsForTransition(storePath, authorizationId);
  if (loaded.kind === "missing") {
    return notFoundResult();
  }
  if (loaded.kind === "corrupt") {
    return corruptResult();
  }
  const events = loaded.events;
  const current = events[events.length - 1];
  if (current.state !== "submitted" && current.state !== "remote_outcome_unknown") {
    if (current.state === "confirmed") {
      const existing = current as X402ExecutionConfirmedEvent;
      if (existing.settlementEvidenceDigest === settlementEvidenceDigest) {
        return replayedResult();
      }
      return conflictResult();
    }
    return invalidTransitionResult();
  }

  const event: X402ExecutionConfirmedEvent = {
    eventType: "x402_execution_state",
    version: "v1",
    sequence: current.sequence + 1,
    state: "confirmed",
    authorizationId,
    occurredAt: occurredAtIso,
    settlementEvidenceDigest
  };
  const outcome = await createEventFileExclusive(storePath, authorizationId, event);
  if (outcome === "exists") {
    return resolveTransitionRace(storePath, authorizationId, event);
  }
  return appliedResult(storePath, authorizationId);
}

/**
 * prepared|submitted|remote_outcome_unknown → failed (terminal).
 * failureStage ∈ "prepare" | "sign" | "submit" | "settle"; failureCode is a
 * stable string. Error.stack and secrets are NEVER stored. Failure stays
 * terminal; the authorization remains non-reusable. Reaching `failed` from
 * `remote_outcome_unknown` is only legitimate after reconciliation PROVES a
 * known deterministic rejection (see the I5 design).
 */
export async function markX402ExecutionFailed(
  input: X402ExecutionFailedInput
): Promise<X402ExecutionTransitionResult> {
  const { storePath, authorizationId, failureStage, failureCode, occurredAt } = input;
  if (typeof storePath !== "string" || storePath.length === 0) {
    return invalidTransitionResult();
  }
  if (!AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    return invalidTransitionResult();
  }
  if (!(X402_EXECUTION_FAILURE_STAGES as readonly string[]).includes(failureStage)) {
    return invalidTransitionResult();
  }
  if (typeof failureCode !== "string" || failureCode.length === 0) {
    return invalidTransitionResult();
  }
  if (Number.isNaN(occurredAt.getTime())) {
    return invalidTransitionResult();
  }
  let occurredAtIso: string;
  try {
    occurredAtIso = occurredAt.toISOString();
  } catch {
    return invalidTransitionResult();
  }

  const loaded = await loadEventsForTransition(storePath, authorizationId);
  if (loaded.kind === "missing") {
    return notFoundResult();
  }
  if (loaded.kind === "corrupt") {
    return corruptResult();
  }
  const events = loaded.events;
  const current = events[events.length - 1];
  if (
    current.state !== "prepared" &&
    current.state !== "submitted" &&
    current.state !== "remote_outcome_unknown"
  ) {
    if (current.state === "failed") {
      const existing = current as X402ExecutionFailedEvent;
      if (existing.failureStage === failureStage && existing.failureCode === failureCode) {
        return replayedResult();
      }
      return conflictResult();
    }
    return invalidTransitionResult();
  }

  const event: X402ExecutionFailedEvent = {
    eventType: "x402_execution_state",
    version: "v1",
    sequence: current.sequence + 1,
    state: "failed",
    authorizationId,
    occurredAt: occurredAtIso,
    failureStage,
    failureCode
  };
  const outcome = await createEventFileExclusive(storePath, authorizationId, event);
  if (outcome === "exists") {
    return resolveTransitionRace(storePath, authorizationId, event);
  }
  return appliedResult(storePath, authorizationId);
}

/**
 * submitted → remote_outcome_unknown (I5): an AMBIGUOUS remote outcome
 * (transport timeout/reset, 5xx, malformed response, crash after remote
 * acceptance) is UNKNOWN, never `failed`. The stored submitted nonce must
 * equal the requested nonce (fail closed, no write). `gatewayTransferId`
 * is a transfer UUID ONLY when a validated Gateway response produced one,
 * else null. NEVER stores a signature, private key, raw payload, or raw
 * Gateway error body. An identical repeat while already
 * `remote_outcome_unknown` is REPLAYED; a different repeat is a
 * STATE_CONFLICT. `remote_outcome_unknown → submitted` NEVER exists:
 * recovery reconciles by nonce and never re-signs.
 */
export async function markX402ExecutionRemoteOutcomeUnknown(
  input: X402ExecutionRemoteOutcomeUnknownInput
): Promise<X402ExecutionTransitionResult> {
  const { storePath, authorizationId, nonce, reasonCode, gatewayTransferId, occurredAt } = input;
  if (typeof storePath !== "string" || storePath.length === 0) {
    return invalidTransitionResult();
  }
  if (!AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    return invalidTransitionResult();
  }
  if (!NONCE_PATTERN.test(nonce)) {
    return invalidTransitionResult();
  }
  if (!(X402_GATEWAY_REASON_CODES as readonly string[]).includes(reasonCode)) {
    return invalidTransitionResult();
  }
  if (gatewayTransferId !== null && !TRANSFER_UUID_PATTERN.test(gatewayTransferId)) {
    return invalidTransitionResult();
  }
  if (Number.isNaN(occurredAt.getTime())) {
    return invalidTransitionResult();
  }
  let occurredAtIso: string;
  try {
    occurredAtIso = occurredAt.toISOString();
  } catch {
    return invalidTransitionResult();
  }

  const loaded = await loadEventsForTransition(storePath, authorizationId);
  if (loaded.kind === "missing") {
    return notFoundResult();
  }
  if (loaded.kind === "corrupt") {
    return corruptResult();
  }
  const events = loaded.events;
  const current = events[events.length - 1];
  if (current.state !== "submitted") {
    if (current.state === "remote_outcome_unknown") {
      const existing = current as X402ExecutionRemoteOutcomeUnknownEvent;
      if (
        existing.nonce === nonce &&
        existing.reasonCode === reasonCode &&
        existing.gatewayTransferId === gatewayTransferId
      ) {
        return replayedResult();
      }
      return conflictResult();
    }
    return invalidTransitionResult();
  }
  const submitted = current as X402ExecutionSubmittedEvent;
  const prepared = events[0] as X402PreparedExecutionEvent;
  if (submitted.nonce !== nonce || prepared.nonce !== nonce) {
    return invalidTransitionResult();
  }

  const event: X402ExecutionRemoteOutcomeUnknownEvent = {
    eventType: "x402_execution_state",
    version: "v1",
    sequence: current.sequence + 1,
    state: "remote_outcome_unknown",
    authorizationId,
    occurredAt: occurredAtIso,
    nonce,
    reasonCode,
    gatewayTransferId
  };
  const outcome = await createEventFileExclusive(storePath, authorizationId, event);
  if (outcome === "exists") {
    return resolveTransitionRace(storePath, authorizationId, event);
  }
  return appliedResult(storePath, authorizationId);
}

/**
 * Read-only enumeration of authorization ids present in the store (used by
 * the I5 executed-spend reconciliation walker). Missing store → []. ANY
 * entry that is not a valid `auth_<64hex>` directory fails closed with
 * X402ExecutionStoreError — nothing is silently skipped, nothing is
 * mutated. Never follows or constructs paths from unvalidated names.
 */
export async function listX402ExecutionAuthorizations(storePath: string): Promise<string[]> {
  if (typeof storePath !== "string" || storePath.length === 0) {
    throw new X402ExecutionStoreError("storePath must be a non-empty string.");
  }
  const authRoot = join(storePath, "authorizations");
  let entries: Dirent[];
  try {
    entries = await readdir(authRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !AUTHORIZATION_ID_PATTERN.test(entry.name)) {
      throw new X402ExecutionStoreError(
        `unexpected entry in execution store authorizations directory: ${entry.name}.`
      );
    }
    ids.push(entry.name);
  }
  ids.sort();
  return ids;
}
