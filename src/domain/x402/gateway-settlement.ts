/**
 * I5 — Gateway settlement orchestration + reconciliation
 * (`submitX402GatewaySettlement` / `reconcileX402GatewayOutcome` /
 * `finishX402GatewayConfirmation`).
 *
 * PURPOSE: the ONLY path that talks to the Circle Gateway testnet for a
 * settlement (via an INJECTED `GatewayTestnetClient` — this module performs
 * no fetch itself), interprets the remote outcome into the strict
 * SettlementEvidence contract, persists it durably, and only then advances
 * the I3 execution state machine. Design frozen by
 * `docs/grants/circle-grants-2026/pre-i5-security-review.md`.
 *
 * SAFETY RULES ENFORCED HERE:
 * - Every pre-submit guard fails CLOSED with ZERO transport calls, and
 *   durable state is ALWAYS re-read from disk — an in-memory record object
 *   is never trusted.
 * - THIRD Guard-expiry check immediately before `settle` (`now < expiresAt`
 *   strictly; `now === expiresAt` and unparseable expiry reject). The
 *   EIP-3009 `validBefore` window is a SEPARATE control and NEVER overrides
 *   Guard expiry.
 * - NO AUTOMATIC RE-SIGN: a lost transient signed payload is reconciled by
 *   nonce. If no remote outcome can be established and the Guard
 *   authorization has expired, a fresh Guard authorization lineage is
 *   required — this module never signs, never re-derives a validity window,
 *   and never retries `settle` after any remote ambiguity.
 * - Ambiguous remote outcomes (timeout/reset/5xx/malformed/oversized/
 *   redirect) are NEVER `failed` and NEVER retried: durable
 *   `remote_outcome_unknown` evidence first, then the I3
 *   `remote_outcome_unknown` transition.
 * - Confirmation ordering (mandatory): validate → build normalized evidence
 *   → PERSIST durably → digest → I3 transition. A failed/conflicting
 *   evidence append performs NO transition.
 * - Raw HTTP text is never security state: only `X402_GATEWAY_*` reason
 *   codes from `./gateway-reason-codes` leave this module.
 * - The network allowlist and the transfer-token binding are read from the
 *   CURRENT policy (`data/policies.default.json` via `loadPolicyConfig`) —
 *   never a hardcoded second copy.
 */
import { loadPolicyConfig, type X402ExecutionPolicyEntry } from "@/domain/policy/policy-config";
import { policyPath } from "@/lib/paths";
import {
  GATEWAY_SETTLE_ERROR_REASONS,
  type GatewaySettleErrorReason,
  type GatewaySettleResponse,
  type GatewayTransferSnapshot,
  type GatewayTransferStatus
} from "@/integrations/circle-gateway/contracts";
import type { GatewayTestnetClient } from "@/integrations/circle-gateway/testnet-client";
import {
  fingerprintX402PaymentRequirement,
  validateX402PaymentRequirement,
  type X402PaymentRequirement
} from "./payment-requirement";
import { signerPayloadDigest, type X402SignedPaymentPayload } from "./external-signer";
import {
  markX402ExecutionConfirmed,
  markX402ExecutionFailed,
  markX402ExecutionRemoteOutcomeUnknown,
  readX402ExecutionRecord,
  type X402ExecutionRecord,
  type X402ExecutionState
} from "./execution-store";
import {
  buildSettlementEvidence,
  fingerprintSettlementEvidence,
  isGatewayTransferId,
  type SettlementEvidence,
  type SettlementEvidenceOutcome
} from "./settlement-evidence";
import {
  appendSettlementEvidence,
  latestSettlementEvidence,
  X402_SETTLEMENT_EVIDENCE_APPENDED,
  X402_SETTLEMENT_EVIDENCE_EQUIVALENT
} from "./settlement-evidence-store";
import {
  X402_GATEWAY_AUTHORIZATION_EXPIRED,
  X402_GATEWAY_BINDING_MISMATCH,
  X402_GATEWAY_EXECUTION_NOT_FOUND,
  X402_GATEWAY_EXECUTION_NOT_SUBMITTED,
  X402_GATEWAY_KNOWN_REJECTION,
  X402_GATEWAY_NETWORK_NOT_ALLOWED,
  X402_GATEWAY_NONCE_ALREADY_USED_RECONCILE_REQUIRED,
  X402_GATEWAY_PAYLOAD_DIGEST_MISMATCH,
  X402_GATEWAY_REASON_CODES,
  X402_GATEWAY_RECOVERY_METADATA_MISSING,
  X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN,
  X402_GATEWAY_REMOTE_TRANSFER_MISMATCH,
  X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH,
  X402_GATEWAY_RESPONSE_INVALID,
  X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT,
  X402_GATEWAY_STATE_CONFLICT,
  X402_GATEWAY_TRANSFER_CONFIRMED,
  X402_GATEWAY_TRANSFER_FAILED,
  X402_GATEWAY_TRANSFER_PENDING,
  type X402GatewayReasonCode
} from "./gateway-reason-codes";

