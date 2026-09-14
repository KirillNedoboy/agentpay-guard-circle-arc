/**
 * I5 — Circle Gateway x402 wire contract (pre-Phase-9 Circle integration
 * track). Type-only protocol module: normalized names + strict hand-rolled
 * validators for the OFFICIAL Circle Gateway OpenAPI document
 * (https://developers.circle.com/openapi/gateway.yaml, accessed 2026-09-14;
 * generated from crcl-main/w3s-openapi-internal). Every official→normalized
 * mapping lives in exactly one place: the validators below, each annotated
 * with the official wire field name.
 *
 * Key semantic distinction (verified against the official schema):
 * - settle `transaction` = a TRANSFER UUID ("Transaction UUID on success,
 *   empty string on failure"). It is NEVER a transaction hash.
 * - transfer `txHash` = the BATCH-level settlement transaction hash "shared
 *   by all transfers in the same batch. Remains null until included in a
 *   batch with a settlement transaction hash." It is NEVER a per-payment hash.
 *
 * Fail-closed posture: `success: true` is only trusted after the complete
 * shape validates; unknown/extra fields are rejected; nothing is fabricated.
 * No logging anywhere in this module (no console.*).
 */
import type { X402PaymentRequirement } from "@/domain/x402/payment-requirement";
import type { X402SignedPaymentPayload } from "@/domain/x402/external-signer";

/** Official testnet server, first entry of `servers:` in the OpenAPI document. */
export const GATEWAY_TESTNET_ORIGIN = "https://gateway-api-testnet.circle.com" as const;

/** Official settle path: `POST /v1/x402/settle` (operationId SettleX402Payment). */
export const GATEWAY_SETTLE_PATH = "/v1/x402/settle" as const;

/** Official transfers path: `GET /v1/x402/transfers` (SearchX402Transfers) and `GET /v1/x402/transfers/{id}` (GetX402TransferById). */
export const GATEWAY_TRANSFERS_PATH = "/v1/x402/transfers" as const;

/**
 * Official `X402TransferResponse.status` enum, verbatim:
 * received | batched | confirmed | completed | failed.
 */
export type GatewayTransferStatus =
  | "received"
  | "batched"
  | "confirmed"
  | "completed"
  | "failed";

export const GATEWAY_TRANSFER_STATUSES: readonly GatewayTransferStatus[] = [
  "received",
  "batched",
  "confirmed",
  "completed",
  "failed"
] as const;

/**
 * Official settle `errorReason` values (union is a superset):
 * - the 15 values below the divider are the 200-response enum verbatim;
 * - `unexpected_error` is NOT in the 200 enum — it is the errorReason example
 *   of the official 500 ("Unexpected infrastructure error") shape, where
 *   errorReason is required. It is kept in the union so the validator accepts
 *   the official 500 body.
 */
export type GatewaySettleErrorReason =
  | "unsupported_scheme"
  | "unsupported_network"
  | "unsupported_asset"
  | "invalid_payload"
  | "address_mismatch"
  | "amount_mismatch"
  | "invalid_signature"
  | "authorization_not_yet_valid"
  | "authorization_expired"
  | "authorization_validity_too_short"
  | "self_transfer"
  | "insufficient_balance"
  | "nonce_already_used"
  | "unsupported_domain"
  | "wallet_not_found"
  | "unexpected_error"; // official 500 shape only

export const GATEWAY_SETTLE_ERROR_REASONS: readonly GatewaySettleErrorReason[] = [
  "unsupported_scheme",
  "unsupported_network",
  "unsupported_asset",
  "invalid_payload",
  "address_mismatch",
  "amount_mismatch",
  "invalid_signature",
  "authorization_not_yet_valid",
  "authorization_expired",
  "authorization_validity_too_short",
  "self_transfer",
  "insufficient_balance",
  "nonce_already_used",
  "unsupported_domain",
  "wallet_not_found",
  // 500 "Unexpected infrastructure error" shape only:
  "unexpected_error"
] as const;

/**
 * Normalized settle response. Official wire shape (200 & 500 bodies):
 * { success: boolean; transaction: string; network: string;
 *   errorReason?: string; payer?: string } with required [success,
 *   transaction, network].
 * - official `payer` (optional, "present on success or when identifiable")
 *   → `payerAddress`, null only when absent.
 * - official `errorReason` (optional per the 200 schema; "present when
 *   success is false") → nullable, null only when absent.
 */
