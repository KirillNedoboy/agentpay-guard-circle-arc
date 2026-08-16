/**
 * x402-external-signer.test.ts
 *
 * I4 — bounded external EOA signer boundary tests: I3 prepared execution
 * record → exact EIP-3009 signing request → key-isolated external signer →
 * cryptographically verified signature → transient x402 PaymentPayload →
 * deterministic signerPayloadDigest → I3 submitted → STOP.
 *
 * Conventions (matching the repo suite): temp execution-store paths ONLY
 * (mkdtempSync — never data/execution-store/); temp audit paths with
 * AGENTPAY_* env overrides restored in afterEach; no Gateway calls, no
 * /verify, no /settle, no Arc RPC, no HTTP payment requests, no broadcast;
 * deterministic TEST-ONLY addresses; explicit `now`/`occurredAt` values —
 * no sleeps, no machine-clock dependence, no Date.now() in the orchestrator;
 * EPHEMERAL EOAs generated at runtime (viem generatePrivateKey) — never
 * hardcoded, never persisted, never printed.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import type { ReplayEvidence } from "@/domain/audit/replay-evidence";
import { evaluatePaymentIntent } from "@/domain/payment-intent/evaluate";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import {
  fingerprintX402PaymentRequirement,
  validateX402PaymentRequirement,
  type X402PaymentRequirement
} from "@/domain/x402/payment-requirement";
import {
  buildPaymentRequirementEvidence,
  type PaymentRequirementEvidence
} from "@/domain/x402/payment-requirement-evidence";
import {
  evaluateX402ExecutionGate,
  X402_EXECUTION_GATE_ALLOWED_REASON_CODE,
  type X402ExecutionGateInput,
  type X402ExecutionGateResult,
  type X402RecipientBinding
} from "@/domain/x402/execution-security-gate";
import type { X402ExecutionAuthorizationV2 } from "@/domain/x402/execution-authorization-v2";
import {
  deriveX402ExecutionNonce,
  prepareX402ExecutionAttempt,
  readX402ExecutionRecord,
  X402_EXECUTION_ALREADY_CONSUMED,
  X402_EXECUTION_GATE_NOT_ELIGIBLE,
  type X402PreparedExecutionRecord
} from "@/domain/x402/execution-store";
import {
  buildX402Eip3009SigningRequest,
  deriveX402Eip3009ValidityWindow,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
  GATEWAY_VALID_AFTER_BACKDATING_SECONDS,
  signingRequestDigest,
  validateX402Eip3009SigningRequest,
  X402SigningRequestError,
  X402_EIP3009_PRIMARY_TYPE,
  type X402Eip3009SigningRequest
} from "@/domain/x402/eip3009-signing-request";
import {
  buildX402SignedPaymentPayload,
  signerPayloadDigest,
  type X402ExternalSigner,
  type X402ExternalSignerResponse,
  type X402SignedPaymentPayload
} from "@/domain/x402/external-signer";
import {
  signPreparedX402Execution,
  X402_SIGNER_AUTHORIZATION_EXPIRED,
  X402_SIGNER_EXECUTION_NOT_FOUND,
  X402_SIGNER_EXECUTION_NOT_PREPARED,
  X402_SIGNER_EXTERNAL_FAILURE,
  X402_SIGNER_PAYER_ADDRESS_INVALID,
  X402_SIGNER_PAYER_MISMATCH,
  X402_SIGNER_PREPARED_BINDING_MISMATCH,
  X402_SIGNER_READY,
  X402_SIGNER_REQUEST_DIGEST_MISMATCH,
  X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH,
  X402_SIGNER_RESPONSE_INVALID,
  X402_SIGNER_SIGNATURE_INVALID,
  X402_SIGNER_STATE_CONFLICT,
  type X402SignerResult
} from "@/domain/x402/sign-prepared-x402-execution";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex, type TypedDataDomain } from "viem";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const TEST_PAYTO = "0x1111111111111111111111111111111111111111";
const TEST_PAYTO_ALT = "0x2222222222222222222222222222222222222222";

const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-signer-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

function makeTempStorePath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-signer-"));
  tempDirs.push(dir);
  return join(dir, "execution-store");
}

afterEach(() => {
  if (previousAuditPath === undefined) {
    delete process.env.AGENTPAY_AUDIT_LOG_PATH;
  } else {
    process.env.AGENTPAY_AUDIT_LOG_PATH = previousAuditPath;
  }
  if (previousObservationPath === undefined) {
    delete process.env.AGENTPAY_OBSERVATION_LOG_PATH;
  } else {
    process.env.AGENTPAY_OBSERVATION_LOG_PATH = previousObservationPath;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixtures (mirroring the I2/I3 suites; deterministic TEST-ONLY addresses).
// ---------------------------------------------------------------------------

function makeV1Authorization(overrides: Partial<ExecutionAuthorization> = {}): ExecutionAuthorization {
  return {
    authorizationType: "execution_authorization",
    version: "v1",
    authorizationId: `auth_${"a".repeat(64)}`,
    scope: "single_intent",
    intentId: "intent_demo_001",
    idempotencyKey: "demo-auth-001",
    auditId: "audit_20260707_000001",
    agentId: "agent_auth_demo_001",
    recipient: "trusted-x402-api.demo",
    asset: "USDC",
    maxAmountUSDC: "0.08",
    paymentRail: "mock_x402_service",
    rail: "mock_x402_service",
    decision: "ALLOW",
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyFingerprint: fingerprintPolicy(policy),
    issuedAt: "2026-07-07T10:15:30.000Z",
    expiresAt: "2026-07-07T10:20:30.000Z",
    executionScope: ["prepare", "simulate"],
    executionStatus: "not_executed",
    fundsMoved: false,
    ...overrides
  };
}

function makeReplayEvidence(overrides: Partial<ReplayEvidence> = {}): ReplayEvidence {
  return {
    replayed: true,
    replayMismatch: false,
    policyChanged: false,
    storedIntentFingerprint: `sha256:${"b".repeat(64)}`,
    currentIntentFingerprint: `sha256:${"b".repeat(64)}`,
    storedPolicyVersion: policy.policyVersion,
    currentPolicyVersion: policy.policyVersion,
    storedPolicyFingerprint: fingerprintPolicy(policy),
    currentPolicyFingerprint: fingerprintPolicy(policy),
    ...overrides
  };
}

function makeRequirementRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scheme: "exact",
    network: ARC_TESTNET_NETWORK,
    amount: "80000",
    asset: ARC_USDC_ASSET,
    payTo: TEST_PAYTO,
    maxTimeoutSeconds: 604900,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: GATEWAY_WALLET
    },
    ...overrides
  };
}

function makeValidRequirement(overrides: Record<string, unknown> = {}): X402PaymentRequirement {
  return validateX402PaymentRequirement(makeRequirementRaw(overrides));
}

function makeEvidence(requirement: X402PaymentRequirement): PaymentRequirementEvidence {
  return buildPaymentRequirementEvidence(requirement);
}

function makeBinding(overrides: Partial<X402RecipientBinding> = {}): X402RecipientBinding {
  return { recipient: "trusted-x402-api.demo", payTo: TEST_PAYTO, ...overrides };
}

/** Between the fixture issuedAt (10:15:30Z) and expiresAt (10:20:30Z). */
const DEFAULT_NOW = new Date("2026-07-07T10:18:00.000Z");

