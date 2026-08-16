import { stableSha256 } from "@/lib/stable-json";

/**
 * Deterministic, strictly validated representation of the official x402
 * `PaymentRequirements` object (protocol v2) for the Circle Gateway / Arc
 * Testnet exact-payment EVM path.
 *
 * I1 of the pre-Phase-9 Circle integration track. DATA CONTRACT ONLY: this
 * module never fetches, signs, broadcasts, moves funds, or authorizes
 * execution. Validation is structural (CAIP-2 shape, EVM address shape,
 * canonical base-10 integer string); no Arc/network allowlist lives here
 * (I2 owns allowlisting).
 *
 * Official sources (read 2026-08-16):
 * - S9  x402 protocol spec v2:
 *   https://raw.githubusercontent.com/x402-foundation/x402/main/specs/x402-specification-v2.md
 *   §5.1.2 `PaymentRequirements` field table; §6.1 reserved `extra` keys
 *   (`assetTransferMethod`, `paymentFlow`).
 * - S11 scheme exact:
 *   https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact.md
 * - S12 scheme exact on EVM:
 *   https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_evm.md
 *   eip3009 `extra` field definitions (name/version required; assetTransferMethod
 *   optional, defaults to "eip3009").
 * - S17 Circle Gateway nanopayments seller quickstart:
 *   https://developers.circle.com/gateway/nanopayments/quickstarts/seller.md
 *   Gateway `requirements` object: `extra: { name: "GatewayWalletBatched",
 *   version: "1", verifyingContract }`.
 */

/**
 * Scheme-specific `extra` for the exact-EVM (eip3009) path as used by Circle
 * Gateway nanopayments.
 *
 * Official shape and requiredness (sources in the header comment):
 * - `name` (required): EIP-712 domain name of the token contract (S12).
 *   Gateway nanopayments uses `"GatewayWalletBatched"` (S17).
 * - `version` (required): EIP-712 domain version of the token contract (S12).
 *   Gateway nanopayments uses `"1"` (S17).
 * - `verifyingContract` (required for the Gateway path): EIP-712 domain
 *   verifying contract, i.e. the Gateway Wallet contract on the target chain
 *   (S17). Validated structurally as an EVM address; the concrete allowlisted
 *   address is I2's concern.
 * - `assetTransferMethod` (optional): protocol-reserved key (S9 §6.1). For
 *   exact on EVM it is optional and defaults to `"eip3009"`; if present it
 *   MUST be `"eip3009"` (S12).
 * - `paymentFlow` (optional): protocol-reserved key (S9 §6.1). The exact
 *   scheme's default flow is `"authorization"` (verify → resource → settle)
 *   (S9 §6.1, S11); `"authorization"` MAY be omitted or explicit (S9 §6.1).
 *   Only `"authorization"` is modeled: it is the flow the Gateway settle path
 *   implements (S17); other flows are out of scope for this representation.
 *
 * The protocol-level schema marks `extra` itself as Optional (S9 §5.1.2), but
 * the exact-EVM scheme requires `name` and `version` for the default
 * `eip3009` asset transfer method (S12) and the Gateway nanopayments
 * requirements always carry `verifyingContract` (S17). This module therefore
 * models `extra` as REQUIRED for the Gateway exact-EVM representation
 * (documented decision; see `X402PaymentRequirement.extra`).
 */
export type X402ExactExtra = {
  name: string;
  version: string;
  verifyingContract: string;
  assetTransferMethod?: "eip3009";
  paymentFlow?: "authorization";
};

/**
 * Normalized x402 `PaymentRequirements` object for the exact-EVM / Gateway
 * path. Contains ONLY validated authoritative protocol fields (S9 §5.1.2);
 * no layer-owned fields (no authorizationId, auditId, policyVersion,
 * decision, transactionHash, signature, privateKey, settlementStatus, ...).
 */