// ---------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------

export type X402GatewaySettlementResult = {
  reasonCode: X402GatewayReasonCode;
  /** Local interpretation of the last durable evidence/state decision (null when nothing was written or decided). */
  outcome: SettlementEvidenceOutcome | null;
  /** Current durable I3 state (null when the record is missing/unreadable). */
  executionState: X402ExecutionState | null;
  settlementEvidenceDigest: string | null;
  gatewayTransferId: string | null;
  gatewayTransferStatus: GatewayTransferStatus | null;
};

// ---------------------------------------------------------------------------
// Internal types.
// ---------------------------------------------------------------------------

/** Store paths + explicit clock every orchestration step operates on. */
type OrchestrationContext = {
  storePath: string;
  settlementEvidenceStorePath: string;
  authorizationId: string;
  now: Date;
};

/**
 * The 12 immutable base-linkage fields of SettlementEvidence, taken
 * EXCLUSIVELY from trusted durable I3 evidence (validated re-reads), never
 * from a Gateway response.
 */
type EvidenceBaseLinkage = Pick<
  SettlementEvidence,
  | "authorizationId"
  | "parentAuthorizationId"
  | "auditId"
  | "agentId"
  | "paymentRequirementDigest"
  | "signerPayloadDigest"
  | "network"
  | "assetAddress"
  | "payerAddress"
  | "payTo"
  | "amountAtomic"
  | "nonce"
>;

/** Durable record read: null = not found; "corrupt" = unreadable store. */
type DurableRead =
  | { kind: "record"; record: X402ExecutionRecord }
  | { kind: "not_found" }
  | { kind: "corrupt" };

/** Latest-evidence read outcome, including the fail-closed corrupt case. */
type LatestEvidenceRead = SettlementEvidence | null | "corrupt";

// ---------------------------------------------------------------------------
// Internal helpers (hand-rolled, repo convention).
// ---------------------------------------------------------------------------

/** Case-insensitive EVM address semantic equality (repo convention). */
function evmAddressesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isKnownGatewayReasonCode(value: string): value is X402GatewayReasonCode {
  return (X402_GATEWAY_REASON_CODES as readonly string[]).includes(value);
}

function isGatewayErrorReason(value: string): value is GatewaySettleErrorReason {
  return (GATEWAY_SETTLE_ERROR_REASONS as readonly string[]).includes(value);
}

/** The CURRENT policy x402 allowlist; null when the policy cannot be read. */
function loadAllowedRequirements(): X402ExecutionPolicyEntry[] | null {
  try {
    return loadPolicyConfig(policyPath()).x402Execution.allowedRequirements;
  } catch {
    return null;
  }
}

function failClosed(
  reasonCode: X402GatewayReasonCode,
  executionState: X402ExecutionState | null = null
): X402GatewaySettlementResult {
  return {
    reasonCode,
    outcome: null,
    executionState,
    settlementEvidenceDigest: null,
    gatewayTransferId: null,
    gatewayTransferStatus: null
  };
}

async function readDurable(storePath: string, authorizationId: string): Promise<DurableRead> {
  try {
    const record = await readX402ExecutionRecord(storePath, authorizationId);
    return record === null ? { kind: "not_found" } : { kind: "record", record };
  } catch {
    // X402ExecutionStoreError (corrupt history) and any other read failure
    // are the same fail-closed outcome.
    return { kind: "corrupt" };
  }
}

async function durableState(
  storePath: string,
  authorizationId: string
): Promise<X402ExecutionState | null> {
  const durable = await readDurable(storePath, authorizationId);
  return durable.kind === "record" ? durable.record.state : null;
}

async function readLatestEvidence(
  settlementEvidenceStorePath: string,
  authorizationId: string
): Promise<LatestEvidenceRead> {
  try {
    return await latestSettlementEvidence(settlementEvidenceStorePath, authorizationId);
  } catch {
    return "corrupt";
  }
}

/**
 * Base linkage for every snapshot, derived from the durable record. Requires
 * a submitted block with complete recovery metadata (guaranteed by the
 * `_RECOVERY_METADATA_MISSING` guard); null is the defensive fail-closed
 * branch.
 */
function baseLinkageOf(
  record: X402ExecutionRecord,
  payloadDigest: string
): EvidenceBaseLinkage | null {
  const { prepared } = record;
  const submitted = record.submitted;
  if (
    submitted === undefined ||
    !submitted.recoveryMetadataComplete ||
    submitted.payerAddress === null
  ) {
    return null;
  }
  return {
    authorizationId: prepared.authorizationId,
    parentAuthorizationId: prepared.parentAuthorizationId,
    auditId: prepared.auditId,
    agentId: prepared.agentId,
    paymentRequirementDigest: prepared.paymentRequirementDigest,
    signerPayloadDigest: payloadDigest,
    network: prepared.network,
    assetAddress: prepared.assetAddress,
    payerAddress: submitted.payerAddress,
    payTo: prepared.payTo,
    amountAtomic: prepared.amountAtomic,
    nonce: prepared.nonce
  };
}