function allowedGateInput(overrides: Partial<X402ExecutionGateInput> = {}): X402ExecutionGateInput {
  const requirement = makeValidRequirement();
  return {
    authorization: makeV1Authorization(),
    replayEvidence: makeReplayEvidence(),
    paymentRequirement: requirement,
    paymentRequirementEvidence: makeEvidence(requirement),
    recipientBinding: makeBinding(),
    policy,
    now: DEFAULT_NOW,
    ...overrides
  };
}

function expectAllowed(result: X402ExecutionGateResult): X402ExecutionAuthorizationV2 {
  expect(result.eligibleForSignerRequest).toBe(true);
  if (!result.eligibleForSignerRequest) {
    throw new Error("gate unexpectedly rejected");
  }
  expect(result.reasonCodes).toEqual([X402_EXECUTION_GATE_ALLOWED_REASON_CODE]);
  return result.authorization;
}

function loadScenarioIntent(fileName: string) {
  const parsed = JSON.parse(readFileSync(join(root, "examples", fileName), "utf8")) as Record<string, unknown>;
  const { expectedDecision, ...intent } = parsed;
  return {
    expectedDecision: expectedDecision as string,
    intent: intent as Parameters<typeof evaluatePaymentIntent>[0]
  };
}

/** Real canonical chain: ALLOW scenario → evaluatePaymentIntent (v1) → I1 → I2 gate PASS → v2. */
async function evaluateCanonicalAllow(auditPath?: string) {
  const resolvedAuditPath = auditPath ?? makeTempAuditPath();
  process.env.AGENTPAY_AUDIT_LOG_PATH = resolvedAuditPath;
  process.env.AGENTPAY_OBSERVATION_LOG_PATH = join(dirname(resolvedAuditPath), "evaluation-observations.jsonl");
  const { intent } = loadScenarioIntent("scenario-allow-api.json");
  const body = (await evaluatePaymentIntent(intent)) as unknown as {
    replayEvidence: ReplayEvidence;
    executionAuthorization?: ExecutionAuthorization;
  };
  const v1 = body.executionAuthorization;
  if (v1 === undefined) {
    throw new Error("canonical ALLOW evaluation produced no v1 authorization");
  }
  return { auditPath: resolvedAuditPath, v1, replayEvidence: body.replayEvidence };
}

function gateResultForV1(v1: ExecutionAuthorization, replayEvidence: ReplayEvidence): X402ExecutionGateResult {
  const requirement = makeValidRequirement({ amount: "80000" });
  const evidence = makeEvidence(requirement);
  return evaluateX402ExecutionGate({
    authorization: v1,
    replayEvidence,
    paymentRequirement: requirement,
    paymentRequirementEvidence: evidence,
    recipientBinding: { recipient: v1.recipient, payTo: TEST_PAYTO },
    policy,
    now: new Date(Date.parse(v1.expiresAt) - 1000)
  });
}

function allowedGateResult(v2: X402ExecutionAuthorizationV2): X402ExecutionGateResult {
  return { eligibleForSignerRequest: true, reasonCodes: [X402_EXECUTION_GATE_ALLOWED_REASON_CODE], authorization: v2 };
}

/** Prepare a canonical-chain v2 on a fresh temp store; returns v2 + prepared record. */
async function prepareOnRealChain(storePath: string, now: Date = DEFAULT_NOW) {
  const { v1, replayEvidence } = await evaluateCanonicalAllow();
  const gateResult = gateResultForV1(v1, replayEvidence);
  const v2 = expectAllowed(gateResult);
  const prepared = await prepareX402ExecutionAttempt({ gateResult: allowedGateResult(v2), storePath, now });
  expect(prepared.prepared).toBe(true);
  if (!prepared.prepared) {
    throw new Error("prepare unexpectedly rejected");
  }
  return { v2, record: prepared.record };
}

function eventFiles(storePath: string, authorizationId: string): string[] {
  return readdirSync(join(storePath, "authorizations", authorizationId))
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();
}

function nonceFiles(storePath: string): string[] {
  return readdirSync(join(storePath, "nonces"))
    .filter((name) => /^0x[0-9a-f]{64}\.json$/.test(name))
    .sort();
}

function readEvent(storePath: string, authorizationId: string, sequence: number): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(storePath, "authorizations", authorizationId, `${String(sequence).padStart(4, "0")}.json`), "utf8")
  ) as Record<string, unknown>;
}

function serializeStore(storePath: string): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        parts.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(storePath);
  return parts.join("\n---\n");
}

// ---------------------------------------------------------------------------
// Ephemeral EOA + external signer helpers (test-process memory only).
// ---------------------------------------------------------------------------

function makeEphemeralAccount(): PrivateKeyAccount {
  // EPHEMERAL EOA: generated at runtime; never persisted, never printed,
  // never committed; lives only in this test process.
  return privateKeyToAccount(generatePrivateKey());
}

/**
 * The exact EIP-712 message as viem expects it (uint256 values as bigint),
 * mirroring the official @circle-fin/x402-batching SDK's signAuthorization.
 */
function typedMessageOf(request: X402Eip3009SigningRequest) {
  return {
    from: request.eip712.message.from as `0x${string}`,
    to: request.eip712.message.to as `0x${string}`,
    value: BigInt(request.eip712.message.value),
    validAfter: BigInt(request.eip712.message.validAfter),
    validBefore: BigInt(request.eip712.message.validBefore),
    nonce: request.eip712.message.nonce as `0x${string}`
  };
}

function signRequestOffline(account: PrivateKeyAccount, request: X402Eip3009SigningRequest): Promise<string> {
  return account.signTypedData({
    domain: request.eip712.domain as TypedDataDomain,
    types: request.eip712.types,
    primaryType: request.eip712.primaryType,
    message: typedMessageOf(request)
  });
}

/** Honest in-process external signer: signs exactly the Guard-built request. */
function makeSigner(account: PrivateKeyAccount): X402ExternalSigner & { readonly callCount: () => number } {
  let calls = 0;
  return {
    callCount: () => calls,
    async sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse> {
      calls += 1;
      const signature = await signRequestOffline(account, request);
      return {
        responseType: "x402_eip3009_signature",
        version: "v1",
        signingRequestDigest: signingRequestDigest(request),
        payerAddress: request.payerAddress,
        signature
      };
    }
  };
}

