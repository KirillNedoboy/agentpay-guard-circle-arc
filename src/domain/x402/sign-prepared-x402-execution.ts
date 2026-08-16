import {
  fingerprintX402PaymentRequirement,
  validateX402PaymentRequirement,
  X402PaymentRequirementValidationError,
  type X402PaymentRequirement
} from "./payment-requirement";
import {
  markX402ExecutionFailed,
  markX402ExecutionSubmitted,
  readX402ExecutionRecord,
  X402ExecutionStoreError,
  X402_EXECUTION_STATE_CONFLICT,
  X402_EXECUTION_TRANSITION_REPLAYED,
  type X402ExecutionRecord
} from "./execution-store";
import {
  buildX402Eip3009SigningRequest,
  signingRequestDigest,
  validateX402Eip3009SigningRequest,
  X402SigningRequestError,
  type X402Eip3009SigningRequest
} from "./eip3009-signing-request";
import {
  buildX402SignedPaymentPayload,
  signerPayloadDigest,
  validateX402ExternalSignerResponse,
  X402ExternalSignerError,
  type X402ExternalSigner,
  type X402ExternalSignerResponse,
  type X402PayerBinding,
  type X402SignedPaymentPayload
} from "./external-signer";
import { recoverTypedDataAddress, type Hex, type TypedDataDomain } from "viem";

/**
 * I4 — the bounded external EOA signer boundary (pre-Phase-9 Circle
 * integration track).
 *
 * Chain: I3 prepared execution record → exact EIP-3009 signing request →
 * key-isolated external signer → cryptographically verified signature →
 * transient x402 PaymentPayload → deterministic signerPayloadDigest → I3
 * `markX402ExecutionSubmitted` → STOP.
 *
 * NO Gateway calls, no /verify, no /settle, no Arc RPC, no HTTP payment
 * requests, no broadcast, no funds movement, no settlement polling, no
 * SettlementEvidence, no confirmed state. The private key NEVER enters src/,
 * the runtime, the policy engine, the execution store, the audit log, or the
 * observation log — it belongs ONLY to the external signer process/tool
 * implementing `X402ExternalSigner`.
 *
 * FAIL-CLOSED CONTRACT: every step rejects with a stable `X402_SIGNER_*`
 * reason code before the next step runs; the signer is invoked ONLY after the
 * requirement digest, prepared-field binding, payer address, and Guard expiry
 * all pass. Sign-stage failures are persisted via I3
 * `markX402ExecutionFailed(failureStage: "sign")` with the stable failure
 * code (never Error.stack, never a private key, never a signature, never a
 * raw payload). Failure stays terminal; a fresh Guard authorization lineage
 * is required for retry.
 *
 * The I3 submitted transition stores ONLY `nonce` + `signerPayloadDigest` —
 * the raw signature and payload are never written to the execution store
 * (I3 enforces this; this module does not bypass it).
 *
 * GUARD EXPIRY vs EIP-3009 VALIDITY (documented): the Guard authorization TTL
 * (prepared.authorizationExpiresAt, 300 s local) and the Gateway signature
 * validity window (validBefore >= now + 7 days + buffer per the official
 * Gateway requirement) are SEPARATE controls. I4 re-checks the Guard expiry
 * immediately before the signer call; I5 MUST recheck Guard expiry again
 * immediately before any Gateway submission.
 */

// ---------------------------------------------------------------------------
// Stable reason codes — the I4 security contract, not free-form strings.
// ---------------------------------------------------------------------------

export const X402_SIGNER_READY = "X402_SIGNER_READY" as const;
export const X402_SIGNER_EXECUTION_NOT_FOUND = "X402_SIGNER_EXECUTION_NOT_FOUND" as const;
export const X402_SIGNER_EXECUTION_NOT_PREPARED = "X402_SIGNER_EXECUTION_NOT_PREPARED" as const;
export const X402_SIGNER_AUTHORIZATION_EXPIRED = "X402_SIGNER_AUTHORIZATION_EXPIRED" as const;
export const X402_SIGNER_AUTHORIZATION_TIMESTAMP_MALFORMED =
  "X402_SIGNER_AUTHORIZATION_TIMESTAMP_MALFORMED" as const;
export const X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH =
  "X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH" as const;
export const X402_SIGNER_PREPARED_BINDING_MISMATCH =
  "X402_SIGNER_PREPARED_BINDING_MISMATCH" as const;