export type X402PaymentRequirement = {
  scheme: "exact";
  /** Validated CAIP-2 EVM identifier `eip155:<chainId>`, canonical form kept verbatim. */
  network: string;
  /** Canonical positive base-10 integer STRING in atomic token units (S9 §5.1.2). */
  amount: string;
  /** Validated EVM token contract address, casing preserved (never normalized). */
  asset: string;
  /** Validated EVM recipient address, casing preserved (never normalized). */
  payTo: string;
  /** Positive integer seconds; official schema type is `number` (S9 §5.1.2). */
  maxTimeoutSeconds: number;
  /** Required for the Gateway exact-EVM path; see X402ExactExtra. */
  extra: X402ExactExtra;
};

/**
 * Dedicated error type thrown by `validateX402PaymentRequirement` for any
 * malformed, missing, or unsupported input. Deliberately distinct from the
 * generic `ValidationError` so callers can fail closed on x402 contract
 * violations without catching unrelated validation failures.
 */
export class X402PaymentRequirementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402PaymentRequirementValidationError";
  }
}

const KNOWN_TOP_LEVEL_FIELDS: Record<string, true> = {
  scheme: true,
  network: true,
  amount: true,
  asset: true,
  payTo: true,
  maxTimeoutSeconds: true,
  extra: true
};

const KNOWN_EXTRA_FIELDS: Record<string, true> = {
  name: true,
  version: true,
  verifyingContract: true,
  assetTransferMethod: true,
  paymentFlow: true
};

/** Strict plain-object check matching the repo convention (validation.ts). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requirePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new X402PaymentRequirementValidationError(`${field} must be a plain object.`);
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
      throw new X402PaymentRequirementValidationError(
        `${container} contains an unsupported field: ${field}.`
      );
    }
  }
}

/** Validated EVM address: `0x` + exactly 40 hex chars. Casing is preserved. */
function validateEvmAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new X402PaymentRequirementValidationError(
      `${field} must be an EVM address (0x followed by exactly 40 hexadecimal characters).`
    );
  }
  return value;
}

/**
 * CAIP-2 EVM network identifier, strict canonical form `eip155:<chainId>`
 * where `<chainId>` is a canonical positive decimal integer (S9 §11.1).
 * Rejects: bare chain ids ("5042002"), non-CAIP-2 names ("arcTestnet"),
 * empty reference ("eip155:"), zero ("eip155:0"), negatives ("eip155:-1"),
 * leading zeros ("eip155:05042002"), non-EVM namespaces ("solana:..."), and
 * non-numeric references ("eip155:not-a-number").
 */
function validateNetwork(value: unknown): string {
  if (typeof value !== "string" || !/^eip155:[1-9]\d*$/.test(value)) {
    throw new X402PaymentRequirementValidationError(
      'network must be a CAIP-2 EVM identifier "eip155:<chainId>" with a canonical positive decimal chainId (e.g. "eip155:5042002").'
    );
  }
  return value;
}

/**
 * Canonical base-10 integer STRING in atomic units (S9 §5.1.2: `amount` is a
 * string, "Required payment amount in atomic token units"). Rejects JS
 * numbers, decimals, negatives, exponent notation, whitespace, and any
 * leading-zero form ("00010000"). A leading-zero string is ambiguous as a
 * canonical integer and must not reach the digest.
 *
 * Zero semantics (documented decision): the official schema does not state a
 * minimum; all official examples use positive amounts (e.g. "10000" = 0.01
 * USDC, S17) and the exact scheme requires "the transferred amount MUST equal
 * `requirements.amount` exactly" (S11) for a real transfer of value. A
 * zero-atomic-unit requirement is therefore rejected here (fail-closed guard
 * posture): `amount` must be >= 1 atomic unit. Source of the schema being
 * silent on zero: S9 §5.1.2; S11 amount exactness.
 */
function validateAmount(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new X402PaymentRequirementValidationError(
      "amount must be a canonical base-10 integer string in atomic units with no leading zeros (e.g. \"10000\"), and must be a positive value (zero and negatives are rejected)."
    );
  }
  return value;
}

/**
 * `maxTimeoutSeconds` official schema type is `number` (S9 §5.1.2) — a string
 * is rejected. Must be a positive integer: NaN, Infinity, -Infinity,
 * fractions, zero, negatives, and non-safe integers are rejected.
 */
function validateMaxTimeoutSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new X402PaymentRequirementValidationError(
      "maxTimeoutSeconds must be a positive integer number (official schema type: number)."
    );
  }
  return value;
}