export type GatewaySettleResponse = {
  readonly success: boolean;
  /** Official `transaction`: transfer UUID, empty string on failure. NEVER a tx hash. */
  readonly transaction: string;
  /** Official `network`: CAIP-2 network identifier. */
  readonly network: string;
  readonly errorReason: GatewaySettleErrorReason | null;
  readonly payerAddress: string | null;
};

/**
 * Normalized x402 transfer snapshot. Official wire shape
 * `X402TransferResponse` (required: id, status, token, sendingNetwork,
 * recipientNetwork, fromAddress, toAddress, amount, nonce, txHash,
 * createdAt, updatedAt).
 * - official `id` (format uuid) → transferId — NEVER a tx hash.
 * - official `fromAddress`/`toAddress` → payerAddress/payToAddress.
 * - official `amount` ("Transfer amount in atomic units.") → amountAtomic.
 * - official `token` ("Token symbol (e.g., USDC).", example USDC) → token,
 *   VERBATIM, never coerced (symbol-only; there is no asset-address field in
 *   the official schema).
 * - official `txHash` (nullable) → batchTxHash (batch-level only).
 * - official `createdAt`/`updatedAt` are required strings but are not needed
 *   in the snapshot; they are validated and ignored (see validator).
 */
export type GatewayTransferSnapshot = {
  readonly transferId: string;
  readonly status: GatewayTransferStatus;
  readonly nonce: string;
  readonly sendingNetwork: string;
  readonly recipientNetwork: string;
  readonly payerAddress: string;
  readonly payToAddress: string;
  readonly amountAtomic: string;
  readonly token: string;
  readonly batchTxHash: string | null;
};

/**
 * Settle request body contract. Official wire request body of
 * `POST /v1/x402/settle`: exactly { paymentPayload, paymentRequirements }
 * (both required). x402Version lives INSIDE paymentPayload — never at the
 * top level.
 */
export type GatewaySettleRequest = {
  readonly paymentPayload: X402SignedPaymentPayload;
  readonly paymentRequirements: X402PaymentRequirement;
};

export type GatewayContractErrorCode =
  | "GATEWAY_CONTRACT_JSON_INVALID"
  | "GATEWAY_CONTRACT_FIELD_MISSING"
  | "GATEWAY_CONTRACT_UNKNOWN_FIELD"
  | "GATEWAY_CONTRACT_FIELD_INVALID";

/** Fail-closed contract error; carries a stable machine-readable code. */
export class GatewayContractError extends Error {
  readonly code: GatewayContractErrorCode;