/** Malicious signer that tampers the typed data it signs (but echoes the honest digest). */
function makeTamperingSigner(account: PrivateKeyAccount, tamper: (request: X402Eip3009SigningRequest) => void): X402ExternalSigner {
  return {
    async sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse> {
      const tampered: X402Eip3009SigningRequest = structuredClone(request);
      tamper(tampered);
      const signature = await signRequestOffline(account, tampered);
      return {
        responseType: "x402_eip3009_signature",
        version: "v1",
        signingRequestDigest: signingRequestDigest(request),
        payerAddress: request.payerAddress,
        signature
      };
    }
  };
}

function expectRejected(result: X402SignerResult, reasonCode: string): void {
  expect(result.signerReady).toBe(false);
  if (result.signerReady) {
    throw new Error("signer unexpectedly ready");
  }
  expect(result.reasonCode).toBe(reasonCode);
  expect(result.payload).toBeNull();
  expect(result.signerPayloadDigest).toBeNull();
}

async function assertFailedSign(
  storePath: string,
  authorizationId: string,
  failureCode: string
): Promise<void> {
  const record = await readX402ExecutionRecord(storePath, authorizationId);
  expect(record?.state).toBe("failed");
  expect(record?.terminal).toMatchObject({ state: "failed", failureStage: "sign", failureCode });
  expect(record?.submitted).toBeUndefined();
}

// ---------------------------------------------------------------------------
// 1/2. SIGNING REQUEST + REAL OFFLINE EIP-712 SIGNATURE (happy path).
// ---------------------------------------------------------------------------

describe("signing request + real offline EIP-712 signature", () => {
  test("canonical ALLOW → v1 → I1 → I2 PASS → v2 → I3 prepared → I4 signing request binds ONLY prepared evidence + trusted payer + exact requirement", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    let received: X402Eip3009SigningRequest | null = null;
    const signer: X402ExternalSigner = {
      async sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse> {
        received = request;
        const signature = await signRequestOffline(payer, request);
        return {
          responseType: "x402_eip3009_signature",
          version: "v1",
          signingRequestDigest: signingRequestDigest(request),
          payerAddress: request.payerAddress,
          signature
        };
      }
    };

    const requirement = makeValidRequirement({ amount: "80000" });
    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: requirement,
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expect(result.signerReady).toBe(true);
    if (!result.signerReady) {
      throw new Error("signer unexpectedly rejected");
    }
    expect(result.reasonCode).toBe(X402_SIGNER_READY);
    expect(result.record.state).toBe("submitted");

    // The request the signer received must come from prepared evidence +
    // trusted payer + exact requirement only.
    expect(received).not.toBeNull();
    const request = received!;
    expect(request.requestType).toBe("x402_eip3009_signing_request");
    expect(request.version).toBe("v1");
    expect(request.authorizationId).toBe(v2.authorizationId);
    expect(request.parentAuthorizationId).toBe(v2.parentAuthorizationId);
    expect(request.auditId).toBe(v2.auditId);
    expect(request.paymentRequirementDigest).toBe(record.paymentRequirementDigest);
    expect(request.paymentRequirementDigest).toBe(fingerprintX402PaymentRequirement(requirement));
    expect(request.network).toBe("eip155:5042002");
    expect(request.chainId).toBe("5042002");
    expect(request.assetAddress).toBe(ARC_USDC_ASSET);
    expect(request.payTo).toBe(TEST_PAYTO);
    expect(request.amountAtomic).toBe("80000");
    expect(request.payerAddress).toBe(payer.address);
    expect(request.nonce).toBe(record.nonce);
    expect(request.nonce).toBe(deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest));

    // Exact official EIP-712 block (verified facts): domain INCLUDES chainId.
    expect(request.eip712.primaryType).toBe(X402_EIP3009_PRIMARY_TYPE);
    expect(request.eip712.domain).toEqual({
      name: "GatewayWalletBatched",
      version: "1",
      chainId: 5042002,
      verifyingContract: GATEWAY_WALLET
    });
    expect(request.eip712.types.TransferWithAuthorization).toEqual([
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" }
    ]);
    expect(request.eip712.message).toEqual({
      from: payer.address,
      to: TEST_PAYTO,
      value: "80000",
      validAfter: String(Math.floor(DEFAULT_NOW.getTime() / 1000) - GATEWAY_VALID_AFTER_BACKDATING_SECONDS),
      validBefore: String(Math.floor(DEFAULT_NOW.getTime() / 1000) + GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS),
      nonce: record.nonce
    });

    // The signature cryptographically recovers to the trusted payer.
    const recovered = await recoverTypedDataAddress({
      domain: request.eip712.domain as TypedDataDomain,
      types: request.eip712.types,
      primaryType: request.eip712.primaryType,
      message: typedMessageOf(request),
      signature: result.payload.payload.signature as Hex
    });
    expect(recovered.toLowerCase()).toBe(payer.address.toLowerCase());

    // Transient payload: official x402 v2 shape; never a secret.
    expect(result.payload.x402Version).toBe(2);
    expect(result.payload.accepted).toEqual(requirement);
    expect(result.payload.payload.authorization).toEqual(request.eip712.message);
    expect(result.signerPayloadDigest).toBe(signerPayloadDigest(result.payload));
    expect(result.signerPayloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("real offline EIP-712 signature roundtrip: ephemeral EOA signs, Guard-side recovery returns the payer (proves real compatibility)", async () => {
    // Pure module-level proof, independent of the store: build the request,
    // sign offline with an ephemeral EOA, recover with the Guard's exact
    // locally constructed typed data.
    const storePath = makeTempStorePath();
    const { record } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const requirement = makeValidRequirement({ amount: "80000" });

    const request = buildX402Eip3009SigningRequest({
      prepared: record,
      requirement,
      payerAddress: payer.address,
      now: DEFAULT_NOW
    });
    const signature = await signRequestOffline(payer, request);

    expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    const recovered = await recoverTypedDataAddress({
      domain: request.eip712.domain as TypedDataDomain,
      types: request.eip712.types,
      primaryType: request.eip712.primaryType,
      message: typedMessageOf(request),
      signature: signature as Hex
    });
    expect(recovered.toLowerCase()).toBe(payer.address.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// 3. WRONG SIGNER.
// ---------------------------------------------------------------------------

describe("wrong signer", () => {
  test("trusted payer A, signer B → verification fails; execution transitions to failed(sign); no submitted state; no payload returned", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payerA = makeEphemeralAccount();
    const signerB = makeEphemeralAccount();

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payerA.address },
      now: DEFAULT_NOW,
      signer: makeSigner(signerB)
    });

    expectRejected(result, X402_SIGNER_SIGNATURE_INVALID);
    expect(result.record?.state).toBe("failed");
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_SIGNATURE_INVALID);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);
    expect(readEvent(storePath, v2.authorizationId, 2)).toMatchObject({
      state: "failed",
      failureStage: "sign",
      failureCode: X402_SIGNER_SIGNATURE_INVALID
    });
  });
});