/**
 * Persist one evidence snapshot; returns the durable digest on APPENDED or
 * EQUIVALENT (both mean "we have the digest"), null on CONFLICT /
 * SEQUENCE_CONFLICT / any store or contract failure — so a null result
 * guarantees the caller performs NO I3 transition.
 */
async function persistEvidence(
  settlementEvidenceStorePath: string,
  evidence: SettlementEvidence
): Promise<string | null> {
  try {
    const result = await appendSettlementEvidence({
      storePath: settlementEvidenceStorePath,
      evidence
    });
    // APPENDED and EQUIVALENT both mean "the snapshot is durable and we hold
    // ITS digest". CONFLICT also reports a non-null digest (the EXISTING,
    // contradictory snapshot's) — it must NEVER be treated as persisted: a
    // null return here is what guarantees callers perform NO I3 transition.
    if (
      result.reasonCode === X402_SETTLEMENT_EVIDENCE_APPENDED ||
      result.reasonCode === X402_SETTLEMENT_EVIDENCE_EQUIVALENT
    ) {
      return result.evidenceDigest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ambiguous remote outcome: append `remote_outcome_unknown` evidence (NO
 * invented Gateway fields — every remote field null; source
 * "settle_transport" is the contract's transport-ambiguity marker), then the
 * idempotent I3 `remote_outcome_unknown` transition. NEVER failed, NEVER
 * retried. The transport's own frozen reason code is reported when it is one
 * of the shared `X402_GATEWAY_*` codes; otherwise `_REMOTE_OUTCOME_UNKNOWN`.
 */
async function persistAmbiguousOutcome(
  context: OrchestrationContext,
  record: X402ExecutionRecord,
  base: EvidenceBaseLinkage,
  transportReasonCode: string
): Promise<X402GatewaySettlementResult> {
  const { storePath, settlementEvidenceStorePath, authorizationId, now } = context;
  const mapped: X402GatewayReasonCode = isKnownGatewayReasonCode(transportReasonCode)
    ? transportReasonCode
    : X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN;
  const evidence = buildSettlementEvidence({
    ...base,
    source: "settle_transport",
    outcome: "remote_outcome_unknown",
    gatewayTransferId: null,
    gatewayTransferStatus: null,
    gatewaySuccess: null,
    gatewayErrorReason: null,
    batchTxHash: null,
    recordedAt: now.toISOString()
  });
  const digest = await persistEvidence(settlementEvidenceStorePath, evidence);
  if (digest === null) {
    return failClosed(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT, record.state);
  }
  const transition = await markX402ExecutionRemoteOutcomeUnknown({
    storePath,
    authorizationId,
    nonce: record.prepared.nonce,
    reasonCode: mapped,
    gatewayTransferId: null,
    occurredAt: now
  });
  if (!transition.applied && transition.reasonCode !== "X402_EXECUTION_TRANSITION_REPLAYED") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
  }
  const state = transition.applied
    ? transition.record.state
    : await durableState(storePath, authorizationId);
  return {
    reasonCode: mapped,
    outcome: "remote_outcome_unknown",
    executionState: state,
    settlementEvidenceDigest: digest,
    gatewayTransferId: null,
    gatewayTransferStatus: null
  };
}

/**
 * Known-rejection classification of a parsed settle body (HTTP 4xx or
 * 200 + success:false): `nonce_already_used` is NOT terminal here (the nonce
 * may have been accepted earlier — the caller must reconcile; NEVER settle
 * again). Any other valid official `errorReason` is a durable failure:
 * evidence FIRST, then the I3 failed transition. A body without a mappable
 * rejection is ambiguous, never failed.
 */
async function classifySettleRejection(
  context: OrchestrationContext,
  record: X402ExecutionRecord,
  base: EvidenceBaseLinkage,
  response: GatewaySettleResponse
): Promise<X402GatewaySettlementResult> {
  const { storePath, settlementEvidenceStorePath, authorizationId, now } = context;
  if (response.errorReason === "nonce_already_used") {
    // NOT terminal: append nothing, mark nothing, never re-settle.
    return {
      reasonCode: X402_GATEWAY_NONCE_ALREADY_USED_RECONCILE_REQUIRED,
      outcome: null,
      executionState: record.state,
      settlementEvidenceDigest: null,
      gatewayTransferId: null,
      gatewayTransferStatus: null
    };
  }
  if (response.success || response.errorReason === null || !isGatewayErrorReason(response.errorReason)) {
    // "success" on a 4xx, or a rejection without a mappable official
    // errorReason: untrustworthy body — ambiguous, never failed.
    return persistAmbiguousOutcome(
      context,
      record,
      base,
      X402_GATEWAY_RESPONSE_INVALID
    );
  }
  const evidence = buildSettlementEvidence({
    ...base,
    source: "settle_response",
    outcome: "failed",
    gatewayTransferId: isGatewayTransferId(response.transaction) ? response.transaction : null,
    gatewayTransferStatus: null,
    gatewaySuccess: false,
    gatewayErrorReason: response.errorReason,
    batchTxHash: null,
    recordedAt: now.toISOString()
  });
  const digest = await persistEvidence(settlementEvidenceStorePath, evidence);
  if (digest === null) {
    return failClosed(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT, record.state);
  }
  const transition = await markX402ExecutionFailed({
    storePath,
    authorizationId,
    failureStage: "settle",
    failureCode: X402_GATEWAY_KNOWN_REJECTION,
    occurredAt: now
  });
  if (!transition.applied && transition.reasonCode !== "X402_EXECUTION_TRANSITION_REPLAYED") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
  }
  const state = transition.applied
    ? transition.record.state
    : await durableState(storePath, authorizationId);
  return {
    reasonCode: X402_GATEWAY_KNOWN_REJECTION,
    outcome: "failed",
    executionState: state,
    settlementEvidenceDigest: digest,
    gatewayTransferId: evidence.gatewayTransferId,
    gatewayTransferStatus: null
  };
}

// ---------------------------------------------------------------------------
// Submit.
// ---------------------------------------------------------------------------

/**
 * Submit an I4-signed payload for settlement after the full fail-closed
 * pre-submit sequence (guards 1–7 all have ZERO transport calls):
 * (1) durable re-read — corrupt store → `_STATE_CONFLICT`, missing record →
 * `_EXECUTION_NOT_FOUND`; (2) state must be `submitted` →
 * `_EXECUTION_NOT_SUBMITTED`; (3) `submitted.recoveryMetadataComplete` →
 * `_RECOVERY_METADATA_MISSING` (legacy pre-I5 record); (4)
 * `signerPayloadDigest(signedPayload)` === durable digest →
 * `_PAYLOAD_DIGEST_MISMATCH`; (5) I1 validation + requirement fingerprint ===
 * durable digest → `_REQUIREMENT_DIGEST_MISMATCH`; (6) binding — requirement
 * network/asset/payTo/amount vs durable (case-insensitive addresses, exact
 * amount), network against the CURRENT policy allowlist, payload payer vs
 * durable payer → `_BINDING_MISMATCH` / `_NETWORK_NOT_ALLOWED`; (7) THIRD
 * Guard-expiry check (`now < expiresAt` strictly) immediately before the
 * transport call → `_AUTHORIZATION_EXPIRED`; (8) exactly ONE
 * `client.settle` call.
 */
export async function submitX402GatewaySettlement(input: {
  storePath: string;
  settlementEvidenceStorePath: string;
  authorizationId: string;
  paymentRequirement: X402PaymentRequirement;
  signedPayload: X402SignedPaymentPayload;
  now: Date;
  client: GatewayTestnetClient;
}): Promise<X402GatewaySettlementResult> {
  const { storePath, settlementEvidenceStorePath, authorizationId, paymentRequirement, signedPayload, now, client } =
    input;
  const context: OrchestrationContext = { storePath, settlementEvidenceStorePath, authorizationId, now };

  // (1) ALWAYS re-read durable state — in-memory objects are never trusted.
  const durable = await readDurable(storePath, authorizationId);
  if (durable.kind === "corrupt") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT);
  }
  if (durable.kind === "not_found") {
    return failClosed(X402_GATEWAY_EXECUTION_NOT_FOUND);
  }
  const record = durable.record;
  const { prepared } = record;

  // (2) only a `submitted` execution may settle.
  if (record.state !== "submitted") {
    return failClosed(X402_GATEWAY_EXECUTION_NOT_SUBMITTED, record.state);
  }
  const submitted = record.submitted;

  // (3) legacy pre-I5 record: without the full recovery metadata block the
  // binding cannot be proven — fail closed (never re-derive, never re-sign).
  if (submitted === undefined || !submitted.recoveryMetadataComplete) {
    return failClosed(X402_GATEWAY_RECOVERY_METADATA_MISSING, record.state);
  }

  // (4) the payload must be EXACTLY the one I4 digested into the durable
  // submitted event (any signature/amount/recipient/nonce substitution
  // changes the digest).
  const payloadDigest = signerPayloadDigest(signedPayload);
  if (payloadDigest !== submitted.signerPayloadDigest) {
    return failClosed(X402_GATEWAY_PAYLOAD_DIGEST_MISMATCH, record.state);
  }

  // (5) I1 strict validation + requirement digest binding.
  let requirement: X402PaymentRequirement;
  try {
    requirement = validateX402PaymentRequirement(paymentRequirement);
  } catch {
    return failClosed(X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH, record.state);
  }
  if (fingerprintX402PaymentRequirement(requirement) !== prepared.paymentRequirementDigest) {
    return failClosed(X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH, record.state);
  }

  // (6) binding: requirement fields === durable prepared (addresses
  // case-insensitive, amount exact string), payload payer === durable
  // submitted payer.
  if (
    requirement.network !== prepared.network ||
    !evmAddressesEqual(requirement.asset, prepared.assetAddress) ||
    !evmAddressesEqual(requirement.payTo, prepared.payTo) ||
    requirement.amount !== prepared.amountAtomic
  ) {
    return failClosed(X402_GATEWAY_BINDING_MISMATCH, record.state);
  }
  if (
    submitted.payerAddress === null ||
    !evmAddressesEqual(signedPayload.payload.authorization.from, submitted.payerAddress)
  ) {
    return failClosed(X402_GATEWAY_BINDING_MISMATCH, record.state);
  }
  // network must be on the CURRENT policy allowlist (read from data/, never
  // hardcoded); an unreadable/unbindable policy fails closed.
  const allowed = loadAllowedRequirements();
  if (
    allowed === null ||
    !allowed.some(
      (entry) =>
        entry.network === prepared.network &&
        evmAddressesEqual(entry.asset, prepared.assetAddress)
    )
  ) {
    return failClosed(X402_GATEWAY_NETWORK_NOT_ALLOWED, record.state);
  }

  // (7) THIRD Guard-expiry check, immediately before the transport call.
  // NaN `now` and unparseable expiry fail closed as EXPIRED. EIP-3009
  // `validBefore` NEVER overrides the Guard expiry.
  const nowMs = now.getTime();
  const expiresAtMs = Date.parse(prepared.authorizationExpiresAt);
  if (Number.isNaN(nowMs) || Number.isNaN(expiresAtMs) || !(nowMs < expiresAtMs)) {
    // `now === expiresAt` rejects.
    return failClosed(X402_GATEWAY_AUTHORIZATION_EXPIRED, record.state);
  }

  // (8) exactly one settle call — never retried from this module.
  const settleResult = await client.settle(
    { paymentPayload: signedPayload, paymentRequirements: requirement },
    undefined
  );

  const base = baseLinkageOf(record, payloadDigest);
  if (base === null) {
    // Defensive: unreachable after guard (3); fail closed without settling state.
    return failClosed(X402_GATEWAY_RECOVERY_METADATA_MISSING, record.state);
  }

  if (settleResult.kind === "unknown") {
    // timeout / reset / 5xx / malformed / oversized / redirect.
    return persistAmbiguousOutcome(context, record, base, settleResult.reasonCode);
  }

  if (settleResult.response.network !== prepared.network) {
    // A validated response describing a DIFFERENT network proves nothing
    // about this execution: fail closed, no confirmed-kind change.
    return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
  }

  if (settleResult.httpStatus >= 500) {
    // An HTTP 5xx goes to the ambiguous path EVEN WHEN the body parses.
    return persistAmbiguousOutcome(context, record, base, settleResult.response.errorReason ?? X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN);
  }
  if (settleResult.httpStatus >= 400) {
    return classifySettleRejection(context, record, base, settleResult.response);
  }
  if (settleResult.httpStatus !== 200) {
    // Any unexpected status: outcome not interpretable — ambiguous.
    return persistAmbiguousOutcome(context, record, base, X402_GATEWAY_RESPONSE_INVALID);
  }

  const response = settleResult.response;
  if (!response.success) {
    // 200 + success:false → same deterministic-rejection class as 4xx.
    return classifySettleRejection(context, record, base, response);
  }
  if (!isGatewayTransferId(response.transaction)) {
    // Success without a contract-valid transfer UUID: untrustworthy.
    return persistAmbiguousOutcome(context, record, base, X402_GATEWAY_RESPONSE_INVALID);
  }
  // success:true confirms ACCEPTANCE only. The frozen I2 evidence contract
  // REQUIRES outcome "accepted_pending" to carry official status "received"
  // or "batched" (settle acceptance is the official `received` — "submitted
  // and accepted"), so the snapshot records "received"; the local record
  // STAYS submitted — confirmation requires an observed `confirmed`/
  // `completed` transfer snapshot from reconciliation.
  const evidence = buildSettlementEvidence({
    ...base,
    source: "settle_response",
    outcome: "accepted_pending",
    gatewayTransferId: response.transaction,
    gatewayTransferStatus: "received",
    gatewaySuccess: true,
    gatewayErrorReason: null,
    batchTxHash: null,
    recordedAt: now.toISOString()
  });
  const digest = await persistEvidence(settlementEvidenceStorePath, evidence);
  if (digest === null) {
    return failClosed(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT, record.state);
  }
  return {
    reasonCode: X402_GATEWAY_TRANSFER_PENDING,
    outcome: "accepted_pending",
    executionState: record.state,
    settlementEvidenceDigest: digest,
    gatewayTransferId: response.transaction,
    gatewayTransferStatus: "received"
  };
}