  constructor(message: string, code: GatewayContractErrorCode) {
    super(message);
    this.name = "GatewayContractError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Official field-name sets (for strict unknown-field rejection).
// ---------------------------------------------------------------------------

/** Official settle response properties (200 + 500 shapes). */
const SETTLE_RESPONSE_KNOWN_FIELDS: Record<string, true> = {
  success: true,
  transaction: true,
  network: true,
  errorReason: true,
  payer: true
};

/** Official `X402TransferResponse` properties — all 12, verbatim. */
const TRANSFER_KNOWN_FIELDS: Record<string, true> = {
  id: true,
  status: true,
  token: true,
  sendingNetwork: true,
  recipientNetwork: true,
  fromAddress: true,
  toAddress: true,
  amount: true,
  nonce: true,
  txHash: true,
  createdAt: true,
  updatedAt: true
};

/**
 * Official `GET /v1/x402/transfers` 200 body: `{ transfers:
 * X402TransferResponse[] }` — the envelope key is `transfers` verbatim; the
 * 200 body schema documents no other property (pageAfter/pageBefore are
 * request query parameters only, never response body keys).
 */
const LIST_ENVELOPE_KNOWN_FIELDS: Record<string, true> = {
  transfers: true
};

// ---------------------------------------------------------------------------
// Official format patterns.
// ---------------------------------------------------------------------------

/** Official `id` format: uuid. */
const TRANSFER_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Official nonce pattern is loose (`^0x[a-fA-F0-9]+$`); we deliberately
 * tighten to the canonical 32-byte lowercase form used by this codebase's
 * nonce derivation (execution-store NONCE_PATTERN) — fail-closed on anything
 * else.
 */
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;

/** EVM address: `0x` + 40 hex chars (casing preserved verbatim). */
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** CAIP-2 EVM identifier, canonical `eip155:<positive chainId>`. */
const NETWORK_PATTERN = /^eip155:[1-9]\d*$/;

/** Canonical base-10 integer string in atomic units; positive, no leading zeros (repo convention). */
const AMOUNT_PATTERN = /^[1-9]\d*$/;

/** Official `token` is a SYMBOL ("Token symbol (e.g., USDC).") — uppercase letters/digits only, never an address. */
const TOKEN_PATTERN = /^[A-Z0-9]{2,10}$/;

/** 0x 32-byte hash (batch-level settlement tx hash). */
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** RFC 3339-ish datetime the official schema marks as format date-time. */
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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
  code: GatewayContractErrorCode,
  message: string
): GatewayContractError {
  return new GatewayContractError(message, code);
}

function requirePlainObject(value: unknown, container: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw contractError(
      "GATEWAY_CONTRACT_JSON_INVALID",
      `${container} must be a JSON plain object.`
    );
  }
  return value;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  knownFields: Readonly<Record<string, true>>,
  container: string
): void {
  for (const field of Object.keys(record)) {
    if (!knownFields[field]) {
      throw contractError(
        "GATEWAY_CONTRACT_UNKNOWN_FIELD",
        `${container} contains an unsupported field: ${field}.`
      );
    }
  }
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** Distinguish absence (undefined) from a present-but-invalid value. */
function isMissing(value: unknown): boolean {
  return value === undefined;
}

/** Official format is date-time; validate structure AND calendar sanity. */
function isIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

// ---------------------------------------------------------------------------
// Validators (the SINGLE place where official wire names map to normalized
// names — every mapping is annotated with the official field name).
// ---------------------------------------------------------------------------

/**
 * Validates an official settle response body (200 or 500 shape) into the
 * normalized GatewaySettleResponse.
 *
 * Official (https://developers.circle.com/openapi/gateway.yaml, 2026-09-14):
 * - required: success, transaction, network
 * - success: boolean — "Whether the settlement was successful."
 * - transaction: string — "Transaction UUID on success, empty string on
 *   failure." (transfer UUID, NOT a tx hash)
 * - network: string — "CAIP-2 network identifier."
 * - errorReason: string enum — "Error code. Present when success is false."
 *   (200 enum: 15 values; the 500 shape's errorReason example is
 *   `unexpected_error`, included in our union.)
 * - payer: string (optional) — "The sender address (present on success or
 *   when identifiable)."
 */
export function validateGatewaySettleResponse(input: unknown): GatewaySettleResponse {
  const record = requirePlainObject(input, "settle response");
  rejectUnknownFields(record, SETTLE_RESPONSE_KNOWN_FIELDS, "settle response");

  if (isMissing(record.success)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'settle response is missing the required field "success".'
    );
  }
  if (typeof record.success !== "boolean") {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"success" must be a boolean (official type: boolean).'
    );
  }
  const success = record.success as boolean;

  if (isMissing(record.transaction)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'settle response is missing the required field "transaction".'
    );
  }
  if (typeof record.transaction !== "string") {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"transaction" must be a string (official type: string).'
    );
  }
  const transaction = record.transaction as string;
  // Official: "Transaction UUID on success, empty string on failure."
  if (success === true) {
    if (!TRANSFER_ID_PATTERN.test(transaction)) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        '"transaction" must be a transfer UUID when success is true (official: "Transaction UUID on success").'
      );
    }
  } else if (transaction !== "" && !TRANSFER_ID_PATTERN.test(transaction)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"transaction" must be empty or a transfer UUID when success is false (official: "empty string on failure").'
    );
  }

  if (isMissing(record.network)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'settle response is missing the required field "network".'
    );
  }
  if (typeof record.network !== "string" || !NETWORK_PATTERN.test(record.network as string)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"network" must be a CAIP-2 EVM identifier "eip155:<chainId>" (official: "CAIP-2 network identifier").'
    );
  }

  let errorReason: GatewaySettleErrorReason | null = null;
  if (record.errorReason !== undefined) {
    if (record.errorReason === null || typeof record.errorReason !== "string") {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        '"errorReason" must be a string from the official enum when present.'
      );
    }
    const reason = record.errorReason as string;
    if (!(GATEWAY_SETTLE_ERROR_REASONS as readonly string[]).includes(reason)) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        `"errorReason" has an unsupported value: ${reason}.`
      );
    }
    errorReason = reason as GatewaySettleErrorReason;
  }
  // Official: "present when success is false" — a success claim carrying an
  // error reason is a contradiction and is rejected (fail-closed).
  if (success === true && errorReason !== null) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"errorReason" must be absent when success is true (official: "Error code. Present when success is false.").'
    );
  }

  let payerAddress: string | null = null;
  if (record.payer !== undefined) {
    if (record.payer === null || typeof record.payer !== "string") {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        '"payer" must be a non-null string when present (official field "payer").'
      );
    }
    if (!EVM_ADDRESS_PATTERN.test(record.payer as string)) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        '"payer" must be an EVM address (0x + 40 hex, official: "The sender address").'
      );
    }
    payerAddress = record.payer as string;
  }

  return {
    success,
    transaction,
    network: record.network as string,
    errorReason,
    payerAddress
  };
}