// ---------------------------------------------------------------------------
// 4. TAMPERED SIGNING REQUEST.
// ---------------------------------------------------------------------------

describe("tampered signing request", () => {
  test.each([
    ["payTo (message.to)", (r: X402Eip3009SigningRequest) => { r.eip712.message.to = TEST_PAYTO_ALT; }],
    ["amount (message.value)", (r: X402Eip3009SigningRequest) => { r.eip712.message.value = "90000"; }],
    ["nonce", (r: X402Eip3009SigningRequest) => { r.eip712.message.nonce = `0x${"f".repeat(64)}`; }],
    ["validBefore", (r: X402Eip3009SigningRequest) => { r.eip712.message.validBefore = String(Number(r.eip712.message.validBefore) + 1); }],
    ["domain verifyingContract", (r: X402Eip3009SigningRequest) => { r.eip712.domain.verifyingContract = TEST_PAYTO_ALT; }]
  ])("tampered %s → signature does not verify against the locally constructed trusted request; no submitted state", async (_label, tamper) => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: makeTamperingSigner(payer, tamper)
    });

    // The signer signed different data than the Guard built: the recovery
    // against the LOCAL typed data must fail closed.
    expectRejected(result, X402_SIGNER_SIGNATURE_INVALID);
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_SIGNATURE_INVALID);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("signer returning the digest of tampered data → request-digest mismatch; no submitted state", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const signer: X402ExternalSigner = {
      async sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse> {
        const tampered = structuredClone(request) as X402Eip3009SigningRequest;
        tampered.eip712.message.value = "90000";
        const signature = await signRequestOffline(payer, tampered);
        return {
          responseType: "x402_eip3009_signature",
          version: "v1",
          signingRequestDigest: signingRequestDigest(tampered),
          payerAddress: request.payerAddress,
          signature
        };
      }
    };

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_REQUEST_DIGEST_MISMATCH);
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_REQUEST_DIGEST_MISMATCH);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });
});

// ---------------------------------------------------------------------------
// 5. REQUIREMENT DIGEST MISMATCH.
// ---------------------------------------------------------------------------

describe("requirement digest mismatch", () => {
  test("prepared commits requirement A; caller passes requirement B (changed amount) → NO signer invocation, no submitted event, fail closed", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const requirementB = makeValidRequirement({ amount: "90000" });
    expect(fingerprintX402PaymentRequirement(requirementB)).not.toBe(v2.paymentRequirementDigest);

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: requirementB,
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH);
    expect(signer.callCount()).toBe(0);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("prepared");
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
  });

  test("caller passes a changed payTo requirement → NO signer invocation; fail closed under digest mismatch (digest commits payTo)", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const requirementB = makeValidRequirement({ payTo: TEST_PAYTO_ALT });
    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: requirementB,
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_REQUIREMENT_DIGEST_MISMATCH);
    expect(signer.callCount()).toBe(0);
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.state).toBe("prepared");
  });
});

// ---------------------------------------------------------------------------
// 6. PREPARED FIELD MISMATCH (tampered stored record).
// ---------------------------------------------------------------------------

describe("prepared field mismatch", () => {
  test("stored payTo diverges from the exact requirement → X402_SIGNER_PREPARED_BINDING_MISMATCH; NO signer invocation", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    // Tamper the persisted prepared event's payTo (still a valid EVM address
    // so the store parses it) while the requirement digest commit is
    // unchanged — the divergence is caught by the binding integrity check.
    const eventPath = join(storePath, "authorizations", v2.authorizationId, "0001.json");
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
    event.payTo = TEST_PAYTO_ALT;
    writeFileSync(eventPath, `${JSON.stringify(event)}\n`, "utf8");

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_PREPARED_BINDING_MISMATCH);
    expect(signer.callCount()).toBe(0);
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.state).toBe("prepared");
  });

  test("stored amountAtomic diverges from the exact requirement → X402_SIGNER_PREPARED_BINDING_MISMATCH; NO signer invocation", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const eventPath = join(storePath, "authorizations", v2.authorizationId, "0001.json");
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
    event.amountAtomic = "90000";
    writeFileSync(eventPath, `${JSON.stringify(event)}\n`, "utf8");

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_PREPARED_BINDING_MISMATCH);
    expect(signer.callCount()).toBe(0);
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.state).toBe("prepared");
  });

  test("stored network diverges from the exact requirement → X402_SIGNER_PREPARED_BINDING_MISMATCH; NO signer invocation", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const eventPath = join(storePath, "authorizations", v2.authorizationId, "0001.json");
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
    event.network = "eip155:84532";
    writeFileSync(eventPath, `${JSON.stringify(event)}\n`, "utf8");

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_PREPARED_BINDING_MISMATCH);
    expect(signer.callCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. EXPIRY.
// ---------------------------------------------------------------------------

describe("expiry", () => {
  test("before expiry the signer MAY be invoked and signing succeeds", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: new Date(Date.parse(record.authorizationExpiresAt) - 1), // strictly before expiry
      signer
    });

    expect(result.signerReady).toBe(true);
    expect(signer.callCount()).toBe(1);
  });

  test.each([
    ["at expiry", 0],
    ["after expiry", 1000]
  ])("now %s → X402_SIGNER_AUTHORIZATION_EXPIRED; NO signer call", async (_label, offsetMs) => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: new Date(Date.parse(record.authorizationExpiresAt) + offsetMs),
      signer
    });

    expectRejected(result, X402_SIGNER_AUTHORIZATION_EXPIRED);
    expect(signer.callCount()).toBe(0);
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.state).toBe("prepared");
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
  });

  test("malformed stored expiry (corrupt store) → fail closed, NO signer call", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    // A stored expiry that is not a parseable timestamp makes the history
    // corrupt for the store's strict parser, which is the FIRST line of
    // defense; the orchestrator's malformed-expiry branch is the defensive
    // second line. Either way: no signer call, fail closed.
    const eventPath = join(storePath, "authorizations", v2.authorizationId, "0001.json");
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
    event.authorizationExpiresAt = "not-a-timestamp";
    writeFileSync(eventPath, `${JSON.stringify(event)}\n`, "utf8");

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_STATE_CONFLICT);
    expect(signer.callCount()).toBe(0);
  });

  test("NaN now → X402_SIGNER_AUTHORIZATION_EXPIRED; NO signer call", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: new Date(Number.NaN),
      signer
    });

    expectRejected(result, X402_SIGNER_AUTHORIZATION_EXPIRED);
    expect(signer.callCount()).toBe(0);
  });

  test("invalid payer address → X402_SIGNER_PAYER_ADDRESS_INVALID; NO signer call", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const signer = makeSigner(payer);

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: "0xnot-an-address" },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_PAYER_ADDRESS_INVALID);
    expect(signer.callCount()).toBe(0);
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.state).toBe("prepared");
  });
});