export const X402_SIGNER_PAYER_ADDRESS_INVALID = "X402_SIGNER_PAYER_ADDRESS_INVALID" as const;
export const X402_SIGNER_REQUEST_BUILD_FAILED = "X402_SIGNER_REQUEST_BUILD_FAILED" as const;
export const X402_SIGNER_EXTERNAL_FAILURE = "X402_SIGNER_EXTERNAL_FAILURE" as const;
export const X402_SIGNER_RESPONSE_INVALID = "X402_SIGNER_RESPONSE_INVALID" as const;
export const X402_SIGNER_REQUEST_DIGEST_MISMATCH = "X402_SIGNER_REQUEST_DIGEST_MISMATCH" as const;
export const X402_SIGNER_PAYER_MISMATCH = "X402_SIGNER_PAYER_MISMATCH" as const;
export const X402_SIGNER_SIGNATURE_INVALID = "X402_SIGNER_SIGNATURE_INVALID" as const;
export const X402_SIGNER_STATE_CONFLICT = "X402_SIGNER_STATE_CONFLICT" as const;

export type X402SignerRejectionCode =
  | typeof X402_SIGNER_EXECUTION_NOT_FOUND
  | typeof X402_SIGNER_EXECUTION_NOT_PREPARED
  | typeof X402_SIGNER_AUTHORIZATION_EXPIRED
  | typeof X402_SIGNER_AUTHORIZATION_TIMESTAMP_MALFORMED
  | typeof X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH
  | typeof X402_SIGNER_PREPARED_BINDING_MISMATCH
  | typeof X402_SIGNER_PAYER_ADDRESS_INVALID
  | typeof X402_SIGNER_REQUEST_BUILD_FAILED
  | typeof X402_SIGNER_EXTERNAL_FAILURE
  | typeof X402_SIGNER_RESPONSE_INVALID
  | typeof X402_SIGNER_REQUEST_DIGEST_MISMATCH
  | typeof X402_SIGNER_PAYER_MISMATCH
  | typeof X402_SIGNER_SIGNATURE_INVALID
  | typeof X402_SIGNER_STATE_CONFLICT;

export type X402SignerResult =
  | {
      signerReady: true;
      reasonCode: typeof X402_SIGNER_READY;
      /** Transient signed payload for future I5 submission; never persisted. */
      payload: X402SignedPaymentPayload;
      signerPayloadDigest: string;
      record: X402ExecutionRecord;
    }
  | {
      signerReady: false;
      reasonCode: X402SignerRejectionCode;
      payload: null;
      signerPayloadDigest: null;
      /** Current execution record when readable (null when not found/corrupt). */
      record: X402ExecutionRecord | null;
    };

export type X402SignPreparedInput = {
  /** I3 execution store root directory. */
  storePath: string;
  /** The consumed v2 authorization id (auth_<64 lowercase hex>). */
  authorizationId: string;
  /** The EXACT validated I1 requirement bound to the prepared record. */
  paymentRequirement: X402PaymentRequirement;
  /** Trusted payer EOA binding (operator/test-harness configuration only). */
  payerBinding: X402PayerBinding;
  /** Explicit signing time; never Date.now() inside the orchestrator. */
  now: Date;
  /** Key-isolated external signer implementation. */
  signer: X402ExternalSigner;
};

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;

/** Case-insensitive EVM address semantic equality (repo convention). */
function evmAddressesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function rejected(
  reasonCode: X402SignerRejectionCode,
  record: X402ExecutionRecord | null
): X402SignerResult {
  return { signerReady: false, reasonCode, payload: null, signerPayloadDigest: null, record };
}

/**
 * Best-effort persistence of a sign-stage failure via the I3 primitive.
 * Stores ONLY failureStage "sign" + the stable failure code — never
 * Error.stack, private keys, signatures, or raw payloads. The primary
 * rejection code remains the contract even if marking is impossible
 * (e.g. corrupt store): fail closed either way.
 */
async function markSignFailure(
  storePath: string,
  authorizationId: string,
  failureCode: X402SignerRejectionCode,
  occurredAt: Date
): Promise<X402ExecutionRecord | null> {
  try {
    const result = await markX402ExecutionFailed({
      storePath,
      authorizationId,
      failureStage: "sign",
      failureCode,
      occurredAt
    });
    return result.applied ? result.record : null;
  } catch {
    return null;
  }
}

/**
 * Sign the prepared execution record with the external signer, fail closed at
 * every step. Returns X402_SIGNER_READY with the transient payload ONLY after
 * the signature cryptographically recovers to the trusted payer over the
 * EXACT locally constructed EIP-712 typed data and I3 accepted the submitted
 * transition (or safely replayed the identical payload digest).
 */