/**
 * Validates one official `X402TransferResponse` into the normalized
 * GatewayTransferSnapshot. Official required fields: id, status, token,
 * sendingNetwork, recipientNetwork, fromAddress, toAddress, amount, nonce,
 * txHash, createdAt, updatedAt. `txHash` is required but nullable;
 * `createdAt`/`updatedAt` are validated (present, date-time string) but not
 * carried into the snapshot.
 *
 * Official mapping (https://developers.circle.com/openapi/gateway.yaml,
 * 2026-09-14): id→transferId, status→status, token→token (symbol verbatim,
 * e.g. USDC), sendingNetwork→sendingNetwork, recipientNetwork→
 * recipientNetwork, fromAddress→payerAddress, toAddress→payToAddress,
 * amount→amountAtomic, nonce→nonce, txHash→batchTxHash.
 */
export function validateGatewayTransferSnapshot(input: unknown): GatewayTransferSnapshot {
  const record = requirePlainObject(input, "x402 transfer");
  rejectUnknownFields(record, TRANSFER_KNOWN_FIELDS, "x402 transfer");

  // official `id` (format: uuid) → transferId (transfer UUID, never a tx hash)
  if (isMissing(record.id)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'x402 transfer is missing the required field "id".'
    );
  }
  if (typeof record.id !== "string" || !TRANSFER_ID_PATTERN.test(record.id as string)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"id" must be a transfer UUID (official format: uuid).'
    );
  }

  // official `status` → status
  if (isMissing(record.status)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'x402 transfer is missing the required field "status".'
    );
  }
  if (typeof record.status !== "string") {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"status" must be a string from the official enum.'
    );
  }
  const status = record.status as string;
  if (!(GATEWAY_TRANSFER_STATUSES as readonly string[]).includes(status)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      `"status" has an unsupported value: ${status}.`
    );
  }

  // official `token` → token, VERBATIM. Symbol only (official: "Token symbol
  // (e.g., USDC).", example USDC) — never coerced to nor parsed as an address.
  if (isMissing(record.token)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'x402 transfer is missing the required field "token".'
    );
  }
  if (typeof record.token !== "string" || !TOKEN_PATTERN.test(record.token as string)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"token" must be a short uppercase token symbol (official: "Token symbol (e.g., USDC).").'
    );
  }

  // official `sendingNetwork` / `recipientNetwork` (CAIP-2) → verbatim
  for (const field of ["sendingNetwork", "recipientNetwork"] as const) {
    if (isMissing(record[field])) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_MISSING",
        `x402 transfer is missing the required field "${field}".`
      );
    }
    if (typeof record[field] !== "string" || !NETWORK_PATTERN.test(record[field] as string)) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        `"${field}" must be a CAIP-2 EVM identifier "eip155:<chainId>".`
      );
    }
  }

  // official `fromAddress` → payerAddress ; official `toAddress` → payToAddress
  for (const officialField of ["fromAddress", "toAddress"] as const) {
    if (isMissing(record[officialField])) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_MISSING",
        `x402 transfer is missing the required field "${officialField}".`
      );
    }
    if (
      typeof record[officialField] !== "string" ||
      !EVM_ADDRESS_PATTERN.test(record[officialField] as string)
    ) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        `"${officialField}" must be an EVM address (0x + 40 hex).`
      );
    }
  }

  // official `amount` → amountAtomic ("Transfer amount in atomic units.")
  if (isMissing(record.amount)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'x402 transfer is missing the required field "amount".'
    );
  }
  if (typeof record.amount !== "string" || !AMOUNT_PATTERN.test(record.amount as string)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"amount" must be a canonical base-10 integer string in atomic units with no leading zeros (official: "Transfer amount in atomic units.").'
    );
  }

  // official `nonce` → nonce (EIP-3009 nonce; canonical 0x + 64 lowercase hex)
  if (isMissing(record.nonce)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'x402 transfer is missing the required field "nonce".'
    );
  }
  if (typeof record.nonce !== "string" || !NONCE_PATTERN.test(record.nonce as string)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"nonce" must be 0x + 64 lowercase hex characters (EIP-3009 nonce).'
    );
  }

  // official `txHash` → batchTxHash. Required but nullable; when non-null it
  // is the BATCH-level settlement tx hash (never a per-payment hash).
  if (isMissing(record.txHash)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'x402 transfer is missing the required field "txHash" (official: required, nullable).'
    );
  }
  let batchTxHash: string | null = null;
  if (record.txHash !== null) {
    if (typeof record.txHash !== "string" || !TX_HASH_PATTERN.test(record.txHash as string)) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        '"txHash" must be a 0x 32-byte hash when non-null (official: "Batch-level settlement transaction hash ... Remains null until included in a batch with a settlement transaction hash.").'
      );
    }
    batchTxHash = record.txHash as string;
  }

  // official `createdAt`/`updatedAt` (required, format date-time) — validated
  // for presence and format, deliberately not carried into the snapshot.
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (isMissing(record[field])) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_MISSING",
        `x402 transfer is missing the required field "${field}".`
      );
    }
    if (typeof record[field] !== "string" || !isIsoTimestamp(record[field] as string)) {
      throw contractError(
        "GATEWAY_CONTRACT_FIELD_INVALID",
        `"${field}" must be an ISO-8601 date-time string (official format: date-time).`
      );
    }
  }

  return {
    transferId: record.id as string,
    status: status as GatewayTransferStatus,
    nonce: record.nonce as string,
    sendingNetwork: record.sendingNetwork as string,
    recipientNetwork: record.recipientNetwork as string,
    payerAddress: record.fromAddress as string,
    payToAddress: record.toAddress as string,
    amountAtomic: record.amount as string,
    token: record.token as string,
    batchTxHash
  };
}