// ---------------------------------------------------------------------------
// 8. SIGNER REQUEST DIGEST.
// ---------------------------------------------------------------------------

describe("signing request digest", () => {
  function makePrepared(overrides: Partial<X402PreparedExecutionRecord> = {}): X402PreparedExecutionRecord {
    const requirement = makeValidRequirement({ amount: "80000" });
    return {
      authorizationId: `auth_${"a".repeat(64)}`,
      nonce: `0x${"d".repeat(64)}`,
      paymentRequirementDigest: fingerprintX402PaymentRequirement(requirement),
      parentAuthorizationId: `auth_${"b".repeat(64)}`,
      auditId: "audit_20260707_000001",
      idempotencyKey: "demo-auth-001",
      agentId: "agent_auth_demo_001",
      recipient: "trusted-x402-api.demo",
      network: "eip155:5042002",
      assetAddress: ARC_USDC_ASSET,
      payTo: TEST_PAYTO,
      amountAtomic: "80000",
      policyVersion: "3",
      policyFingerprint: `sha256:${"c".repeat(64)}`,
      authorizationExpiresAt: "2026-07-07T10:20:30.000Z",
      preparedAt: "2026-07-07T10:18:00.000Z",
      ...overrides
    };
  }

  function build(overrides: {
    prepared?: Partial<X402PreparedExecutionRecord>;
    payerAddress?: string;
    now?: Date;
  } = {}): X402Eip3009SigningRequest {
    return buildX402Eip3009SigningRequest({
      prepared: makePrepared(overrides.prepared),
      requirement: makeValidRequirement({ amount: "80000" }),
      payerAddress: overrides.payerAddress ?? `0x${"e".repeat(40)}`,
      now: overrides.now ?? DEFAULT_NOW
    });
  }

  test("same request → same digest; deterministic across rebuilds", () => {
    const first = build();
    const second = build();
    expect(signingRequestDigest(first)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(signingRequestDigest(first)).toBe(signingRequestDigest(second));
    expect(signingRequestDigest(first)).toBe(signingRequestDigest(structuredClone(first)));
  });

  test.each([
    ["payer", { payerAddress: `0x${"f".repeat(40)}` }],
    ["payTo", { prepared: { payTo: TEST_PAYTO_ALT } }],
    ["amount", { prepared: { amountAtomic: "90000" } }],
    ["nonce", { prepared: { nonce: `0x${"f".repeat(64)}` } }],
    ["validity window (now)", { now: new Date("2026-07-07T10:19:00.000Z") }],
    ["authorizationId", { prepared: { authorizationId: `auth_${"f".repeat(64)}` } }],
    ["requirementDigest", { prepared: { paymentRequirementDigest: `sha256:${"f".repeat(64)}` } }]
  ])("changed %s → different digest", (_label, overrides) => {
    const base = build();
    const changed = build(overrides as Parameters<typeof build>[0]);
    expect(signingRequestDigest(changed)).not.toBe(signingRequestDigest(base));
  });
});

// ---------------------------------------------------------------------------
// 9. SIGNED PAYLOAD DIGEST.
// ---------------------------------------------------------------------------

describe("signed payload digest", () => {
  function payloadFixture(): { payload: X402SignedPaymentPayload; request: X402Eip3009SigningRequest } {
    const prepared = {
      authorizationId: `auth_${"a".repeat(64)}`,
      nonce: `0x${"d".repeat(64)}`,
      paymentRequirementDigest: fingerprintX402PaymentRequirement(makeValidRequirement({ amount: "80000" })),
      parentAuthorizationId: `auth_${"b".repeat(64)}`,
      auditId: "audit_20260707_000001",
      idempotencyKey: "demo-auth-001",
      agentId: "agent_auth_demo_001",
      recipient: "trusted-x402-api.demo",
      network: "eip155:5042002",
      assetAddress: ARC_USDC_ASSET,
      payTo: TEST_PAYTO,
      amountAtomic: "80000",
      policyVersion: "3",
      policyFingerprint: `sha256:${"c".repeat(64)}`,
      authorizationExpiresAt: "2026-07-07T10:20:30.000Z",
      preparedAt: "2026-07-07T10:18:00.000Z"
    } as X402PreparedExecutionRecord;
    const requirement = makeValidRequirement({ amount: "80000" });
    const request = buildX402Eip3009SigningRequest({
      prepared,
      requirement,
      payerAddress: `0x${"e".repeat(40)}`,
      now: DEFAULT_NOW
    });
    const signature = `0x${"ab".repeat(65)}`;
    return { payload: buildX402SignedPaymentPayload({ requirement, request, signature }), request };
  }

  test("same payload → same digest", () => {
    const { payload } = payloadFixture();
    expect(signerPayloadDigest(payload)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(signerPayloadDigest(payload)).toBe(signerPayloadDigest(structuredClone(payload)));
  });

  test("changed signature → different digest", () => {
    const { payload, request } = payloadFixture();
    const other = buildX402SignedPaymentPayload({
      requirement: payload.accepted,
      request,
      signature: `0x${"cd".repeat(65)}`
    });
    expect(signerPayloadDigest(other)).not.toBe(signerPayloadDigest(payload));
  });

  test("changed payload field → different digest", () => {
    const { payload } = payloadFixture();
    const changed = structuredClone(payload) as X402SignedPaymentPayload;
    changed.payload.authorization.value = "90000";
    expect(signerPayloadDigest(changed)).not.toBe(signerPayloadDigest(payload));
  });

  test("persisted I3 submitted event stores ONLY the digest (nonce + signerPayloadDigest), never signature/payload", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: makeSigner(payer)
    });
    expect(result.signerReady).toBe(true);

    const submitted = readEvent(storePath, v2.authorizationId, 2);
    expect(submitted.state).toBe("submitted");
    expect(submitted.nonce).toBe((await readX402ExecutionRecord(storePath, v2.authorizationId))?.prepared.nonce);
    expect(submitted.signerPayloadDigest).toBe(
      result.signerReady ? result.signerPayloadDigest : null
    );
    expect(submitted).not.toHaveProperty("signature");
    expect(submitted).not.toHaveProperty("payload");

    const serialized = serializeStore(storePath);
    expect(serialized).not.toMatch(/signature|signedPayload|PaymentPayload|privateKey|seedPhrase|mnemonic/i);
  });
});

// ---------------------------------------------------------------------------
// 10. SUBMITTED TRANSITION.
// ---------------------------------------------------------------------------