// ---------------------------------------------------------------------------
// Reconcile.
// ---------------------------------------------------------------------------

/**
 * Nonce-keyed reconciliation of a `submitted` or `remote_outcome_unknown`
 * execution via `listTransfersByNonce` (NEVER retries settle, NEVER marks
 * failed on ambiguity, NEVER frees at-risk accounting):
 * - unknown list result or zero identity-matching transfers → no
 *   trustworthy outcome: from `submitted` enter `remote_outcome_unknown`
 *   (durable unknown evidence + I3 transition); from
 *   `remote_outcome_unknown` change nothing → `_REMOTE_OUTCOME_UNKNOWN`;
 * - identity filter keeps ONLY transfers matching ALL durable bindings
 *   (nonce, payer, payTo, exact amount, both networks, and the token SYMBOL
 *   the CURRENT policy allowlist binds to the durable asset address — no
 *   bindable symbol → fail closed `_REMOTE_TRANSFER_MISMATCH`, documented
 *   residual); two or more matches → `_REMOTE_TRANSFER_MISMATCH`, nothing
 *   written, never an arbitrary pick;
 * - one match is refined through `getTransfer` (unknown/not_found falls back
 *   to the list snapshot; a mismatching refinement → `_REMOTE_TRANSFER_MISMATCH`);
 * - `received`/`batched` → NEW `accepted_pending` snapshot → `_TRANSFER_PENDING`;
 * - `confirmed`/`completed` → snapshot, persist, digest, idempotent I3
 *   confirmed → `_TRANSFER_CONFIRMED` (official status preserved verbatim);
 * - `failed` → `failed` snapshot → I3 failed(settle) → `_TRANSFER_FAILED`.
 */