export async function signPreparedX402Execution(
  input: X402SignPreparedInput
): Promise<X402SignerResult> {
  const { storePath, authorizationId, paymentRequirement, payerBinding, now, signer } = input;

  // 1. Read the I3 record. Missing → NOT_FOUND; corrupt → STATE_CONFLICT.
  let record: X402ExecutionRecord;
  try {
    const loaded = await readX402ExecutionRecord(storePath, authorizationId);
    if (loaded === null) {
      return rejected(X402_SIGNER_EXECUTION_NOT_FOUND, null);
    }
    record = loaded;
  } catch (error) {
    if (error instanceof X402ExecutionStoreError) {
      return rejected(X402_SIGNER_STATE_CONFLICT, null);
    }
    throw error;
  }
  if (record.state !== "prepared") {
    return rejected(X402_SIGNER_EXECUTION_NOT_PREPARED, record);
  }
  const prepared = record.prepared;

  // 2. Requirement digest: recompute with the I1 helper over the validated
  //    requirement and require equality with the prepared commit.
  let requirement: X402PaymentRequirement;
  try {
    requirement = validateX402PaymentRequirement(paymentRequirement);
  } catch (error) {
    if (error instanceof X402PaymentRequirementValidationError) {
      return rejected(X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH, record);
    }
    throw error;
  }
  if (fingerprintX402PaymentRequirement(requirement) !== prepared.paymentRequirementDigest) {
    return rejected(X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH, record);
  }

  // 3. Binding integrity: the prepared network/asset/payTo/amount must equal
  //    the exact requirement (semantic EVM comparison; exact amount string).
  if (
    requirement.network !== prepared.network ||
    !evmAddressesEqual(requirement.asset, prepared.assetAddress) ||
    !evmAddressesEqual(requirement.payTo, prepared.payTo) ||
    requirement.amount !== prepared.amountAtomic ||
    !NONCE_PATTERN.test(prepared.nonce)
  ) {
    return rejected(X402_SIGNER_PREPARED_BINDING_MISMATCH, record);
  }

  // 4. Payer: the trusted binding must be a valid EVM address.
  if (typeof payerBinding.payerAddress !== "string" || !EVM_ADDRESS_PATTERN.test(payerBinding.payerAddress)) {
    return rejected(X402_SIGNER_PAYER_ADDRESS_INVALID, record);
  }
  const payerAddress = payerBinding.payerAddress;

  // 5. Guard-expiry recheck (immediately before the signer call). NO signer
  //    call on any expiry failure. Guard TTL and EIP-3009 validBefore are
  //    separate controls; I5 MUST recheck Guard expiry before submission.
  if (Number.isNaN(now.getTime())) {
    return rejected(X402_SIGNER_AUTHORIZATION_EXPIRED, record);
  }
  const expiresAtMs = Date.parse(prepared.authorizationExpiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return rejected(X402_SIGNER_AUTHORIZATION_TIMESTAMP_MALFORMED, record);
  }
  if (now.getTime() >= expiresAtMs) {
    return rejected(X402_SIGNER_AUTHORIZATION_EXPIRED, record);
  }

  // 6. Build the signing request from prepared evidence + trusted payer +
  //    explicit now (official EIP-712 facts are encoded in the builder).
  let request: X402Eip3009SigningRequest;
  try {
    request = buildX402Eip3009SigningRequest({
      prepared,
      requirement,
      payerAddress,
      now
    });
    // Defense-in-depth: the built request must round-trip strict validation.
    validateX402Eip3009SigningRequest(request);
  } catch (error) {
    if (error instanceof X402SigningRequestError) {
      return rejected(X402_SIGNER_REQUEST_BUILD_FAILED, record);
    }
    throw error;
  }
  const expectedRequestDigest = signingRequestDigest(request);

  // 7. External signer call. Any throw/reject/malformed output → failed(sign).
  let response: X402ExternalSignerResponse;
  try {
    const candidate = await signer.sign(request);
    response = validateX402ExternalSignerResponse(candidate);
  } catch (error) {
    if (error instanceof X402ExternalSignerError) {
      const failedRecord = await markSignFailure(
        storePath,
        authorizationId,
        X402_SIGNER_RESPONSE_INVALID,
        now
      );
      return rejected(X402_SIGNER_RESPONSE_INVALID, failedRecord ?? record);
    }
    const failedRecord = await markSignFailure(
      storePath,
      authorizationId,
      X402_SIGNER_EXTERNAL_FAILURE,
      now
    );
    return rejected(X402_SIGNER_EXTERNAL_FAILURE, failedRecord ?? record);
  }

  // 8. Strict response value checks (fixed order): request digest → payer.
    if (response.signingRequestDigest !== expectedRequestDigest) {
    const failedRecord = await markSignFailure(
      storePath,
      authorizationId,
      X402_SIGNER_REQUEST_DIGEST_MISMATCH,
      now
    );
    return rejected(X402_SIGNER_REQUEST_DIGEST_MISMATCH, failedRecord ?? record);
  }
  if (!evmAddressesEqual(response.payerAddress, payerAddress)) {
    const failedRecord = await markSignFailure(storePath, authorizationId, X402_SIGNER_PAYER_MISMATCH, now);
    return rejected(X402_SIGNER_PAYER_MISMATCH, failedRecord ?? record);
  }

  // 9. Cryptographic verification against the EXACT locally constructed typed
  //    data (domain/types/message as the Guard built them — NOT as the signer
  //    described them). The signer contributes signature only.
  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      // The domain/message are exactly the Guard-built typed data (validated
      // formats); the casts only satisfy viem's template-literal types.
      domain: request.eip712.domain as TypedDataDomain,
      types: request.eip712.types,
      primaryType: request.eip712.primaryType,
      message: {
        from: request.eip712.message.from as `0x${string}`,
        to: request.eip712.message.to as `0x${string}`,
        value: BigInt(request.eip712.message.value),
        validAfter: BigInt(request.eip712.message.validAfter),
        validBefore: BigInt(request.eip712.message.validBefore),
        nonce: request.eip712.message.nonce as `0x${string}`
      },
      signature: response.signature as Hex
    });
  } catch {
    const failedRecord = await markSignFailure(
      storePath,
      authorizationId,
      X402_SIGNER_SIGNATURE_INVALID,
      now
    );
    return rejected(X402_SIGNER_SIGNATURE_INVALID, failedRecord ?? record);
  }
  if (!evmAddressesEqual(recovered, payerAddress)) {
    const failedRecord = await markSignFailure(
      storePath,
      authorizationId,
      X402_SIGNER_SIGNATURE_INVALID,
      now
    );
    return rejected(X402_SIGNER_SIGNATURE_INVALID, failedRecord ?? record);
  }

  // 10. Build the strict transient x402 v2 PaymentPayload (verified official
  //     shape; contains the signature — NEVER a private key/mnemonic/seed).
  let payload: X402SignedPaymentPayload;
  try {
    payload = buildX402SignedPaymentPayload({ requirement, request, signature: response.signature });
  } catch (error) {
    if (error instanceof X402ExternalSignerError) {
      const failedRecord = await markSignFailure(
        storePath,
        authorizationId,
        X402_SIGNER_RESPONSE_INVALID,
        now
      );
      return rejected(X402_SIGNER_RESPONSE_INVALID, failedRecord ?? record);
    }
    throw error;
  }

  // 11. Deterministic digest of the COMPLETE canonical signed payload
  //     (INCLUDES the signature; changed signature/field → different digest).
  const submittedDigest = signerPayloadDigest(payload);

  // 12. Persist ONLY nonce + signerPayloadDigest via the I3 primitive. Applied
  //     OR exact safe replay of the SAME digest → ready. Any other transition
  //     outcome (conflict/invalid/corrupt/not-found) → fail closed.
  const transition = await markX402ExecutionSubmitted({
    storePath,
    authorizationId,
    nonce: prepared.nonce,
    signerPayloadDigest: submittedDigest,
    occurredAt: now
  });
  if (
    transition.applied ||
    (!transition.applied && transition.reasonCode === X402_EXECUTION_TRANSITION_REPLAYED)
  ) {
    if (transition.applied) {
      return {
        signerReady: true,
        reasonCode: X402_SIGNER_READY,
        payload,
        signerPayloadDigest: submittedDigest,
        record: transition.record
      };
    }
    // Exact replay of the SAME payload digest: the already-submitted record is
    // authoritative; the locally built payload is byte-identical by digest.
    const current = await readX402ExecutionRecord(storePath, authorizationId);
    return {
      signerReady: true,
      reasonCode: X402_SIGNER_READY,
      payload,
      signerPayloadDigest: submittedDigest,
      record: current ?? record
    };
  }
  const conflictRecord =
    transition.reasonCode === X402_EXECUTION_STATE_CONFLICT && record.state === "prepared"
      ? record
      : null;
  return rejected(X402_SIGNER_STATE_CONFLICT, conflictRecord);
}