describe("submitted transition", () => {
  test("after successful signing: state == submitted; stored nonce + signerPayloadDigest; NO signature/private key/raw payload; fresh read reconstructs", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: makeSigner(payer)
    });

    expect(result.signerReady).toBe(true);
    if (!result.signerReady) {
      throw new Error("signer unexpectedly rejected");
    }
    expect(result.record.state).toBe("submitted");
    expect(result.record.submitted?.nonce).toBe(record.nonce);
    expect(result.record.submitted?.signerPayloadDigest).toBe(result.signerPayloadDigest);

    // event history: prepared (0001) → submitted (0002)
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
    const submittedEvent = readEvent(storePath, v2.authorizationId, 2);
    expect(submittedEvent).toMatchObject({
      eventType: "x402_execution_state",
      version: "v1",
      sequence: 2,
      state: "submitted",
      authorizationId: v2.authorizationId
    });
    expect(submittedEvent.nonce).toBe(record.nonce);
    expect(submittedEvent.signerPayloadDigest).toBe(result.signerPayloadDigest);
    expect(submittedEvent.occurredAt).toBe(DEFAULT_NOW.toISOString());
    expect(submittedEvent).not.toHaveProperty("signature");
    expect(submittedEvent).not.toHaveProperty("payload");

    // fresh-style read after "restart": no module state, reconstruct from files
    const fresh = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(fresh?.state).toBe("submitted");
    expect(fresh?.submitted).toEqual(result.record.submitted);
    expect(fresh?.prepared.nonce).toBe(record.nonce);

    // the store never contains the signature, the payload, or any secret
    const serialized = serializeStore(storePath);
    expect(serialized).not.toMatch(
      /privateKey|signature|signedPayload|PaymentPayload|transactionHash|txHash|seedPhrase|mnemonic/i
    );
  });

  test("concurrent identical signings → exactly one applied, the rest are exact safe replays of the SAME payload digest; all X402_SIGNER_READY; one event", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    // I3's submitted transition is exclusively created: the first identical
    // submission wins; each loser resolves the race and REPLAYS the exact
    // same nonce + signerPayloadDigest → the orchestrator returns READY for
    // the identical digest (safe replay), never a second lifecycle.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        signPreparedX402Execution({
          storePath,
          authorizationId: v2.authorizationId,
          paymentRequirement: makeValidRequirement({ amount: "80000" }),
          payerBinding: { payerAddress: payer.address },
          now: DEFAULT_NOW,
          signer: makeSigner(payer)
        })
      )
    );

    for (const attempt of attempts) {
      expect(attempt.signerReady).toBe(true);
      if (attempt.signerReady) {
        expect(attempt.reasonCode).toBe(X402_SIGNER_READY);
        expect(attempt.signerPayloadDigest).toBe(attempts[0].signerReady ? attempts[0].signerPayloadDigest : null);
      }
    }
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("submitted");
    expect(record?.submitted?.signerPayloadDigest).toBe(
      attempts[0].signerReady ? attempts[0].signerPayloadDigest : null
    );
  });

  test("sequential re-signing after submitted → X402_SIGNER_EXECUTION_NOT_PREPARED; NO signer call (single use)", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const first = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: makeSigner(payer)
    });
    expect(first.signerReady).toBe(true);
    if (!first.signerReady) {
      throw new Error("signer unexpectedly rejected");
    }

    // A second sequential call observes the terminal submitted state BEFORE
    // any signer call: no second signing, no second lifecycle.
    const signer = makeSigner(payer);
    const second = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });
    expectRejected(second, X402_SIGNER_EXECUTION_NOT_PREPARED);
    expect(signer.callCount()).toBe(0);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("signing an already-failed record → X402_SIGNER_EXECUTION_NOT_PREPARED; NO signer call", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    // First attempt fails at sign stage (wrong signer B).
    const failing = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: makeSigner(makeEphemeralAccount())
    });
    expectRejected(failing, X402_SIGNER_SIGNATURE_INVALID);

    // Retry with the CORRECT payer → the terminal failed state blocks I4.
    const correct = makeSigner(payer);
    const retry = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: correct
    });
    expectRejected(retry, X402_SIGNER_EXECUTION_NOT_PREPARED);
    expect(correct.callCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. SIGNER FAILURE.
// ---------------------------------------------------------------------------

describe("signer failure", () => {
  test.each([
    ["throws synchronously", (() => {
      throw new Error("boom");
    }) as X402ExternalSigner["sign"]],
    ["rejects", (() => Promise.reject(new Error("boom"))) as X402ExternalSigner["sign"]]
  ])("signer %s → state failed(sign), stable failure code, no signature stored, no submitted", async (_label, signImpl) => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: makeEphemeralAccount().address },
      now: DEFAULT_NOW,
      signer: { sign: signImpl }
    });

    expectRejected(result, X402_SIGNER_EXTERNAL_FAILURE);
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_EXTERNAL_FAILURE);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
    const failedEvent = readEvent(storePath, v2.authorizationId, 2);
    expect(failedEvent).toMatchObject({ state: "failed", failureStage: "sign", failureCode: X402_SIGNER_EXTERNAL_FAILURE });
    // NEVER store Error.stack or any secret.
    expect(JSON.stringify(failedEvent)).not.toMatch(/boom|stack|privateKey|signature/i);
  });
});

// ---------------------------------------------------------------------------
// 12. INVALID RESPONSE.
// ---------------------------------------------------------------------------

