import { stableSha256 } from "@/lib/stable-json";
import { x402NetworkChainId, type X402PaymentRequirement } from "./payment-requirement";
import type { X402PreparedExecutionRecord } from "./execution-store";

/**
 * I4 — deterministic, JSON-serializable, NON-SECRET EIP-3009 signing request
 * (pre-Phase-9 Circle integration track).
 *
 * This module builds the EXACT message the external signer must sign for the
 * Circle Gateway nanopayments / Arc Testnet exact-EVM path. It is a pure
 * data-contract layer: no signing, no private key, no wallet, no network, no
 * Gateway call, no Date.now(). Every value comes from (a) the I3 prepared
 * execution record, (b) the exact I1-validated payment requirement, (c) the
 * trusted payer binding, and (d) the EXPLICIT `now` — never from raw input.
 *
 * OFFICIAL FACTS (re-verified against current primary sources on 2026-08-16;
 * see docs/grants/circle-grants-2026/integration-feasibility.md for the
 * pinned record and this module's header notes for the additions):
 *
 * - Primary type is `TransferWithAuthorization` over
 *   { from: address, to: address, value: uint256, validAfter: uint256,
 *     validBefore: uint256, nonce: bytes32 } — confirmed in the official
 *   @circle-fin/x402-batching SDK v3.3.0 (the SDK the official Circle
 *   nanopayments quickstarts install) `authorizationTypes` constant:
 *   https://registry.npmjs.org/@circle-fin/x402-batching/-/x402-batching-3.3.0.tgz
 * - The EIP-712 domain is built by the SDK's `BatchEvmScheme.signAuthorization`
 *   as `{ name: "GatewayWalletBatched", version: "1", chainId,
 *   verifyingContract }` — **the domain DOES include chainId** (parsed from
 *   the CAIP-2 network, e.g. 5042002 for Arc Testnet). This chainId-in-domain
 *   fact is an ADDITION to the pinned feasibility record (which documented
 *   name/version/verifyingContract only); it was re-verified from the
 *   official SDK source above and is implemented here.
 * - `validAfter` is the Unix timestamp when the authorization becomes valid;
 *   the SDK sets it 600 s in the past (immediately usable).
 * - The CURRENT minimum validity window Gateway requires: the SDK enforces
 *   `validBefore >= now + max(maxTimeoutSeconds, 604900)` where
 *   604900 = 7 days (604800) + 100 s buffer
 *   (`GATEWAY_MIN_AUTH_VALIDITY_SECONDS` + `GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS`).
 *   Circle's seller quickstart states: "Payment signatures must have at least
 *   7 days plus a small buffer of validity. The `validBefore` timestamp in
 *   the buyer's EIP-3009 authorization must be at least 7 days in the future,
 *   or Gateway will reject it."
 * - Signature encoding: 65-byte `0x` hex (viem `signTypedData` output).
 * - EOA only: "Nanopayments and x402 batch settlement require EOA signatures
 *   and do not support ERC-1271" (buyer quickstart: batched settlement
 *   verifies EIP-3009 offchain via `ecrecover`).
 */

/** Official Gateway EIP-712 domain name (S17 / SDK CIRCLE_BATCHING_NAME). */
export const GATEWAY_EIP712_DOMAIN_NAME = "GatewayWalletBatched" as const;
/** Official Gateway EIP-712 domain version (S17 / SDK CIRCLE_BATCHING_VERSION). */
export const GATEWAY_EIP712_DOMAIN_VERSION = "1" as const;
/** Official EIP-3009 primary type (SDK authorizationTypes). */
export const X402_EIP3009_PRIMARY_TYPE = "TransferWithAuthorization" as const;

/** 7 days in seconds — Gateway minimum authorization validity (SDK GATEWAY_MIN_AUTH_VALIDITY_SECONDS). */
export const GATEWAY_MIN_AUTH_VALIDITY_SECONDS = 7 * 24 * 60 * 60;
/** Small validity buffer the SDK adds on top of the 7-day minimum (SDK GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS). */
export const GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS = 100;
/** Current Gateway minimum validBefore window measured from `now`: 7 days + 100 s = 604900 s (SDK GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS). */
export const GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS =
  GATEWAY_MIN_AUTH_VALIDITY_SECONDS + GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS;
/** SDK backdates validAfter by 10 minutes so the authorization is immediately valid. */
export const GATEWAY_VALID_AFTER_BACKDATING_SECONDS = 600;

/**
 * The exact EIP-712 `types` block for the Gateway EIP-3009 authorization
 * (from the official SDK `authorizationTypes`; field order is significant for
 * EIP-712 hashing and MUST stay exactly as listed).
 */
