/**
 * I5.5 — SettlementEvidence: the strict, versioned contract for durable
 * settlement-outcome evidence (pre-Phase-9 Circle integration track).
 *
 * PURPOSE: record what AgentPay LOCALLY INTERPRETS a remote Gateway
 * settlement outcome to be, joined to trusted durable I3 evidence. Every
 * base-linkage field (authorizationId, parentAuthorizationId, auditId,
 * agentId, paymentRequirementDigest, signerPayloadDigest, network,
 * assetAddress, payerAddress, payTo, amountAtomic, nonce) comes from trusted
 * durable I3 evidence / locally validated objects — NEVER from a raw Gateway
 * response. The remote-interpretation fields (source, outcome,
 * gatewayTransferId, gatewayTransferStatus, gatewaySuccess,
 * gatewayErrorReason, batchTxHash) preserve official Gateway response values
 * VERBATIM (strictly validated against the official enums/formats from
 * `@/integrations/circle-gateway/contracts`); `outcome` is AgentPay's local
 * interpretation, not an official field.
 *
 * SEMANTICS (frozen by pre-i5-security-review.md):
 * - `gatewayTransferId` is the settle-response `transaction` field: a
 *   transfer UUID, NEVER an on-chain transaction hash. The batch-level chain
 *   hash is the separate `batchTxHash` (official `txHash`), shared by all
 *   transfers in the same batch and null until batched.
 * - Local `confirmed` requires official status `confirmed`; local
 *   `completed` requires `completed` (a stronger terminal state; the exact
 *   difference is not fully specified by Circle). `received`/`batched` mean
 *   funds locked/queued, not settled → local `accepted_pending` only.
 * - `remote_outcome_unknown` (timeout/reset/5xx/malformed/crash-after-send)
 *   carries NO invented Gateway fields: transferId, status, success,
 *   errorReason and batchTxHash MUST all be null. An unknown transport
 *   outcome is never `failed` and never `success:false` (no fabrication).
 * - The record contains NO private key, NO signature, NO raw signed
 *   PaymentPayload, NO raw Gateway body — only digests and official response
 *   fields.
 *
 * DIGEST: `fingerprintSettlementEvidence` returns
 * `sha256:<64 lowercase hex>` computed with `stableSha256`
 * (`src/lib/stable-json.ts`, key-sorted canonicalization → raw JSON key
 * insertion order is irrelevant) over the STRICTLY VALIDATED, normalized
 * object — never raw unknown JSON, never a partial object. The function
 * re-runs `validateSettlementEvidence` itself, so a digest can never be
 * taken over data that has not passed the full contract (all cross-field
 * consistency rules included). This exact string is what I5.7 passes to
 * `markX402ExecutionConfirmed({ settlementEvidenceDigest })`.
 *
 * FAIL CLOSED: unknown fields, malformed formats, and any cross-field
 * contradiction throw `SettlementEvidenceError` with a stable code. No
 * schema library; hand-rolled validators per repo convention.
 */
import { stableSha256 } from "@/lib/stable-json";
import {
  GATEWAY_SETTLE_ERROR_REASONS,
  GATEWAY_TRANSFER_STATUSES,
  type GatewaySettleErrorReason,
  type GatewayTransferStatus
} from "@/integrations/circle-gateway/contracts";

// ---------------------------------------------------------------------------
// Contract literals, enums.
// ---------------------------------------------------------------------------

export const SETTLEMENT_EVIDENCE_TYPE = "settlement_evidence" as const;
export const SETTLEMENT_EVIDENCE_VERSION = "v1" as const;

/** Where the remote interpretation was derived from. */
export type SettlementEvidenceSource =
  | "settle_response"
  | "transfer_snapshot"
  | "settle_transport";

export const SETTLEMENT_EVIDENCE_SOURCES: readonly SettlementEvidenceSource[] = [
  "settle_response",
  "transfer_snapshot",
  "settle_transport"
] as const;

/**
 * AgentPay's LOCAL interpretation of the settlement outcome (never an
 * official Gateway field; official values are preserved verbatim in the
 * `gateway*` fields alongside it).
 */
export type SettlementEvidenceOutcome =
  | "remote_outcome_unknown"
  | "accepted_pending"
  | "confirmed"
  | "completed"
  | "failed";

export const SETTLEMENT_EVIDENCE_OUTCOMES: readonly SettlementEvidenceOutcome[] = [
  "remote_outcome_unknown",
  "accepted_pending",
  "confirmed",
  "completed",
  "failed"
] as const;

// ---------------------------------------------------------------------------
// Record shape.
// ---------------------------------------------------------------------------