/**
 * Unwraps the official list envelope of `GET /v1/x402/transfers`. Official
 * 200 body schema: `{ transfers: X402TransferResponse[] }` — envelope key
 * `transfers` verbatim, and no other documented envelope property.
 */
export function parseGatewayTransfersListResponse(input: unknown): GatewayTransferSnapshot[] {
  const record = requirePlainObject(input, "transfers list response");
  rejectUnknownFields(record, LIST_ENVELOPE_KNOWN_FIELDS, "transfers list response");

  if (!isPresent(record.transfers)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'transfers list response is missing the official envelope key "transfers".'
    );
  }
  if (!Array.isArray(record.transfers)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_INVALID",
      '"transfers" must be an array (official: "transfers: array of X402TransferResponse").'
    );
  }

  const transfers = record.transfers as unknown[];
  return transfers.map((item, index) => {
    try {
      return validateGatewayTransferSnapshot(item);
    } catch (error) {
      if (error instanceof GatewayContractError) {
        throw contractError(
          error.code,
          `transfers[${index}]: ${error.message}`
        );
      }
      throw error;
    }
  });
}

/**
 * Builds the exact JSON request body of `POST /v1/x402/settle`. Official
 * request body: exactly `{ paymentPayload, paymentRequirements }` (both
 * required) — NO top-level `x402Version` (x402Version lives inside
 * paymentPayload). Only the two official properties are ever serialized;
 * caller-supplied extra top-level keys are never emitted.
 */
export function buildGatewaySettleRequestBody(request: GatewaySettleRequest): string {
  if (!isPlainObject(request)) {
    throw contractError(
      "GATEWAY_CONTRACT_JSON_INVALID",
      "settle request must be a JSON plain object."
    );
  }
  if (!isPresent(request.paymentPayload)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'settle request is missing the required field "paymentPayload".'
    );
  }
  if (!isPresent(request.paymentRequirements)) {
    throw contractError(
      "GATEWAY_CONTRACT_FIELD_MISSING",
      'settle request is missing the required field "paymentRequirements".'
    );
  }
  // Official property order: paymentPayload, paymentRequirements. Only these
  // two named properties are serialized — no x402Version at top level, and no
  // caller-supplied extra keys can reach the wire.
  return JSON.stringify({
    paymentPayload: request.paymentPayload,
    paymentRequirements: request.paymentRequirements
  });
}