describe("invalid signer response", () => {
  function responseOf(request: X402Eip3009SigningRequest, account: PrivateKeyAccount): Promise<X402ExternalSignerResponse> {
    return signRequestOffline(account, request).then((signature) => ({
      responseType: "x402_eip3009_signature" as const,
      version: "v1" as const,
      signingRequestDigest: signingRequestDigest(request),
      payerAddress: request.payerAddress,
      signature
    }));
  }

  test("wrong request digest → X402_SIGNER_REQUEST_DIGEST_MISMATCH; no submitted transition", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const signer: X402ExternalSigner = {
      async sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse> {
        const response = await responseOf(request, payer);
        return { ...response, signingRequestDigest: `sha256:${"f".repeat(64)}` };
      }
    };

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_REQUEST_DIGEST_MISMATCH);
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_REQUEST_DIGEST_MISMATCH);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("wrong payer address → X402_SIGNER_PAYER_MISMATCH; no submitted transition", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();
    const impostor = makeEphemeralAccount();

    const signer: X402ExternalSigner = {
      async sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse> {
        const response = await responseOf(request, payer);
        return { ...response, payerAddress: impostor.address };
      }
    };

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_PAYER_MISMATCH);
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_PAYER_MISMATCH);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("malformed signature (not 65 bytes) → X402_SIGNER_RESPONSE_INVALID; no submitted transition", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const signer: X402ExternalSigner = {
      async sign(request: X402Eip3009SigningRequest): Promise<X402ExternalSignerResponse> {
        const response = await responseOf(request, payer);
        return { ...response, signature: "0x1234" };
      }
    };

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_RESPONSE_INVALID);
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_RESPONSE_INVALID);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test.each([
    ["array", []],
    ["string", "response"],
    ["extra unknown field", { responseType: "x402_eip3009_signature", version: "v1", signingRequestDigest: `sha256:${"f".repeat(64)}`, payerAddress: `0x${"e".repeat(40)}`, signature: `0x${"ab".repeat(65)}`, privateKey: "0xdeadbeef" }],
    ["bad responseType", { responseType: "whatever", version: "v1", signingRequestDigest: `sha256:${"f".repeat(64)}`, payerAddress: `0x${"e".repeat(40)}`, signature: `0x${"ab".repeat(65)}` }],
    ["bad version", { responseType: "x402_eip3009_signature", version: "v9", signingRequestDigest: `sha256:${"f".repeat(64)}`, payerAddress: `0x${"e".repeat(40)}`, signature: `0x${"ab".repeat(65)}` }]
  ])("unknown/invalid shape (%s) → X402_SIGNER_RESPONSE_INVALID; fail closed", async (_label, rawResponse) => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);

    const signer: X402ExternalSigner = {
      async sign(): Promise<X402ExternalSignerResponse> {
        return rawResponse as X402ExternalSignerResponse;
      }
    };

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: `0x${"e".repeat(40)}` },
      now: DEFAULT_NOW,
      signer
    });

    expectRejected(result, X402_SIGNER_RESPONSE_INVALID);
    await assertFailedSign(storePath, v2.authorizationId, X402_SIGNER_RESPONSE_INVALID);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });
});

// ---------------------------------------------------------------------------
// 14. REVIEW / BLOCK / MISMATCH — the normal chain cannot reach I4.
// ---------------------------------------------------------------------------