export type SettlementEvidence = {
  evidenceType: "settlement_evidence";
  version: "v1";
  // base linkage — ALWAYS from trusted durable I3 evidence / locally
  // validated objects, NEVER from a raw Gateway response:
  authorizationId: string; // auth_<64 lowercase hex>
  parentAuthorizationId: string; // auth_<64 lowercase hex> (I2 parent)
  auditId: string; // canonical policy audit record reference
  agentId: string; // self-asserted logical agent (ADD-1 residual)
  paymentRequirementDigest: string; // sha256:<64 lowercase hex>
  signerPayloadDigest: string; // sha256:<64 lowercase hex>
  network: string; // CAIP-2 EVM identifier
  assetAddress: string; // EVM address
  payerAddress: string; // EVM address (recovered EOA)
  payTo: string; // EVM address
  amountAtomic: string; // decimal atomic units, no leading zeros
  nonce: string; // 0x + 64 lowercase hex (EIP-3009 nonce)
  // remote interpretation:
  source: SettlementEvidenceSource;
  outcome: SettlementEvidenceOutcome;
  gatewayTransferId: string | null; // transfer UUID — NEVER a tx hash
  /** official enum, preserved verbatim */
  gatewayTransferStatus: GatewayTransferStatus | null;
  /** official settle `success`; null when no validated settle response exists */
  gatewaySuccess: boolean | null;
  /** official enum, preserved verbatim */
  gatewayErrorReason: GatewaySettleErrorReason | null;
  /** batch-level chain tx hash (official `txHash`); null until batched */
  batchTxHash: string | null;
  recordedAt: string; // ISO-8601 local durable-record timestamp
};

/**
 * Everything a builder must supply; the literal discriminants
 * (`evidenceType`, `version`) are pinned by `buildSettlementEvidence`.
 */
export type BuildSettlementEvidenceInput = Omit<
  SettlementEvidence,
  "evidenceType" | "version"
>;

// ---------------------------------------------------------------------------
// Error.
// ---------------------------------------------------------------------------

export type SettlementEvidenceErrorCode =
  | "SETTLEMENT_EVIDENCE_OBJECT_INVALID"
  | "SETTLEMENT_EVIDENCE_FIELD_MISSING"
  | "SETTLEMENT_EVIDENCE_UNKNOWN_FIELD"
  | "SETTLEMENT_EVIDENCE_FIELD_INVALID"
  | "SETTLEMENT_EVIDENCE_CONSISTENCY_FAILED";

/** Fail-closed contract error; carries a stable machine-readable code. */
export class SettlementEvidenceError extends Error {
  readonly code: SettlementEvidenceErrorCode;

  constructor(message: string, code: SettlementEvidenceErrorCode) {
    super(message);
    this.name = "SettlementEvidenceError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Official format patterns (same conventions as execution-store.ts and
// integrations/circle-gateway/contracts.ts).
// ---------------------------------------------------------------------------

const AUTHORIZATION_ID_PATTERN = /^auth_[0-9a-f]{64}$/;
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NETWORK_PATTERN = /^eip155:[1-9]\d*$/;
const AMOUNT_PATTERN = /^[1-9]\d*$/;
/** Official transfer `id` format: uuid (never a tx hash). */
const TRANSFER_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Batch-level settlement tx hash: 0x + 64 hex (never a UUID). */
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const EVIDENCE_KNOWN_FIELDS: Record<string, true> = {
  evidenceType: true,
  version: true,
  authorizationId: true,
  parentAuthorizationId: true,
  auditId: true,
  agentId: true,
  paymentRequirementDigest: true,
  signerPayloadDigest: true,
  network: true,
  assetAddress: true,
  payerAddress: true,
  payTo: true,
  amountAtomic: true,
  nonce: true,
  source: true,
  outcome: true,
  gatewayTransferId: true,
  gatewayTransferStatus: true,
  gatewaySuccess: true,
  gatewayErrorReason: true,
  batchTxHash: true,
  recordedAt: true
};

// ---------------------------------------------------------------------------
// Helper primitives (repo convention: hand-rolled, module-local).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function contractError(
  code: SettlementEvidenceErrorCode,
  message: string
): SettlementEvidenceError {
  return new SettlementEvidenceError(message, code);
}

function rejectUnknownFields(record: Record<string, unknown>): void {
  for (const field of Object.keys(record)) {
    if (!EVIDENCE_KNOWN_FIELDS[field]) {
      throw contractError(
        "SETTLEMENT_EVIDENCE_UNKNOWN_FIELD",
        `settlement evidence contains an unsupported field: ${field}.`
      );
    }
  }
}

function requireStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (value === undefined) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_MISSING",
      `settlement evidence is missing the required field "${field}".`
    );
  }
  if (typeof value !== "string" || value.length === 0) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_INVALID",
      `"${field}" must be a non-empty string.`
    );
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
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_INVALID",
      `"${field}" has an invalid format.`
    );
  }
  return value;
}

