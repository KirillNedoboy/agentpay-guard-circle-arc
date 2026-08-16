#!/usr/bin/env node
/**
 * x402-external-signer.mjs — OFFLINE reference EIP-3009 signer (I4).
 *
 * A separate process/tool. MUST NOT be imported by src/ — the private key
 * lives ONLY in this process's environment (`AGENTPAY_X402_SIGNER_PRIVATE_KEY`)
 * and never enters src/, the Next.js runtime, the policy engine, the
 * execution store, the audit log, or the observation log.
 *
 * Contract:
 *   stdin  — one JSON envelope:
 *            { signingRequestDigest, request } where `request` is the
 *            Guard-built `X402Eip3009SigningRequest` (strictly validated
 *            here) and `signingRequestDigest` is the Guard-computed digest
 *            of that request (the signer echoes it; it never recomputes it —
 *            digest authority stays in the Guard).
 *   stdout — one JSON signer response:
 *            { responseType: "x402_eip3009_signature", version: "v1",
 *              signingRequestDigest, payerAddress, signature }
 *   stderr — JSON error object on failure (never secrets).
 *   exit   — 0 on success, non-zero on failure.
 *
 * Behavior:
 *   - reads the private key ONLY from process.env.AGENTPAY_X402_SIGNER_PRIVATE_KEY;
 *   - derives the EOA via viem `privateKeyToAccount`;
 *   - requires the derived address to semantically equal request.payerAddress
 *     (else exit non-zero; no signature is produced);
 *   - signs EXACTLY the supplied typed data (request.eip712 domain/types/message)
 *     via viem `signTypedData` — it signs what the Guard asked, nothing else;
 *   - echoes `signingRequestDigest` verbatim from the envelope.
 *
 * NO network at all: no fetch, no RPC, no Gateway, no transaction submission,
 * no balance queries, no key writes to disk, no key/environment printing.
 */

import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const AUTHORIZATION_ID_PATTERN = /^auth_[0-9a-f]{64}$/;
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NETWORK_PATTERN = /^eip155:[1-9]\d*$/;
const AMOUNT_PATTERN = /^[1-9]\d*$/;
const UNIX_SECONDS_PATTERN = /^[1-9]\d*$/;

const KNOWN_ENVELOPE_FIELDS = new Set(["signingRequestDigest", "request"]);

const KNOWN_REQUEST_FIELDS = new Set([
  "requestType",
  "version",
  "authorizationId",
  "parentAuthorizationId",
  "auditId",
  "paymentRequirementDigest",
  "network",
  "chainId",
  "assetAddress",
  "payTo",
  "amountAtomic",
  "payerAddress",
  "nonce",
  "eip712"
]);

const KNOWN_DOMAIN_FIELDS = new Set(["name", "version", "chainId", "verifyingContract"]);
const KNOWN_MESSAGE_FIELDS = new Set([
  "from",
  "to",
  "value",
  "validAfter",
  "validBefore",
  "nonce"
]);