export async function reconcileX402GatewayOutcome(input: {
  storePath: string;
  settlementEvidenceStorePath: string;
  authorizationId: string;
  now: Date;
  client: GatewayTestnetClient;
}): Promise<X402GatewaySettlementResult> {
  const { storePath, settlementEvidenceStorePath, authorizationId, now, client } = input;
  const context: OrchestrationContext = { storePath, settlementEvidenceStorePath, authorizationId, now };

  const durable = await readDurable(storePath, authorizationId);
  if (durable.kind === "corrupt") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT);
  }
  if (durable.kind === "not_found") {
    return failClosed(X402_GATEWAY_EXECUTION_NOT_FOUND);
  }
  const record = durable.record;
  const { prepared } = record;
  if (record.state === "confirmed" || record.state === "failed") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
  }
  if (record.state === "prepared") {
    return failClosed(X402_GATEWAY_EXECUTION_NOT_SUBMITTED, record.state);
  }
  const submitted = record.submitted;
  if (
    submitted === undefined ||
    !submitted.recoveryMetadataComplete ||
    submitted.payerAddress === null
  ) {
    // Identity filtering is impossible without the durable payer.
    return failClosed(X402_GATEWAY_RECOVERY_METADATA_MISSING, record.state);
  }
  const payerAddress: string = submitted.payerAddress;
  const base = baseLinkageOf(record, submitted.signerPayloadDigest);
  if (base === null) {
    return failClosed(X402_GATEWAY_RECOVERY_METADATA_MISSING, record.state);
  }

  // Token binding: the official transfer snapshot carries a SYMBOL, not an
  // address; the ONLY trusted derivation is the current policy allowlist
  // entry bound to the durable asset address. Residual (documented): if the
  // policy binds no symbol to that address, identity filtering is impossible
  // and reconciliation FAILS CLOSED (`_REMOTE_TRANSFER_MISMATCH`) rather
  // than guessing an asset identity.
  const assetSymbol =
    loadAllowedRequirements()?.find(
      (entry) =>
        entry.network === prepared.network &&
        evmAddressesEqual(entry.asset, prepared.assetAddress)
    )?.assetSymbol ?? null;
  if (assetSymbol === null) {
    return failClosed(X402_GATEWAY_REMOTE_TRANSFER_MISMATCH, record.state);
  }

  // Durable identity filter: keep ONLY transfers matching every binding.
  const identityMatches = (transfer: GatewayTransferSnapshot): boolean =>
    transfer.nonce === prepared.nonce &&
    evmAddressesEqual(transfer.payerAddress, payerAddress) &&
    evmAddressesEqual(transfer.payToAddress, prepared.payTo) &&
    transfer.amountAtomic === prepared.amountAtomic &&
    transfer.sendingNetwork === prepared.network &&
    transfer.recipientNetwork === prepared.network &&
    transfer.token === assetSymbol;

  const list = await client.listTransfersByNonce(prepared.nonce, undefined);
  if (list.kind !== "response" || list.transfers.length === 0) {
    return await reportNoTrustworthyOutcome(context, record, base);
  }
  const candidates = list.transfers.filter(identityMatches);
  if (candidates.length === 0) {
    return await reportNoTrustworthyOutcome(context, record, base);
  }
  if (candidates.length >= 2) {
    // Ambiguous remote state: fail closed, nothing written, never an
    // arbitrary pick.
    return failClosed(X402_GATEWAY_REMOTE_TRANSFER_MISMATCH, record.state);
  }

  // Deterministic refinement through the transfer endpoint (read-only):
  // unknown/not_found keeps the list snapshot; a refinement contradicting
  // the durable identity fails closed.
  let transfer: GatewayTransferSnapshot = candidates[0];
  const refined = await client.getTransfer(transfer.transferId, undefined);
  if (refined.kind === "response") {
    if (!identityMatches(refined.transfer)) {
      return failClosed(X402_GATEWAY_REMOTE_TRANSFER_MISMATCH, record.state);
    }
    transfer = refined.transfer;
  }

  const status: GatewayTransferStatus = transfer.status;
  if (status === "received" || status === "batched") {
    // Locked/queued, not settled: a NEW accepted_pending snapshot (never
    // overwrite, never confirm); no I3 transition is available here.
    const evidence = buildSettlementEvidence({
      ...base,
      source: "transfer_snapshot",
      outcome: "accepted_pending",
      gatewayTransferId: transfer.transferId,
      gatewayTransferStatus: status,
      gatewaySuccess: null,
      gatewayErrorReason: null,
      batchTxHash: transfer.batchTxHash,
      recordedAt: now.toISOString()
    });
    const digest = await persistEvidence(settlementEvidenceStorePath, evidence);
    if (digest === null) {
      return failClosed(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT, record.state);
    }
    return {
      reasonCode: X402_GATEWAY_TRANSFER_PENDING,
      outcome: "accepted_pending",
      executionState: record.state,
      settlementEvidenceDigest: digest,
      gatewayTransferId: transfer.transferId,
      gatewayTransferStatus: status
    };
  }

  if (status === "failed") {
    // An official `failed` status is a known deterministic rejection.
    const evidence = buildSettlementEvidence({
      ...base,
      source: "transfer_snapshot",
      outcome: "failed",
      gatewayTransferId: transfer.transferId,
      gatewayTransferStatus: "failed",
      gatewaySuccess: null,
      gatewayErrorReason: null,
      batchTxHash: transfer.batchTxHash,
      recordedAt: now.toISOString()
    });
    const digest = await persistEvidence(settlementEvidenceStorePath, evidence);
    if (digest === null) {
      return failClosed(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT, record.state);
    }
    const transition = await markX402ExecutionFailed({
      storePath,
      authorizationId,
      failureStage: "settle",
      failureCode: X402_GATEWAY_TRANSFER_FAILED,
      occurredAt: now
    });
    if (!transition.applied && transition.reasonCode !== "X402_EXECUTION_TRANSITION_REPLAYED") {
      return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
    }
    const state = transition.applied
      ? transition.record.state
      : await durableState(storePath, authorizationId);
    return {
      reasonCode: X402_GATEWAY_TRANSFER_FAILED,
      outcome: "failed",
      executionState: state,
      settlementEvidenceDigest: digest,
      gatewayTransferId: transfer.transferId,
      gatewayTransferStatus: "failed"
    };
  }

  // status === "confirmed" | "completed": the ONLY local-confirmation
  // thresholds. The official status is preserved verbatim (completed is
  // stronger than confirmed; never claim completed when only confirmed).
  const outcome: SettlementEvidenceOutcome = status === "confirmed" ? "confirmed" : "completed";
  const evidence = buildSettlementEvidence({
    ...base,
    source: "transfer_snapshot",
    outcome,
    gatewayTransferId: transfer.transferId,
    gatewayTransferStatus: status,
    gatewaySuccess: null,
    gatewayErrorReason: null,
    batchTxHash: transfer.batchTxHash,
    recordedAt: now.toISOString()
  });
  // MANDATED ORDERING: validate (build) → PERSIST durably → digest → I3
  // transition. A conflicted/failed append performs NO transition.
  const digest = await persistEvidence(settlementEvidenceStorePath, evidence);
  if (digest === null) {
    return failClosed(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT, record.state);
  }
  const transition = await markX402ExecutionConfirmed({
    storePath,
    authorizationId,
    settlementEvidenceDigest: digest,
    occurredAt: now
  });
  if (!transition.applied && transition.reasonCode !== "X402_EXECUTION_TRANSITION_REPLAYED") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
  }
  const state = transition.applied
    ? transition.record.state
    : await durableState(storePath, authorizationId);
  return {
    reasonCode: X402_GATEWAY_TRANSFER_CONFIRMED,
    outcome,
    executionState: state,
    settlementEvidenceDigest: digest,
    gatewayTransferId: transfer.transferId,
    gatewayTransferStatus: status
  };
}