describe("no I4 reachable from REVIEW / BLOCK / mismatch chains", () => {
  async function assertNoReach(authorizationId: string, signer: X402ExternalSigner & { callCount: () => number }) {
    const storePath = makeTempStorePath();
    const result = await signPreparedX402Execution({
      storePath,
      authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: makeEphemeralAccount().address },
      now: DEFAULT_NOW,
      signer
    });
    expectRejected(result, X402_SIGNER_EXECUTION_NOT_FOUND);
    expect(signer.callCount()).toBe(0);
  }

  test("REVIEW scenario → no authorization → no prepared record → X402_SIGNER_EXECUTION_NOT_FOUND, no signer invocation", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-review-machine.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as { decision: string; executionAuthorization?: unknown };
    expect(expectedDecision).toBe("REVIEW");
    expect(body.decision).toBe("REVIEW");
    expect(body.executionAuthorization).toBeUndefined();

    await assertNoReach(`auth_${"a".repeat(64)}`, makeSigner(makeEphemeralAccount()));
  });

  test("BLOCK scenario → no authorization → no prepared record → X402_SIGNER_EXECUTION_NOT_FOUND, no signer invocation", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    const { expectedDecision, intent } = loadScenarioIntent("scenario-block-risky.json");
    const body = (await evaluatePaymentIntent(intent)) as unknown as { decision: string; executionAuthorization?: unknown };
    expect(expectedDecision).toBe("BLOCK");
    expect(body.decision).toBe("BLOCK");
    expect(body.executionAuthorization).toBeUndefined();

    await assertNoReach(`auth_${"a".repeat(64)}`, makeSigner(makeEphemeralAccount()));
  });

  test("I2 replay mismatch → gate rejects → prepare GATE_NOT_ELIGIBLE → I4 EXECUTION_NOT_FOUND, no signer invocation", async () => {
    const storePath = makeTempStorePath();
    const rejected = evaluateX402ExecutionGate(
      allowedGateInput({ replayEvidence: makeReplayEvidence({ replayMismatch: true }) })
    );
    expect(rejected.eligibleForSignerRequest).toBe(false);

    const prepared = await prepareX402ExecutionAttempt({
      gateResult: rejected,
      storePath,
      now: DEFAULT_NOW
    });
    expect(prepared).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_GATE_NOT_ELIGIBLE, record: null });
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);

    const signer = makeSigner(makeEphemeralAccount());
    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: `auth_${"a".repeat(64)}`,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: makeEphemeralAccount().address },
      now: DEFAULT_NOW,
      signer
    });
    expectRejected(result, X402_SIGNER_EXECUTION_NOT_FOUND);
    expect(signer.callCount()).toBe(0);
  });

  test("I2 policy drift → gate rejects → prepare GATE_NOT_ELIGIBLE → I4 EXECUTION_NOT_FOUND, no signer invocation", async () => {
    const storePath = makeTempStorePath();
    const rejected = evaluateX402ExecutionGate(
      allowedGateInput({ replayEvidence: makeReplayEvidence({ policyChanged: true }) })
    );
    expect(rejected.eligibleForSignerRequest).toBe(false);

    const prepared = await prepareX402ExecutionAttempt({
      gateResult: rejected,
      storePath,
      now: DEFAULT_NOW
    });
    expect(prepared).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_GATE_NOT_ELIGIBLE, record: null });

    const signer = makeSigner(makeEphemeralAccount());
    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: `auth_${"a".repeat(64)}`,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: makeEphemeralAccount().address },
      now: DEFAULT_NOW,
      signer
    });
    expectRejected(result, X402_SIGNER_EXECUTION_NOT_FOUND);
    expect(signer.callCount()).toBe(0);
  });

  test("I3 duplicate prepare → second prepare ALREADY_CONSUMED → I4 sees the consumed record, no second lifecycle", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const payer = makeEphemeralAccount();

    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: makeSigner(payer)
    });
    expect(result.signerReady).toBe(true);
    if (!result.signerReady) {
      throw new Error("signer unexpectedly rejected");
    }

    // I3 duplicate prepare of the same v2 stays blocked.
    const duplicate = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date("2026-07-07T10:19:00.000Z")
    });
    expect(duplicate).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);

    // I4 on the submitted record → EXECUTION_NOT_PREPARED; no signer call.
    const signer = makeSigner(payer);
    const again = await signPreparedX402Execution({
      storePath,
      authorizationId: v2.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });
    expectRejected(again, X402_SIGNER_EXECUTION_NOT_PREPARED);
    expect(signer.callCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 15. EXACT REPLAY / SINGLE USE.
// ---------------------------------------------------------------------------

describe("exact replay / single use", () => {
  test("exact policy replay reproduces the same v2; I3 blocks the second prepare; I4 cannot create a second execution lifecycle", async () => {
    const auditPath = makeTempAuditPath();
    const first = await evaluateCanonicalAllow(auditPath);
    const second = await evaluateCanonicalAllow(auditPath);

    expect(second.replayEvidence).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: false });
    expect(second.v1.authorizationId).toBe(first.v1.authorizationId);
    const v2First = expectAllowed(gateResultForV1(first.v1, first.replayEvidence));
    const v2Second = expectAllowed(gateResultForV1(second.v1, second.replayEvidence));
    expect(v2Second.authorizationId).toBe(v2First.authorizationId);

    const storePath = makeTempStorePath();
    const payer = makeEphemeralAccount();

    const firstPrepare = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2First),
      storePath,
      now: DEFAULT_NOW
    });
    expect(firstPrepare.prepared).toBe(true);

    const signed = await signPreparedX402Execution({
      storePath,
      authorizationId: v2First.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer: makeSigner(payer)
    });
    expect(signed.signerReady).toBe(true);
    if (!signed.signerReady) {
      throw new Error("signer unexpectedly rejected");
    }

    // Exact replay of the evaluation yields the same v2 → I3 blocks the
    // second prepare → no second lifecycle can ever be created.
    const secondPrepare = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2Second),
      storePath,
      now: new Date("2026-07-07T10:19:00.000Z")
    });
    expect(secondPrepare).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
    expect(eventFiles(storePath, v2First.authorizationId)).toEqual(["0001.json", "0002.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);

    const signer = makeSigner(payer);
    const replayAttempt = await signPreparedX402Execution({
      storePath,
      authorizationId: v2First.authorizationId,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: payer.address },
      now: DEFAULT_NOW,
      signer
    });
    // The record is already submitted: a sequential re-signing is a single-use
    // violation, rejected BEFORE any signer call. Exactly one execution
    // lifecycle exists; the second prepare stays blocked.
    expectRejected(replayAttempt, X402_SIGNER_EXECUTION_NOT_PREPARED);
    expect(signer.callCount()).toBe(0);
    expect(eventFiles(storePath, v2First.authorizationId)).toEqual(["0001.json", "0002.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);
  });

  test("unknown authorizationId → X402_SIGNER_EXECUTION_NOT_FOUND; no signer invocation", async () => {
    const storePath = makeTempStorePath();
    const signer = makeSigner(makeEphemeralAccount());
    const result = await signPreparedX402Execution({
      storePath,
      authorizationId: `auth_${"f".repeat(64)}`,
      paymentRequirement: makeValidRequirement({ amount: "80000" }),
      payerBinding: { payerAddress: makeEphemeralAccount().address },
      now: DEFAULT_NOW,
      signer
    });
    expectRejected(result, X402_SIGNER_EXECUTION_NOT_FOUND);
    expect(signer.callCount()).toBe(0);
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validity-window derivation unit tests (official Gateway facts).
// ---------------------------------------------------------------------------

describe("validity window derivation", () => {
  test("validAfter = now - 600 s; validBefore = now + max(maxTimeoutSeconds, 604900) per the official SDK", () => {
    const window = deriveX402Eip3009ValidityWindow(DEFAULT_NOW, 604900);
    const nowSeconds = Math.floor(DEFAULT_NOW.getTime() / 1000);
    expect(window.validAfter).toBe(String(nowSeconds - GATEWAY_VALID_AFTER_BACKDATING_SECONDS));
    expect(window.validBefore).toBe(String(nowSeconds + GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS));
    expect(Number(window.validBefore) - Number(window.validAfter)).toBe(
      GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS + GATEWAY_VALID_AFTER_BACKDATING_SECONDS
    );
    expect(Number(window.validBefore) > Number(window.validAfter)).toBe(true);
  });

  test("validBefore satisfies Gateway's current minimum future validity (7 days + 100 s buffer)", () => {
    const window = deriveX402Eip3009ValidityWindow(DEFAULT_NOW, 604900);
    const nowSeconds = Math.floor(DEFAULT_NOW.getTime() / 1000);
    expect(Number(window.validBefore) - nowSeconds).toBe(7 * 24 * 60 * 60 + 100);
    expect(Number(window.validBefore) - nowSeconds).toBe(604900);
  });

  test("deterministic for the same explicit inputs; varies with now", () => {
    const first = deriveX402Eip3009ValidityWindow(DEFAULT_NOW, 604900);
    const second = deriveX402Eip3009ValidityWindow(DEFAULT_NOW, 604900);
    const later = deriveX402Eip3009ValidityWindow(new Date("2026-07-07T10:19:00.000Z"), 604900);
    expect(first).toEqual(second);
    expect(later).not.toEqual(first);
  });

  test("maxTimeoutSeconds below the Gateway minimum is clamped up to 604900", () => {
    const window = deriveX402Eip3009ValidityWindow(DEFAULT_NOW, 60);
    const nowSeconds = Math.floor(DEFAULT_NOW.getTime() / 1000);
    expect(Number(window.validBefore) - nowSeconds).toBe(604900);
  });

  test.each([0, -1, 1.5, Number.NaN])("invalid maxTimeoutSeconds %s fails closed", (value) => {
    expect(() => deriveX402Eip3009ValidityWindow(DEFAULT_NOW, value)).toThrow();
  });

  test("NaN now fails closed", () => {
    expect(() => deriveX402Eip3009ValidityWindow(new Date(Number.NaN), 604900)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Strict request validation (defense-in-depth contract).
// ---------------------------------------------------------------------------

describe("strict signing request validation", () => {
  test("rejects injected execution fields (privateKey, signature, to, data, rpcUrl)", () => {
    const requirement = makeValidRequirement({ amount: "80000" });
    const prepared: X402PreparedExecutionRecord = {
      authorizationId: `auth_${"a".repeat(64)}`,
      nonce: `0x${"d".repeat(64)}`,
      paymentRequirementDigest: fingerprintX402PaymentRequirement(requirement),
      parentAuthorizationId: `auth_${"b".repeat(64)}`,
      auditId: "audit_20260707_000001",
      idempotencyKey: "demo-auth-001",
      agentId: "agent_auth_demo_001",
      recipient: "trusted-x402-api.demo",
      network: "eip155:5042002",
      assetAddress: ARC_USDC_ASSET,
      payTo: TEST_PAYTO,
      amountAtomic: "80000",
      policyVersion: "3",
      policyFingerprint: `sha256:${"c".repeat(64)}`,
      authorizationExpiresAt: "2026-07-07T10:20:30.000Z",
      preparedAt: "2026-07-07T10:18:00.000Z"
    };
    const request = buildX402Eip3009SigningRequest({
      prepared,
      requirement,
      payerAddress: `0x${"e".repeat(40)}`,
      now: DEFAULT_NOW
    });

    for (const field of ["privateKey", "signature", "to", "data", "rpcUrl"]) {
      const injected = { ...structuredClone(request), [field]: "0xdeadbeef" } as unknown;
      expect(() => validateX402Eip3009SigningRequest(injected)).toThrow(X402SigningRequestError);
    }
  });
});