function fail(message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function requirePattern(value, field, pattern) {
  const string = requireString(value, field);
  if (!pattern.test(string)) {
    throw new Error(`${field} has an invalid format.`);
  }
  return string;
}

function rejectUnknownFields(record, known, container) {
  for (const field of Object.keys(record)) {
    if (!known.has(field)) {
      throw new Error(`${container} contains an unsupported field: ${field}.`);
    }
  }
}

/** Strict structural validation of the Guard-built signing request. */
function parseRequest(input) {
  if (!isPlainObject(input)) {
    throw new Error("Signing request must be a plain object.");
  }
  rejectUnknownFields(input, KNOWN_REQUEST_FIELDS, "signing request");
  if (input.requestType !== "x402_eip3009_signing_request") {
    throw new Error('requestType must be "x402_eip3009_signing_request".');
  }
  if (input.version !== "v1") {
    throw new Error("Signing request version must be v1.");
  }
  const request = {
    authorizationId: requirePattern(input.authorizationId, "authorizationId", AUTHORIZATION_ID_PATTERN),
    parentAuthorizationId: requirePattern(input.parentAuthorizationId, "parentAuthorizationId", AUTHORIZATION_ID_PATTERN),
    auditId: requireString(input.auditId, "auditId"),
    paymentRequirementDigest: requirePattern(input.paymentRequirementDigest, "paymentRequirementDigest", DIGEST_PATTERN),
    network: requirePattern(input.network, "network", NETWORK_PATTERN),
    chainId: requirePattern(input.chainId, "chainId", /^[1-9]\d*$/),
    assetAddress: requirePattern(input.assetAddress, "assetAddress", EVM_ADDRESS_PATTERN),
    payTo: requirePattern(input.payTo, "payTo", EVM_ADDRESS_PATTERN),
    amountAtomic: requirePattern(input.amountAtomic, "amountAtomic", AMOUNT_PATTERN),
    payerAddress: requirePattern(input.payerAddress, "payerAddress", EVM_ADDRESS_PATTERN),
    nonce: requirePattern(input.nonce, "nonce", NONCE_PATTERN),
    eip712: input.eip712
  };

  const eip712 = input.eip712;
  if (!isPlainObject(eip712)) {
    throw new Error("eip712 must be a plain object.");
  }
  if (eip712.primaryType !== "TransferWithAuthorization") {
    throw new Error('eip712.primaryType must be "TransferWithAuthorization".');
  }
  const domain = eip712.domain;
  if (!isPlainObject(domain)) {
    throw new Error("eip712.domain must be a plain object.");
  }
  rejectUnknownFields(domain, KNOWN_DOMAIN_FIELDS, "eip712.domain");
  const domainName = requireString(domain.name, "eip712.domain.name");
  const domainVersion = requireString(domain.version, "eip712.domain.version");
  const chainId = domain.chainId;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("eip712.domain.chainId must be a positive safe integer.");
  }
  if (String(chainId) !== request.chainId) {
    throw new Error("eip712.domain.chainId does not match the request chainId.");
  }
  const verifyingContract = requirePattern(domain.verifyingContract, "eip712.domain.verifyingContract", EVM_ADDRESS_PATTERN);

  const types = eip712.types;
  if (!isPlainObject(types)) {
    throw new Error("eip712.types must be a plain object.");
  }
  const typeKeys = Object.keys(types);
  if (typeKeys.length !== 1 || typeKeys[0] !== "TransferWithAuthorization") {
    throw new Error('eip712.types must contain exactly the "TransferWithAuthorization" type.');
  }
  const parameters = types.TransferWithAuthorization;
  if (!Array.isArray(parameters) || parameters.length !== 6) {
    throw new Error("eip712.types.TransferWithAuthorization must be the exact 6-field EIP-3009 parameter list.");
  }
  const expected = [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ];
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index];
    if (!isPlainObject(parameter)) {
      throw new Error("eip712.types.TransferWithAuthorization entries must be plain objects.");
    }
    if (parameter.name !== expected[index].name || parameter.type !== expected[index].type) {
      throw new Error("eip712.types.TransferWithAuthorization does not match the exact official EIP-3009 field list.");
    }
  }

  const message = eip712.message;
  if (!isPlainObject(message)) {
    throw new Error("eip712.message must be a plain object.");
  }
  rejectUnknownFields(message, KNOWN_MESSAGE_FIELDS, "eip712.message");
  const from = requirePattern(message.from, "eip712.message.from", EVM_ADDRESS_PATTERN);
  const to = requirePattern(message.to, "eip712.message.to", EVM_ADDRESS_PATTERN);
  const value = requirePattern(message.value, "eip712.message.value", AMOUNT_PATTERN);
  const validAfter = requirePattern(message.validAfter, "eip712.message.validAfter", UNIX_SECONDS_PATTERN);
  const validBefore = requirePattern(message.validBefore, "eip712.message.validBefore", UNIX_SECONDS_PATTERN);
  const nonce = requirePattern(message.nonce, "eip712.message.nonce", NONCE_PATTERN);

  if (from !== request.payerAddress) {
    throw new Error("eip712.message.from must equal payerAddress.");
  }
  if (to !== request.payTo) {
    throw new Error("eip712.message.to must equal payTo.");
  }
  if (value !== request.amountAtomic) {
    throw new Error("eip712.message.value must equal amountAtomic.");
  }
  if (nonce !== request.nonce) {
    throw new Error("eip712.message.nonce must equal the request nonce.");
  }
  if (Number(validBefore) <= Number(validAfter)) {
    throw new Error("eip712.message.validBefore must be strictly greater than validAfter.");
  }

  return {
    ...request,
    eip712: {
      domain: { name: domainName, version: domainVersion, chainId, verifyingContract },
      primaryType: "TransferWithAuthorization",
      types,
      message: { from, to, value, validAfter, validBefore, nonce }
    }
  };
}

try {
  const stdin = readFileSync(0, "utf8").trim();
  if (stdin.length === 0) {
    fail("No signing request received on stdin.");
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(stdin);
  } catch {
    fail("stdin is not valid JSON.");
    process.exit(1);
  }
  if (!isPlainObject(raw)) {
    fail("stdin must be a JSON envelope object.");
    process.exit(1);
  }
  rejectUnknownFields(raw, KNOWN_ENVELOPE_FIELDS, "envelope");

  const signingRequestDigest = requirePattern(raw.signingRequestDigest, "signingRequestDigest", DIGEST_PATTERN);
  let request;
  try {
    request = parseRequest(raw.request);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid signing request.");
    process.exit(1);
  }

  const privateKey = process.env.AGENTPAY_X402_SIGNER_PRIVATE_KEY;
  if (typeof privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    fail("AGENTPAY_X402_SIGNER_PRIVATE_KEY must be set to a 32-byte hex private key (0x + 64 hex).");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== request.payerAddress.toLowerCase()) {
    fail("Derived EOA address does not match request.payerAddress.");
    process.exit(1);
  }

  const signature = await account.signTypedData({
    domain: request.eip712.domain,
    types: request.eip712.types,
    primaryType: request.eip712.primaryType,
    message: request.eip712.message
  });

  process.stdout.write(
    `${JSON.stringify({
      responseType: "x402_eip3009_signature",
      version: "v1",
      signingRequestDigest,
      payerAddress: request.payerAddress,
      signature
    })}\n`
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "Unexpected signer failure.");
  process.exit(1);
}