function requireNullablePatternField(
  record: Record<string, unknown>,
  field: string,
  pattern: RegExp
): string | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  return requirePatternField(record, field, pattern);
}

function requireEnumField<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T {
  const value = requireStringField(record, field);
  if (!(allowed as readonly string[]).includes(value)) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_INVALID",
      `"${field}" has an unsupported value: ${value}.`
    );
  }
  return value as T;
}

function requireNullableEnumField<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  return requireEnumField(record, field, allowed);
}

function requireNullableBooleanField(
  record: Record<string, unknown>,
  field: string
): boolean | null {
  const value = record[field];
  if (value === undefined) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_MISSING",
      `settlement evidence is missing the required field "${field}".`
    );
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_INVALID",
      `"${field}" must be a boolean or null.`
    );
  }
  return value;
}

function requireIsoTimestampField(record: Record<string, unknown>, field: string): string {
  const value = requireStringField(record, field);
  if (Number.isNaN(Date.parse(value))) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_INVALID",
      `"${field}" must be a valid ISO-8601 timestamp.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Cross-field consistency (fail closed).
// ---------------------------------------------------------------------------

function consistencyFail(message: string): SettlementEvidenceError {
  return contractError("SETTLEMENT_EVIDENCE_CONSISTENCY_FAILED", message);
}

/**
 * Every rule is a REQUIRED implication: violating it means the local
 * interpretation is not supported by the recorded official fields (or
 * invents official data), which is exactly what the frozen design forbids.
 */
function assertCrossFieldConsistency(evidence: SettlementEvidence): void {
  const {
    outcome,
    source,
    gatewayTransferId,
    gatewayTransferStatus,
    gatewaySuccess,
    gatewayErrorReason,
    batchTxHash
  } = evidence;

  switch (outcome) {
    case "confirmed":
      if (gatewayTransferStatus !== "confirmed") {
        throw consistencyFail(
          'outcome "confirmed" requires gatewayTransferStatus "confirmed" (official onchain confirmation).'
        );
      }
      break;
    case "completed":
      if (gatewayTransferStatus !== "completed") {
        throw consistencyFail(
          'outcome "completed" requires gatewayTransferStatus "completed" (official terminal status).'
        );
      }
      break;
    case "accepted_pending":
      if (gatewayTransferStatus !== "received" && gatewayTransferStatus !== "batched") {
        throw consistencyFail(
          'outcome "accepted_pending" requires gatewayTransferStatus "received" or "batched" (locked/queued, not settled).'
        );
      }
      break;
    case "failed":
      // Local `failed` = KNOWN deterministic rejection only: an official
      // errorReason, an official success:false, or an official failed status.
      if (
        gatewayErrorReason === null &&
        gatewaySuccess !== false &&
        gatewayTransferStatus !== "failed"
      ) {
        throw consistencyFail(
          'outcome "failed" requires a non-null gatewayErrorReason OR gatewaySuccess === false OR gatewayTransferStatus === "failed" (known deterministic rejection).'
        );
      }
      break;
    case "remote_outcome_unknown":
      // An unknown transport outcome carries NO invented Gateway fields —
      // never a fabricated success:false, never an assumed transfer id/status.
      if (
        gatewayTransferId !== null ||
        gatewayTransferStatus !== null ||
        gatewaySuccess !== null ||
        gatewayErrorReason !== null ||
        batchTxHash !== null
      ) {
        throw consistencyFail(
          'outcome "remote_outcome_unknown" requires gatewayTransferId, gatewayTransferStatus, gatewaySuccess, gatewayErrorReason and batchTxHash to all be null (no invented Gateway fields).'
        );
      }
      break;
  }

  if (source === "settle_transport" && outcome !== "remote_outcome_unknown") {
    throw consistencyFail(
      'source "settle_transport" requires outcome "remote_outcome_unknown" (a transport failure proves nothing about the remote outcome).'
    );
  }
  if (
    source === "transfer_snapshot" &&
    (gatewayTransferStatus === null || gatewayTransferId === null)
  ) {
    throw consistencyFail(
      'source "transfer_snapshot" requires a non-null gatewayTransferStatus and a non-null gatewayTransferId (a snapshot without an official status/id is not a transfer lookup result).'
    );
  }
}

// ---------------------------------------------------------------------------
// Validator.
// ---------------------------------------------------------------------------

/**
 * Strictly validates an unknown input into a normalized
 * `SettlementEvidence` (fixed field order, literals pinned, official values
 * preserved verbatim). Throws `SettlementEvidenceError` on unknown fields,
 * missing fields, malformed formats, or any cross-field contradiction.
 */
export function validateSettlementEvidence(input: unknown): SettlementEvidence {
  if (!isPlainObject(input)) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_OBJECT_INVALID",
      "settlement evidence must be a plain object."
    );
  }
  rejectUnknownFields(input);
  if (input.evidenceType !== SETTLEMENT_EVIDENCE_TYPE) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_INVALID",
      `"evidenceType" must be "${SETTLEMENT_EVIDENCE_TYPE}".`
    );
  }
  if (input.version !== SETTLEMENT_EVIDENCE_VERSION) {
    throw contractError(
      "SETTLEMENT_EVIDENCE_FIELD_INVALID",
      `"version" must be "${SETTLEMENT_EVIDENCE_VERSION}".`
    );
  }

  const evidence: SettlementEvidence = {
    evidenceType: SETTLEMENT_EVIDENCE_TYPE,
    version: SETTLEMENT_EVIDENCE_VERSION,
    authorizationId: requirePatternField(input, "authorizationId", AUTHORIZATION_ID_PATTERN),
    parentAuthorizationId: requirePatternField(input, "parentAuthorizationId", AUTHORIZATION_ID_PATTERN),
    auditId: requireStringField(input, "auditId"),
    agentId: requireStringField(input, "agentId"),
    paymentRequirementDigest: requirePatternField(input, "paymentRequirementDigest", DIGEST_PATTERN),
    signerPayloadDigest: requirePatternField(input, "signerPayloadDigest", DIGEST_PATTERN),
    network: requirePatternField(input, "network", NETWORK_PATTERN),
    assetAddress: requirePatternField(input, "assetAddress", EVM_ADDRESS_PATTERN),
    payerAddress: requirePatternField(input, "payerAddress", EVM_ADDRESS_PATTERN),
    payTo: requirePatternField(input, "payTo", EVM_ADDRESS_PATTERN),
    amountAtomic: requirePatternField(input, "amountAtomic", AMOUNT_PATTERN),
    nonce: requirePatternField(input, "nonce", NONCE_PATTERN),
    source: requireEnumField(input, "source", SETTLEMENT_EVIDENCE_SOURCES),
    outcome: requireEnumField(input, "outcome", SETTLEMENT_EVIDENCE_OUTCOMES),
    gatewayTransferId: requireNullablePatternField(input, "gatewayTransferId", TRANSFER_ID_PATTERN),
    gatewayTransferStatus: requireNullableEnumField(input, "gatewayTransferStatus", GATEWAY_TRANSFER_STATUSES),
    gatewaySuccess: requireNullableBooleanField(input, "gatewaySuccess"),
    gatewayErrorReason: requireNullableEnumField(input, "gatewayErrorReason", GATEWAY_SETTLE_ERROR_REASONS),
    batchTxHash: requireNullablePatternField(input, "batchTxHash", TX_HASH_PATTERN),
    recordedAt: requireIsoTimestampField(input, "recordedAt")
  };

  assertCrossFieldConsistency(evidence);
  return evidence;
}

/**
 * Pure builder: pins the literals and round-trips the object through
 * `validateSettlementEvidence`, so the returned value is ALWAYS the strictly
 * validated, normalized form (fixed field order, no extras).
 */
export function buildSettlementEvidence(
  input: BuildSettlementEvidenceInput
): SettlementEvidence {
  return validateSettlementEvidence({
    evidenceType: SETTLEMENT_EVIDENCE_TYPE,
    version: SETTLEMENT_EVIDENCE_VERSION,
    ...input
  });
}

// ---------------------------------------------------------------------------
// Digest.
// ---------------------------------------------------------------------------

/**
 * `sha256:<64 lowercase hex>` over the stable-JSON canonicalized
 * (key-sorted) SettlementEvidence. The input is RE-VALIDATED first: the
 * digest is computed over the STRICTLY VALIDATED, normalized object — never
 * raw unknown JSON, never a partial object. Raw JSON key insertion order is
 * irrelevant (canonicalization sorts keys); any contract-relevant field
 * change (identifiers, amounts, official fields, local outcome, timestamp)
 * changes the digest.
 */
export function fingerprintSettlementEvidence(evidence: SettlementEvidence): string {
  const validated = validateSettlementEvidence(evidence);
  return `sha256:${stableSha256(validated)}`;
}

/**
 * Official transfer identifier format (uuid). Exported so the durable store
 * can guard path construction from unvalidated strings. A transfer UUID is
 * NEVER an on-chain transaction hash (and vice versa).
 */
export function isGatewayTransferId(value: unknown): value is string {
  return typeof value === "string" && TRANSFER_ID_PATTERN.test(value);
}