/**
 * No trustworthy remote outcome: from `submitted`, durably enter
 * `remote_outcome_unknown` (evidence → I3 transition); from
 * `remote_outcome_unknown`, change nothing and report it.
 */
async function reportNoTrustworthyOutcome(
  context: OrchestrationContext,
  record: X402ExecutionRecord,
  base: EvidenceBaseLinkage
): Promise<X402GatewaySettlementResult> {
  if (record.state === "submitted") {
    return persistAmbiguousOutcome(
      context,
      record,
      base,
      X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN
    );
  }
  return {
    reasonCode: X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN,
    outcome: "remote_outcome_unknown",
    executionState: record.state,
    settlementEvidenceDigest: null,
    gatewayTransferId: record.remoteOutcomeUnknown?.gatewayTransferId ?? null,
    gatewayTransferStatus: null
  };
}

// ---------------------------------------------------------------------------
// Finish (crash recovery: "evidence written, I3 transition crashed").
// ---------------------------------------------------------------------------

/**
 * Offline recovery: reads the LATEST durable evidence and, when its outcome
 * is `confirmed`/`completed`, recomputes `fingerprintSettlementEvidence` and
 * replays the idempotent I3 confirmed transition (a REPLAYED transition is
 * SUCCESS, not an error). Otherwise changes nothing and reports
 * (`_TRANSFER_PENDING` / `_REMOTE_OUTCOME_UNKNOWN` / `_KNOWN_REJECTION` /
 * `_STATE_CONFLICT`). NO network calls, NEVER fabricates evidence.
 */