function validateExtra(value: unknown): X402ExactExtra {
  const record = requirePlainObject(value, "extra");
  rejectUnknownFields(record, KNOWN_EXTRA_FIELDS, "extra");

  const name = record.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new X402PaymentRequirementValidationError(
      "extra.name must be a non-empty string (EIP-712 domain name; required for eip3009, S12; Gateway uses \"GatewayWalletBatched\", S17)."
    );
  }
  const version = record.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new X402PaymentRequirementValidationError(
      "extra.version must be a non-empty string (EIP-712 domain version; required for eip3009, S12; Gateway uses \"1\", S17)."
    );
  }
  const verifyingContract = validateEvmAddress(record.verifyingContract, "extra.verifyingContract");

  const extra: X402ExactExtra = { name, version, verifyingContract };

  if (record.assetTransferMethod !== undefined) {
    if (record.assetTransferMethod !== "eip3009") {
      throw new X402PaymentRequirementValidationError(
        'extra.assetTransferMethod, when present, must be "eip3009" (exact on EVM; S12).'
      );
    }
    extra.assetTransferMethod = "eip3009";
  }
  if (record.paymentFlow !== undefined) {
    if (record.paymentFlow !== "authorization") {
      throw new X402PaymentRequirementValidationError(
        'extra.paymentFlow, when present, must be "authorization" (default exact flow, S9 §6.1; the flow the Gateway settle path implements, S17).'
      );
    }
    extra.paymentFlow = "authorization";
  }

  return extra;
}

/**
 * Pure, execution-free validator: no fetch, no filesystem, no environment,
 * no clock, no randomness, no network. Returns the fully normalized typed
 * requirement or throws `X402PaymentRequirementValidationError`.
 *
 * Security-sensitive strictness: unknown top-level fields AND unknown
 * `extra` fields are rejected, never silently dropped. Injected execution
 * fields such as `privateKey`, `signature`, `transactionHash`, `to`, `data`,
 * `execute`, `rpcUrl` therefore fail validation before any digesting.
 */
export function validateX402PaymentRequirement(input: unknown): X402PaymentRequirement {
  if (!isPlainObject(input)) {
    throw new X402PaymentRequirementValidationError(
      "Payment requirement must be a plain object (scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra)."
    );
  }
  rejectUnknownFields(input, KNOWN_TOP_LEVEL_FIELDS, "payment requirement");

  if (input.scheme !== "exact") {
    throw new X402PaymentRequirementValidationError('scheme must be "exact".');
  }

  return {
    scheme: "exact",
    network: validateNetwork(input.network),
    amount: validateAmount(input.amount),
    asset: validateEvmAddress(input.asset, "asset"),
    payTo: validateEvmAddress(input.payTo, "payTo"),
    maxTimeoutSeconds: validateMaxTimeoutSeconds(input.maxTimeoutSeconds),
    extra: validateExtra(input.extra)
  };
}

/**
 * Deterministic digest of a FULLY VALIDATED normalized requirement (never raw
 * unknown input). Reuses the existing stable-JSON canonicalization helper
 * (`stableSha256` in src/lib/stable-json.ts: key-sorted canonical JSON →
 * SHA-256), so object key insertion order is irrelevant, array order is
 * significant where arrays exist, and exact normalized values are
 * significant. Format matches the repo convention: "sha256:<64 lowercase hex>".
 */
export function fingerprintX402PaymentRequirement(requirement: X402PaymentRequirement): string {
  return `sha256:${stableSha256(requirement)}`;
}

/**
 * Pure helper: returns the numeric chain-id string from a validated CAIP-2
 * EVM network identifier (e.g. "eip155:5042002" → "5042002"). No network
 * policy, no allowlist — the input must already be a validated network.
 */
export function x402NetworkChainId(network: string): string {
  const prefix = "eip155:";
  if (!network.startsWith(prefix)) {
    throw new X402PaymentRequirementValidationError(
      `network must be a validated CAIP-2 EVM identifier "${prefix}<chainId>"; got "${network}".`
    );
  }
  return network.slice(prefix.length);
}