export const X402_EIP3009_TYPES: X402Eip3009AuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};

export type X402Eip3009AuthorizationTypes = {
  TransferWithAuthorization: ReadonlyArray<{ readonly name: string; readonly type: string }>;
};

/** Derived EIP-3009 validity window as decimal Unix-second strings. */
export type X402Eip3009ValidityWindow = {
  /** Unix seconds when the authorization becomes valid (SDK: now - 600). */
  validAfter: string;
  /** Unix seconds when the authorization expires (SDK: now + max(maxTimeoutSeconds, 604900)). */
  validBefore: string;
};

/**
 * Strict, JSON-serializable, non-secret signing request. The response shape
 * of the external signer cannot redefine any of these fields: `to`, `value`,
 * `nonce`, `network`/`chainId`, `assetAddress`, the EIP-712 domain, and the
 * validity window are fixed by this Guard-built request; the signer
 * contributes ONLY the signature.
 */
export type X402Eip3009SigningRequest = {
  requestType: "x402_eip3009_signing_request";
  version: "v1";
  /** I3 prepared-record authorizationId (auth_<64 lowercase hex>). */
  authorizationId: string;
  /** v1 parent authorization id from the prepared record. */
  parentAuthorizationId: string;
  /** Canonical Guard audit record id from the prepared record. */
  auditId: string;
  /** I1 requirement digest committed by the prepared record. */
  paymentRequirementDigest: string;
  /** CAIP-2 EVM network (e.g. "eip155:5042002"). */
  network: string;
  /** Decimal chain id (e.g. "5042002"). */
  chainId: string;
  /** Token contract address (Arc Testnet USDC ERC-20 interface). */
  assetAddress: string;
  /** Seller recipient address (EIP-3009 `to`). */
  payTo: string;
  /** Atomic amount (EIP-3009 `value`). */
  amountAtomic: string;
  /** Trusted payer EOA address (EIP-3009 `from`). */
  payerAddress: string;
  /** Bound EIP-3009 nonce (0x + 64 lowercase hex) from the prepared record. */
  nonce: string;
  /** The exact EIP-712 block the signer MUST sign. */
  eip712: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    primaryType: typeof X402_EIP3009_PRIMARY_TYPE;
    types: X402Eip3009AuthorizationTypes;
    message: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
};

/**
 * Dedicated error type for signing-request construction/validation failures.
 * Callers (I4 orchestrator) map this to stable reason codes; raw error
 * strings are never part of the security contract.
 */
export class X402SigningRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402SigningRequestError";
  }
}

const AUTHORIZATION_ID_PATTERN = /^auth_[0-9a-f]{64}$/;
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NETWORK_PATTERN = /^eip155:[1-9]\d*$/;
const AMOUNT_PATTERN = /^[1-9]\d*$/;
const UNIX_SECONDS_PATTERN = /^[1-9]\d*$/;
const DOMAIN_PATTERN = /^[1-9]\d*$/;

const EIP712_MESSAGE_KNOWN_FIELDS: Record<string, true> = {
  from: true,
  to: true,
  value: true,
  validAfter: true,
  validBefore: true,
  nonce: true
};

const EIP712_DOMAIN_KNOWN_FIELDS: Record<string, true> = {
  name: true,
  version: true,
  chainId: true,
  verifyingContract: true
};

const KNOWN_REQUEST_FIELDS: Record<string, true> = {
  requestType: true,
  version: true,
  authorizationId: true,
  parentAuthorizationId: true,
  auditId: true,
  paymentRequirementDigest: true,
  network: true,
  chainId: true,
  assetAddress: true,
  payTo: true,
  amountAtomic: true,
  payerAddress: true,
  nonce: true,
  eip712: true
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
      throw new X402SigningRequestError(`${container} contains an unsupported field: ${field}.`);
    }
  }
}

function requireStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new X402SigningRequestError(`${field} must be a non-empty string.`);
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
    throw new X402SigningRequestError(`${field} has an invalid format.`);
  }
  return value;
}

/**
 * Deterministic validity window from an EXPLICIT `now` (never Date.now()).
 * Mirrors the official SDK exactly: validAfter = now - 600 s (immediately
 * valid), validBefore = now + max(maxTimeoutSeconds, 604900) (7 days + 100 s
 * buffer minimum). Same inputs → same window; explicit dates make expiry
 * tests machine-clock independent. Fails closed (throws) on NaN `now`, on a
 * non-positive maxTimeoutSeconds, or when the derived window is degenerate
 * (validBefore <= validAfter, or a non-positive validAfter).
 */
