import { stableSha256 } from "@/lib/stable-json";
import type { X402PaymentRequirement } from "./payment-requirement";
import type { X402Eip3009SigningRequest } from "./eip3009-signing-request";

/**
 * I4 — external signer boundary (pre-Phase-9 Circle integration track).
 *
 * The private key NEVER enters src/, the Next.js runtime, the policy engine,
 * the execution store, the audit log, or the observation log. It belongs ONLY
 * to an external signer process/tool that implements `X402ExternalSigner`
 * (e.g. scripts/x402-external-signer.mjs — a separate, never-imported
 * process reading the key from its own environment). Guard-side code in this
 * module is keyless: it defines the strict request/response contract, the
 * trusted payer binding, and the transient signed PaymentPayload plus its
 * deterministic digest.
 *
 * RESPONSE BOUNDARY: `X402ExternalSignerResponse` carries ONLY
 * responseType/version/signingRequestDigest/payerAddress/signature. It CANNOT
 * redefine to/value/nonce/validity/network/asset/domain — those fields are
 * fixed by the Guard-built signing request and are not part of the response
 * shape at all. Any attempt by the signer to return a different recipient,
 * amount, nonce, validity, network, or domain is structurally impossible by
 * the response shape and additionally rejected by the orchestrator's
 * request-digest and cryptographic checks.
 */

/** Strict signer response shape. `signingRequestDigest` echoes the Guard-built digest; `signature` is the only signer-contributed value. */
export type X402ExternalSignerResponse = {
  responseType: "x402_eip3009_signature";
  version: "v1";
  signingRequestDigest: string;
  payerAddress: string;
  /** 65-byte EIP-712 signature as 0x hex (viem signTypedData output). */
  signature: string;
};

/**
 * Key-isolated external signer contract. Implementations sign EXACTLY the
 * supplied typed data (request.eip712 domain/types/message) and return the
 * strict response. Implementations MUST NOT perform network calls, MUST NOT
 * persist the key, and MUST NOT include any value not present in the request.
 */
export interface X402ExternalSigner {
  sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse>;
}

/**
 * Trusted payer binding. MUST come from trusted operator/test-harness
 * configuration — never solely from the raw 402 requirement or the signer
 * response. The self-asserted agentId residual (ADD-1) remains documented;
 * I4 does not solve production identity.
 */
export type X402PayerBinding = {
  payerAddress: string;
};

/**
 * Transient x402 v2 PaymentPayload built after cryptographic verification.
 * Shape per the CURRENT official facts: x402 spec v2 §5.2
 * (https://raw.githubusercontent.com/x402-foundation/x402/main/specs/x402-specification-v2.md)
 * and the Circle Gateway OpenAPI `PaymentPayload` schema (required:
 * x402Version, accepted, payload) consumed by `/v1/x402/settle`
 * (https://developers.circle.com/openapi/gateway.yaml).
 *
 * `accepted` echoes the exact validated `PaymentRequirements` object;
 * `payload.signature` is the 65-byte 0x hex EIP-712 signature;
 * `payload.authorization` mirrors the signed EIP-3009 authorization exactly
 * (from/to/value/validAfter/validBefore/nonce as strings). This object is
 * transient for future I5 submission — it NEVER contains a private key,
 * mnemonic, or seed, and is NEVER written into the execution store (only its
 * digest is).
 */
export type X402SignedPaymentPayload = {
  x402Version: 2;
  accepted: X402PaymentRequirement;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
};

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

const KNOWN_RESPONSE_FIELDS: Record<string, true> = {
  responseType: true,
  version: true,
  signingRequestDigest: true,
  payerAddress: true,
  signature: true
};

/** Dedicated error type for strict response/payload validation failures. */
export class X402ExternalSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402ExternalSignerError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Strict structural validation of a raw signer response from unknown input:
 * plain object, NO unknown fields, responseType/version literals, and field
 * FORMATS (digest pattern, EVM address pattern, 65-byte 0x signature
 * pattern). Throws `X402ExternalSignerError` on any defect. VALUE
 * comparisons (digest equality, payer equality) are the orchestrator's job.
 */
export function validateX402ExternalSignerResponse(input: unknown): X402ExternalSignerResponse {
  if (!isPlainObject(input)) {
    throw new X402ExternalSignerError("signer response must be a plain object.");
  }
  for (const field of Object.keys(input)) {
    if (!KNOWN_RESPONSE_FIELDS[field]) {
      throw new X402ExternalSignerError(`signer response contains an unsupported field: ${field}.`);
    }
  }
  if (input.responseType !== "x402_eip3009_signature") {
    throw new X402ExternalSignerError('responseType must be "x402_eip3009_signature".');
  }
  if (input.version !== "v1") {
    throw new X402ExternalSignerError("signer response version must be v1.");
  }
  const signingRequestDigest = input.signingRequestDigest;
  if (typeof signingRequestDigest !== "string" || !DIGEST_PATTERN.test(signingRequestDigest)) {
    throw new X402ExternalSignerError(
      "signingRequestDigest must be sha256:<64 lowercase hex>."
    );
  }
  const payerAddress = input.payerAddress;
  if (typeof payerAddress !== "string" || !EVM_ADDRESS_PATTERN.test(payerAddress)) {
    throw new X402ExternalSignerError("payerAddress must be an EVM address.");
  }
  const signature = input.signature;
  if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
    throw new X402ExternalSignerError(
      "signature must be a 65-byte signature encoded as 0x + 130 hex characters."
    );
  }
  return {
    responseType: "x402_eip3009_signature",
    version: "v1",
    signingRequestDigest,
    payerAddress,
    signature
  };
}

/**
 * Builds the strict transient x402 v2 PaymentPayload. The authorization echo
 * is taken VERBATIM from the Guard-built signing request message (the exact
 * data the signature was verified against) plus the verified signature —
 * never from the signer's description of what it signed.
 */
export function buildX402SignedPaymentPayload(input: {
  requirement: X402PaymentRequirement;
  request: X402Eip3009SigningRequest;
  signature: string;
}): X402SignedPaymentPayload {
  const { requirement, request, signature } = input;
  if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
    throw new X402ExternalSignerError(
      "signature must be a 65-byte signature encoded as 0x + 130 hex characters."
    );
  }
  return {
    x402Version: 2,
    accepted: requirement,
    payload: {
      signature,
      authorization: {
        from: request.eip712.message.from,
        to: request.eip712.message.to,
        value: request.eip712.message.value,
        validAfter: request.eip712.message.validAfter,
        validBefore: request.eip712.message.validBefore,
        nonce: request.eip712.message.nonce
      }
    }
  };
}

/**
 * Deterministic digest of the COMPLETE canonical signed payload:
 * `sha256:<64 lowercase hex>` via the repo stable-JSON SHA-256 helper. The
 * digest INCLUDES the signature — same payload → same digest; any changed
 * signature or field → different digest. This is the ONLY value persisted by
 * I3's `markX402ExecutionSubmitted` (never the signature or raw payload).
 */
export function signerPayloadDigest(payload: X402SignedPaymentPayload): string {
  return `sha256:${stableSha256(payload)}`;
}