export async function finishX402GatewayConfirmation(input: {
  storePath: string;
  settlementEvidenceStorePath: string;
  authorizationId: string;
  now: Date;
}): Promise<X402GatewaySettlementResult> {
  const { storePath, settlementEvidenceStorePath, authorizationId, now } = input;

  const durable = await readDurable(storePath, authorizationId);
  if (durable.kind === "corrupt") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT);
  }
  if (durable.kind === "not_found") {
    return failClosed(X402_GATEWAY_EXECUTION_NOT_FOUND);
  }
  const record = durable.record;
  const latest = await readLatestEvidence(settlementEvidenceStorePath, authorizationId);
  if (latest === "corrupt") {
    return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
  }

  // Already confirmed: report the durable terminal commitment as success.
  if (record.state === "confirmed") {
    const confirmedDigest =
      record.terminal?.state === "confirmed" ? record.terminal.settlementEvidenceDigest : null;
    return {
      reasonCode: X402_GATEWAY_TRANSFER_CONFIRMED,
      outcome: latest?.outcome ?? null,
      executionState: "confirmed",
      settlementEvidenceDigest: confirmedDigest,
      gatewayTransferId: latest?.gatewayTransferId ?? null,
      gatewayTransferStatus: latest?.gatewayTransferStatus ?? null
    };
  }

  if (latest !== null && (latest.outcome === "confirmed" || latest.outcome === "completed")) {
    if (record.state === "failed" || record.state === "prepared") {
      // Durable evidence and the state machine contradict each other —
      // fail closed for human triage; never rewrite a terminal state.
      return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
    }
    const digest = fingerprintSettlementEvidence(latest);
    const transition = await markX402ExecutionConfirmed({
      storePath,
      authorizationId,
      settlementEvidenceDigest: digest,
      occurredAt: now
    });
    if (!transition.applied && transition.reasonCode !== "X402_EXECUTION_TRANSITION_REPLAYED") {
      return failClosed(X402_GATEWAY_STATE_CONFLICT, record.state);
    }
    const state = transition.applied
      ? transition.record.state
      : await durableState(storePath, authorizationId);
    return {
      reasonCode: X402_GATEWAY_TRANSFER_CONFIRMED,
      outcome: latest.outcome,
      executionState: state,
      settlementEvidenceDigest: digest,
      gatewayTransferId: latest.gatewayTransferId,
      gatewayTransferStatus: latest.gatewayTransferStatus
    };
  }

  // No confirmable durable evidence: change nothing, report honestly.
  if (latest === null) {
    if (record.state === "remote_outcome_unknown") {
      return {
        reasonCode: X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN,
        outcome: "remote_outcome_unknown",
        executionState: record.state,
        settlementEvidenceDigest: null,
        gatewayTransferId: record.remoteOutcomeUnknown?.gatewayTransferId ?? null,
        gatewayTransferStatus: null
      };
    }
    if (record.state === "failed") {
      return {
        reasonCode: X402_GATEWAY_KNOWN_REJECTION,
        outcome: "failed",
        executionState: record.state,
        settlementEvidenceDigest: null,
        gatewayTransferId: null,
        gatewayTransferStatus: null
      };
    }
    return {
      reasonCode: X402_GATEWAY_TRANSFER_PENDING,
      outcome: null,
      executionState: record.state,
      settlementEvidenceDigest: null,
      gatewayTransferId: null,
      gatewayTransferStatus: null
    };
  }
  if (latest.outcome === "remote_outcome_unknown") {
    return {
      reasonCode: X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN,
      outcome: "remote_outcome_unknown",
      executionState: record.state,
      settlementEvidenceDigest: fingerprintSettlementEvidence(latest),
      gatewayTransferId: null,
      gatewayTransferStatus: null
    };
  }
  if (latest.outcome === "failed") {
    return {
      reasonCode: X402_GATEWAY_KNOWN_REJECTION,
      outcome: "failed",
      executionState: record.state,
      settlementEvidenceDigest: fingerprintSettlementEvidence(latest),
      gatewayTransferId: latest.gatewayTransferId,
      gatewayTransferStatus: null
    };
  }
  return {
    reasonCode: X402_GATEWAY_TRANSFER_PENDING,
    outcome: "accepted_pending",
    executionState: record.state,
    settlementEvidenceDigest: fingerprintSettlementEvidence(latest),
    gatewayTransferId: latest.gatewayTransferId,
    gatewayTransferStatus: latest.gatewayTransferStatus
  };
}