export function deriveX402Eip3009ValidityWindow(
  now: Date,
  maxTimeoutSeconds: number
): X402Eip3009ValidityWindow {
  if (Number.isNaN(now.getTime())) {
    throw new X402SigningRequestError("now must be a valid Date (NaN time is rejected).");
  }
  if (!Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
    throw new X402SigningRequestError(
      "maxTimeoutSeconds must be a positive safe integer to derive a validity window."
    );
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const validAfter = nowSeconds - GATEWAY_VALID_AFTER_BACKDATING_SECONDS;
  const windowSeconds = Math.max(maxTimeoutSeconds, GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS);
  const validBefore = nowSeconds + windowSeconds;
  if (validAfter <= 0) {
    throw new X402SigningRequestError("derived validAfter is not a positive Unix timestamp.");
  }
  if (validBefore <= validAfter) {
    throw new X402SigningRequestError(
      "derived validBefore must be strictly greater than validAfter."
    );
  }
  return {
    validAfter: String(validAfter),
    validBefore: String(validBefore)
  };
}

/**
 * Builds the complete Guard-bound signing request from the I3 prepared record
 * evidence + the exact validated requirement + the trusted payer + the
 * explicit `now`. Pure and deterministic: same inputs → same request.
 *
 * SECURITY CONTRACT: this builder performs NO checks of its own beyond shape
 * construction — the I4 orchestrator enforces requirement-digest equality and
 * prepared-field binding BEFORE calling it, and re-checks Guard expiry
 * immediately before the signer call. The EIP-712 domain chainId is derived
 * from the prepared CAIP-2 network per the verified official SDK behavior
 * (chainId IS part of the Gateway EIP-712 domain).
 */
export function buildX402Eip3009SigningRequest(input: {
  prepared: X402PreparedExecutionRecord;
  requirement: X402PaymentRequirement;
  payerAddress: string;
  now: Date;
}): X402Eip3009SigningRequest {
  const { prepared, requirement, payerAddress, now } = input;

  if (!AUTHORIZATION_ID_PATTERN.test(prepared.authorizationId)) {
    throw new X402SigningRequestError(
      "prepared.authorizationId must be auth_<64 lowercase hex>."
    );
  }
  if (!AUTHORIZATION_ID_PATTERN.test(prepared.parentAuthorizationId)) {
    throw new X402SigningRequestError(
      "prepared.parentAuthorizationId must be auth_<64 lowercase hex>."
    );
  }
  if (typeof prepared.auditId !== "string" || prepared.auditId.length === 0) {
    throw new X402SigningRequestError("prepared.auditId must be a non-empty string.");
  }
  if (!DIGEST_PATTERN.test(prepared.paymentRequirementDigest)) {
    throw new X402SigningRequestError(
      "prepared.paymentRequirementDigest must be sha256:<64 lowercase hex>."
    );
  }
  if (!NETWORK_PATTERN.test(prepared.network)) {
    throw new X402SigningRequestError("prepared.network must be a CAIP-2 EVM identifier.");
  }
  if (!EVM_ADDRESS_PATTERN.test(prepared.assetAddress)) {
    throw new X402SigningRequestError("prepared.assetAddress must be an EVM address.");
  }
  if (!EVM_ADDRESS_PATTERN.test(prepared.payTo)) {
    throw new X402SigningRequestError("prepared.payTo must be an EVM address.");
  }
  if (!AMOUNT_PATTERN.test(prepared.amountAtomic)) {
    throw new X402SigningRequestError(
      "prepared.amountAtomic must be a canonical positive integer string."
    );
  }
  if (!EVM_ADDRESS_PATTERN.test(payerAddress)) {
    throw new X402SigningRequestError("payerAddress must be an EVM address.");
  }
  if (!NONCE_PATTERN.test(prepared.nonce)) {
    throw new X402SigningRequestError("prepared.nonce must be 0x + 64 lowercase hex.");
  }
  if (requirement.extra.name !== GATEWAY_EIP712_DOMAIN_NAME) {
    throw new X402SigningRequestError(
      `requirement EIP-712 domain name must be "${GATEWAY_EIP712_DOMAIN_NAME}".`
    );
  }
  if (requirement.extra.version !== GATEWAY_EIP712_DOMAIN_VERSION) {
    throw new X402SigningRequestError(
      `requirement EIP-712 domain version must be "${GATEWAY_EIP712_DOMAIN_VERSION}".`
    );
  }
  if (!EVM_ADDRESS_PATTERN.test(requirement.extra.verifyingContract)) {
    throw new X402SigningRequestError(
      "requirement extra.verifyingContract must be an EVM address."
    );
  }

  const chainId = x402NetworkChainId(prepared.network);
  const chainIdNumber = Number(chainId);
  if (!DOMAIN_PATTERN.test(chainId) || !Number.isSafeInteger(chainIdNumber)) {
    throw new X402SigningRequestError("prepared.network chainId is not a safe decimal integer.");
  }

  const validity = deriveX402Eip3009ValidityWindow(now, requirement.maxTimeoutSeconds);

  return {
    requestType: "x402_eip3009_signing_request",
    version: "v1",
    authorizationId: prepared.authorizationId,
    parentAuthorizationId: prepared.parentAuthorizationId,
    auditId: prepared.auditId,
    paymentRequirementDigest: prepared.paymentRequirementDigest,
    network: prepared.network,
    chainId,
    assetAddress: prepared.assetAddress,
    payTo: prepared.payTo,
    amountAtomic: prepared.amountAtomic,
    payerAddress,
    nonce: prepared.nonce,
    eip712: {
      domain: {
        name: requirement.extra.name,
        version: requirement.extra.version,
        chainId: chainIdNumber,
        verifyingContract: requirement.extra.verifyingContract
      },
      primaryType: X402_EIP3009_PRIMARY_TYPE,
      types: X402_EIP3009_TYPES,
      message: {
        from: payerAddress,
        to: prepared.payTo,
        value: prepared.amountAtomic,
        validAfter: validity.validAfter,
        validBefore: validity.validBefore,
        nonce: prepared.nonce
      }
    }
  };
}

function parseEip712Types(value: unknown): X402Eip3009AuthorizationTypes {
  if (!isPlainObject(value)) {
    throw new X402SigningRequestError("eip712.types must be a plain object.");
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0][0] !== "TransferWithAuthorization") {
    throw new X402SigningRequestError(
      'eip712.types must contain exactly the "TransferWithAuthorization" type.'
    );
  }
  const parameters = entries[0][1];
  if (!Array.isArray(parameters) || parameters.length !== 6) {
    throw new X402SigningRequestError(
      'eip712.types.TransferWithAuthorization must be the exact 6-field EIP-3009 parameter list.'
    );
  }
  const expected: Array<{ name: string; type: string }> = [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ];
  const parsed: Array<{ name: string; type: string }> = [];
  for (const parameter of parameters) {
    if (!isPlainObject(parameter)) {
      throw new X402SigningRequestError(
        "eip712.types.TransferWithAuthorization entries must be plain objects."
      );
    }
    const name = requireStringField(parameter, "name");
    const type = requireStringField(parameter, "type");
    parsed.push({ name, type });
  }
  for (let index = 0; index < expected.length; index++) {
    if (parsed[index].name !== expected[index].name || parsed[index].type !== expected[index].type) {
      throw new X402SigningRequestError(
        "eip712.types.TransferWithAuthorization does not match the exact official EIP-3009 field list."
      );
    }
  }
  return X402_EIP3009_TYPES;
}

/**
 * Strict plain-object validation of a signing request from unknown input
 * (used by the orchestrator before digesting and by tests; the standalone
 * signer CLI performs its own equivalent validation). Unknown fields are
 * REJECTED, never silently dropped — injected execution fields cannot ride
 * along. Returns the normalized typed request.
 */
export function validateX402Eip3009SigningRequest(input: unknown): X402Eip3009SigningRequest {
  if (!isPlainObject(input)) {
    throw new X402SigningRequestError("signing request must be a plain object.");
  }
  rejectUnknownFields(input, KNOWN_REQUEST_FIELDS, "signing request");

  const authorizationId = requirePatternField(input, "authorizationId", AUTHORIZATION_ID_PATTERN);
  const parentAuthorizationId = requirePatternField(
    input,
    "parentAuthorizationId",
    AUTHORIZATION_ID_PATTERN
  );
  const auditId = requireStringField(input, "auditId");
  const paymentRequirementDigest = requirePatternField(
    input,
    "paymentRequirementDigest",
    DIGEST_PATTERN
  );
  const network = requirePatternField(input, "network", NETWORK_PATTERN);
  const chainId = requirePatternField(input, "chainId", DOMAIN_PATTERN);
  const assetAddress = requirePatternField(input, "assetAddress", EVM_ADDRESS_PATTERN);
  const payTo = requirePatternField(input, "payTo", EVM_ADDRESS_PATTERN);
  const amountAtomic = requirePatternField(input, "amountAtomic", AMOUNT_PATTERN);
  const payerAddress = requirePatternField(input, "payerAddress", EVM_ADDRESS_PATTERN);
  const nonce = requirePatternField(input, "nonce", NONCE_PATTERN);

  if (input.requestType !== "x402_eip3009_signing_request") {
    throw new X402SigningRequestError('requestType must be "x402_eip3009_signing_request".');
  }
  if (input.version !== "v1") {
    throw new X402SigningRequestError("signing request version must be v1.");
  }
  if (x402NetworkChainId(network) !== chainId) {
    throw new X402SigningRequestError(
      "signing request chainId does not match the CAIP-2 network chain id."
    );
  }

  const eip712 = isPlainObject(input.eip712) ? input.eip712 : null;
  if (eip712 === null) {
    throw new X402SigningRequestError("eip712 must be a plain object.");
  }
  if (eip712.primaryType !== X402_EIP3009_PRIMARY_TYPE) {
    throw new X402SigningRequestError(
      `eip712.primaryType must be "${X402_EIP3009_PRIMARY_TYPE}".`
    );
  }
  const domain = isPlainObject(eip712.domain) ? eip712.domain : null;
  if (domain === null) {
    throw new X402SigningRequestError("eip712.domain must be a plain object.");
  }
  rejectUnknownFields(domain, EIP712_DOMAIN_KNOWN_FIELDS, "eip712.domain");
  const name = requireStringField(domain, "name");
  const version = requireStringField(domain, "version");
  const chainIdValue = domain.chainId;
  if (typeof chainIdValue !== "number" || !Number.isSafeInteger(chainIdValue) || chainIdValue <= 0) {
    throw new X402SigningRequestError("eip712.domain.chainId must be a positive safe integer.");
  }
  if (String(chainIdValue) !== chainId) {
    throw new X402SigningRequestError(
      "eip712.domain.chainId does not match the request chainId."
    );
  }
  const verifyingContract = requirePatternField(domain, "verifyingContract", EVM_ADDRESS_PATTERN);

  const types = parseEip712Types(eip712.types);

  const message = isPlainObject(eip712.message) ? eip712.message : null;
  if (message === null) {
    throw new X402SigningRequestError("eip712.message must be a plain object.");
  }
  rejectUnknownFields(message, EIP712_MESSAGE_KNOWN_FIELDS, "eip712.message");
  const from = requirePatternField(message, "from", EVM_ADDRESS_PATTERN);
  const to = requirePatternField(message, "to", EVM_ADDRESS_PATTERN);
  const value = requirePatternField(message, "value", AMOUNT_PATTERN);
  const validAfter = requirePatternField(message, "validAfter", UNIX_SECONDS_PATTERN);
  const validBefore = requirePatternField(message, "validBefore", UNIX_SECONDS_PATTERN);
  const messageNonce = requirePatternField(message, "nonce", NONCE_PATTERN);

  if (from !== payerAddress) {
    throw new X402SigningRequestError("eip712.message.from must equal payerAddress.");
  }
  if (to !== payTo) {
    throw new X402SigningRequestError("eip712.message.to must equal payTo.");
  }
  if (value !== amountAtomic) {
    throw new X402SigningRequestError("eip712.message.value must equal amountAtomic.");
  }
  if (messageNonce !== nonce) {
    throw new X402SigningRequestError("eip712.message.nonce must equal the request nonce.");
  }
  if (Number(validBefore) <= Number(validAfter)) {
    throw new X402SigningRequestError(
      "eip712.message.validBefore must be strictly greater than validAfter."
    );
  }

  return {
    requestType: "x402_eip3009_signing_request",
    version: "v1",
    authorizationId,
    parentAuthorizationId,
    auditId,
    paymentRequirementDigest,
    network,
    chainId,
    assetAddress,
    payTo,
    amountAtomic,
    payerAddress,
    nonce,
    eip712: {
      domain: { name, version, chainId: chainIdValue, verifyingContract },
      primaryType: X402_EIP3009_PRIMARY_TYPE,
      types,
      message: { from, to, value, validAfter, validBefore, nonce: messageNonce }
    }
  };
}

/**
 * Deterministic digest of the COMPLETE normalized signing request:
 * `sha256:<64 lowercase hex>` via the repo stable-JSON SHA-256 helper.
 * The digest does NOT include itself. It changes when any bound field
 * changes (payer, payTo, amount, nonce, network, chainId, asset/domain,
 * validity window, authorizationId, parentAuthorizationId, auditId,
 * paymentRequirementDigest) and is identical for identical requests.
 */
export function signingRequestDigest(request: X402Eip3009SigningRequest): string {
  return `sha256:${stableSha256(request)}`;
}
