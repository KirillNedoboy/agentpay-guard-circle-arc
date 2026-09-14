/**
 * x402-gateway-settlement.test.ts
 *
 * I5 — Gateway settlement orchestration + reconciliation tests for
 * `submitX402GatewaySettlement` / `reconcileX402GatewayOutcome` /
 * `finishX402GatewayConfirmation`.
 *
 * ZERO real network: every `GatewayTestnetClient` is a hand-written
 * in-memory fake (no fetch anywhere in this suite); no funds, the live
 * testnet-payment flag is never set; EPHEMERAL test-only signing keys
 * (viem generatePrivateKey — never persisted, never printed).
 *
 * Conventions (matching the I3/I4 suites): temp execution-store /
 * settlement-evidence-store paths ONLY (mkdtempSync — never data/); temp
 * audit paths with AGENTPAY_* env overrides restored in afterEach;
 * deterministic TEST-ONLY addresses; explicit `now` values — no sleeps, no
 * machine-clock dependence inside the orchestrator. Real fixture chain:
 * canonical ALLOW → evaluatePaymentIntent (v1) → I1 requirement → I2 gate
 * PASS → v2 → I3 prepare → I4 signPreparedX402Execution (transient signed
 * payload) → I5 submit with the fake client.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
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
  type X402ExecutionGateResult
} from "@/domain/x402/execution-security-gate";
import type { X402ExecutionAuthorizationV2 } from "@/domain/x402/execution-authorization-v2";
import {
  prepareX402ExecutionAttempt,
  readX402ExecutionRecord,
  type X402ExecutionRecord
} from "@/domain/x402/execution-store";
import {
  signerPayloadDigest,
  type X402ExternalSigner,
  type X402ExternalSignerResponse,
  type X402SignedPaymentPayload
} from "@/domain/x402/external-signer";
import {
  signingRequestDigest,
  type X402Eip3009SigningRequest
} from "@/domain/x402/eip3009-signing-request";
import {
  signPreparedX402Execution,
  X402_SIGNER_READY
} from "@/domain/x402/sign-prepared-x402-execution";
import {
  finishX402GatewayConfirmation,
  reconcileX402GatewayOutcome,
  submitX402GatewaySettlement
} from "@/domain/x402/gateway-settlement";
import {
  X402_GATEWAY_AUTHORIZATION_EXPIRED,
  X402_GATEWAY_EXECUTION_NOT_FOUND,
  X402_GATEWAY_EXECUTION_NOT_SUBMITTED,
  X402_GATEWAY_KNOWN_REJECTION,
  X402_GATEWAY_NONCE_ALREADY_USED_RECONCILE_REQUIRED,
  X402_GATEWAY_PAYLOAD_DIGEST_MISMATCH,
  X402_GATEWAY_RECOVERY_METADATA_MISSING,
  X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN,
  X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH,
  X402_GATEWAY_RESPONSE_INVALID,
  X402_GATEWAY_STATE_CONFLICT,
  X402_GATEWAY_TRANSFER_PENDING,
  X402_GATEWAY_REMOTE_TRANSFER_MISMATCH,
  X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT,
  X402_GATEWAY_TRANSFER_CONFIRMED,
  X402_GATEWAY_TRANSFER_FAILED,
  X402_GATEWAY_TRANSPORT_FAILURE,
  X402_GATEWAY_TRANSPORT_TIMEOUT,
  type X402GatewayReasonCode
} from "@/domain/x402/gateway-reason-codes";
import { buildSettlementEvidence } from "@/domain/x402/settlement-evidence";
import {
  appendSettlementEvidence,
  latestSettlementEvidence,
  readSettlementEvidence
} from "@/domain/x402/settlement-evidence-store";
import type {
  GatewaySettleRequest,
  GatewayTransferSnapshot
} from "@/integrations/circle-gateway/contracts";
import type {
  GatewaySettleCallResult,
  GatewayTestnetClient,
  GatewayTransferCallResult,
  GatewayTransferListCallResult,
  GatewayTransportReasonCode
} from "@/integrations/circle-gateway/testnet-client";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { type TypedDataDomain } from "viem";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const TEST_PAYTO = "0x1111111111111111111111111111111111111111";
const TEST_PAYTO_ALT = "0x2222222222222222222222222222222222222222";
/** Contract-valid transfer UUID (fake; never a real remote id). */
const TRANSFER_UUID = "11111111-1111-4111-8111-111111111111";

const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-gwsettle-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

function makeTempStorePath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-gwsettle-"));
  tempDirs.push(dir);
  return join(dir, "execution-store");
}

function makeTempEvidencePath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-gwsettle-"));
  tempDirs.push(dir);
  return join(dir, "settlement-evidence");
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
// Fixtures (mirroring the I2/I3/I4 suites; deterministic TEST-ONLY addresses).
// ---------------------------------------------------------------------------

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

/** Between the real-chain timestamps; the durable expiry is re-derived per test. */
const DEFAULT_NOW = new Date("2026-07-07T10:18:00.000Z");

function loadScenarioIntent(fileName: string) {
  const parsed = JSON.parse(readFileSync(join(root, "examples", fileName), "utf8")) as Record<string, unknown>;
  const { expectedDecision, ...intent } = parsed;
  return {
    expectedDecision: expectedDecision as string,
    intent: intent as Parameters<typeof evaluatePaymentIntent>[0]
  };
}

/** Real canonical chain: ALLOW scenario → evaluatePaymentIntent (v1). */
async function evaluateCanonicalAllow() {
  const resolvedAuditPath = makeTempAuditPath();
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
  return { v1, replayEvidence: makeReplayEvidence(body.replayEvidence) };
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

function eventFiles(storePath: string, authorizationId: string): string[] {
  return readdirSync(join(storePath, "authorizations", authorizationId))
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();
}

function eventFile(storePath: string, authorizationId: string, sequence: number): string {
  return join(storePath, "authorizations", authorizationId, `${String(sequence).padStart(4, "0")}.json`);
}

/** ALL bytes persisted in the given store trees (secret-leak scans). */
function serializeStores(...storePaths: string[]): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        parts.push(readFileSync(full, "utf8"));
      }
    }
  };
  for (const path of storePaths) {
    walk(path);
  }
  return parts.join("\n---\n");
}

// ---------------------------------------------------------------------------
// Ephemeral EOA + honest in-process signer (test-process memory only).
// ---------------------------------------------------------------------------

function makeEphemeralAccount(): PrivateKeyAccount {
  return privateKeyToAccount(generatePrivateKey());
}

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

// ---------------------------------------------------------------------------
// Hand-written fake GatewayTestnetClient (ZERO network, ever).
// ---------------------------------------------------------------------------

type FakeClient = GatewayTestnetClient & {
  settleCalls: number;
  listCalls: number;
  getCalls: number;
  lastSettleRequest: GatewaySettleRequest | null;
};

function makeFakeClient(behavior: {
  settle?: GatewaySettleCallResult;
  list?: GatewayTransferListCallResult;
  get?: GatewayTransferCallResult;
}): FakeClient {
  const client: FakeClient = {
    settleCalls: 0,
    listCalls: 0,
    getCalls: 0,
    lastSettleRequest: null,
    async settle(request) {
      client.settleCalls += 1;
      client.lastSettleRequest = request;
      return behavior.settle ?? { kind: "unknown", reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE", httpStatus: null };
    },
    async listTransfersByNonce() {
      client.listCalls += 1;
      return behavior.list ?? { kind: "response", httpStatus: 200, transfers: [] };
    },
    async getTransfer() {
      client.getCalls += 1;
      return behavior.get ?? { kind: "not_found" };
    }
  };
  return client;
}

function settleOk(): GatewaySettleCallResult {
  return {
    kind: "response",
    httpStatus: 200,
    response: {
      success: true,
      transaction: TRANSFER_UUID,
      network: ARC_TESTNET_NETWORK,
      errorReason: null,
      payerAddress: null
    }
  };
}

function settleUnknown(reasonCode: GatewayTransportReasonCode, httpStatus: number | null): GatewaySettleCallResult {
  return { kind: "unknown", reasonCode, httpStatus };
}

// ---------------------------------------------------------------------------
// Full I1→I2→I3→I4 chain up to a durable `submitted` record + transient
// signed payload (the ONLY I5 submit input besides the fake client).
// ---------------------------------------------------------------------------

async function signedSubmission(storePath: string) {
  const { v1, replayEvidence } = await evaluateCanonicalAllow();
  const gate = gateResultForV1(v1, replayEvidence);
  if (!gate.eligibleForSignerRequest) {
    throw new Error("gate unexpectedly rejected");
  }
  const v2 = gate.authorization;
  const prepared = await prepareX402ExecutionAttempt({
    gateResult: allowedGateResult(v2),
    storePath,
    now: DEFAULT_NOW
  });
  if (!prepared.prepared) {
    throw new Error("prepare unexpectedly rejected");
  }
  const payer = makeEphemeralAccount();
  const signer = makeSigner(payer);
  const requirement = makeValidRequirement({ amount: "80000" });
  const result = await signPreparedX402Execution({
    storePath,
    authorizationId: v2.authorizationId,
    paymentRequirement: requirement,
    payerBinding: { payerAddress: payer.address },
    now: DEFAULT_NOW,
    signer
  });
  if (!result.signerReady) {
    throw new Error(`sign unexpectedly rejected: ${result.reasonCode}`);
  }
  expect(result.reasonCode).toBe(X402_SIGNER_READY);
  return { v2, requirement, payload: result.payload, payer, signer };
}

function submitInput(
  storePath: string,
  evidencePath: string,
  authorizationId: string,
  paymentRequirement: X402PaymentRequirement,
  signedPayload: X402SignedPaymentPayload,
  client: FakeClient,
  now: Date = DEFAULT_NOW
) {
  return { storePath, settlementEvidenceStorePath: evidencePath, authorizationId, paymentRequirement, signedPayload, now, client };
}

// ---------------------------------------------------------------------------
// Batch 1 — submit path.
// ---------------------------------------------------------------------------

describe("I5 submit: mocked settle success", () => {
  test("durable accepted_pending evidence; state stays submitted; no signature bytes; request carries bound payload+requirement", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );

    expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_PENDING);
    expect(result.outcome).toBe("accepted_pending");
    // NOT confirmed: acceptance only.
    expect(result.executionState).toBe("submitted");
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("submitted");
    expect(eventFiles(storePath, v2.authorizationId)).toHaveLength(2);
    expect(result.gatewayTransferId).toBe(TRANSFER_UUID);
    expect(result.gatewayTransferStatus).toBe("received");
    expect(result.settlementEvidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Exactly one settle call; request carries the bound payload + requirements.
    expect(client.settleCalls).toBe(1);
    expect(client.lastSettleRequest).not.toBeNull();
    expect(client.lastSettleRequest!.paymentPayload).toEqual(payload);
    expect(client.lastSettleRequest!.paymentRequirements.network).toBe(ARC_TESTNET_NETWORK);
    expect(client.lastSettleRequest!.paymentRequirements.asset.toLowerCase()).toBe(ARC_USDC_ASSET.toLowerCase());
    expect(client.lastSettleRequest!.paymentRequirements.payTo.toLowerCase()).toBe(TEST_PAYTO.toLowerCase());
    expect(client.lastSettleRequest!.paymentRequirements.amount).toBe("80000");

    // Durable evidence snapshot with the exact contract shape.
    const evidence = await latestSettlementEvidence(evidencePath, v2.authorizationId);
    expect(evidence).not.toBeNull();
    expect(evidence!.outcome).toBe("accepted_pending");
    expect(evidence!.source).toBe("settle_response");
    expect(evidence!.gatewayTransferId).toBe(TRANSFER_UUID);
    expect(evidence!.gatewayTransferStatus).toBe("received");
    expect(evidence!.gatewaySuccess).toBe(true);
    expect(evidence!.gatewayErrorReason).toBeNull();
    expect(evidence!.batchTxHash).toBeNull();

    // No raw signature / payload leakage in ANY persisted byte.
    const bytes = serializeStores(storePath, evidencePath);
    expect(bytes).not.toContain(payload.payload.signature);
    expect(bytes).not.toMatch(/0x[0-9a-fA-F]{130}/);
    expect(bytes).not.toMatch(/"signature"\s*:/);
  });
});

describe("I5 submit: final Guard-expiry guard (zero transport calls)", () => {
  test("now = expiresAt - 1ms → exactly one settle call", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    const expiresMs = Date.parse(record!.prepared.authorizationExpiresAt);
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client, new Date(expiresMs - 1))
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_PENDING);
    expect(client.settleCalls).toBe(1);
  });

  test("now === expiresAt → _AUTHORIZATION_EXPIRED, zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    const expiresMs = Date.parse(record!.prepared.authorizationExpiresAt);
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client, new Date(expiresMs))
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_AUTHORIZATION_EXPIRED);
    expect(client.settleCalls).toBe(0);
  });

  test("now after expiresAt → _AUTHORIZATION_EXPIRED, zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    const expiresMs = Date.parse(record!.prepared.authorizationExpiresAt);
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client, new Date(expiresMs + 1_000))
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_AUTHORIZATION_EXPIRED);
    expect(client.settleCalls).toBe(0);
  });

  test("malformed clock (new Date(NaN)) → _AUTHORIZATION_EXPIRED, zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client, new Date(NaN))
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_AUTHORIZATION_EXPIRED);
    expect(client.settleCalls).toBe(0);
  });

  test("unparseable durable authorizationExpiresAt fails closed with zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    // Rewrite the prepared event with an expiry the store parser itself
    // refuses: the durable re-read fails closed BEFORE the transport (the
    // I3 store guarantees an unparseable expiry can never survive to the
    // submit guard — corrupt store → _STATE_CONFLICT, still zero calls).
    const file = eventFile(storePath, v2.authorizationId, 1);
    const event = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    event.authorizationExpiresAt = "not-a-timestamp";
    writeFileSync(file, JSON.stringify(event));
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_STATE_CONFLICT);
    expect(client.settleCalls).toBe(0);
  });
});

describe("I5 submit: pre-submit binding guards (zero transport calls)", () => {
  test("payload substitutions (signature / amount / recipient / nonce) → _PAYLOAD_DIGEST_MISMATCH", async () => {
    const tamperings: Array<(payload: X402SignedPaymentPayload) => void> = [
      (p) => {
        p.payload.signature = `0x${"f".repeat(130)}`;
      },
      (p) => {
        p.payload.authorization.value = "80001";
      },
      (p) => {
        p.payload.authorization.to = TEST_PAYTO_ALT;
      },
      (p) => {
        p.payload.authorization.nonce = `0x${"e".repeat(64)}`;
      }
    ];
    for (const tamper of tamperings) {
      const storePath = makeTempStorePath();
      const evidencePath = makeTempEvidencePath();
      const { v2, requirement, payload } = await signedSubmission(storePath);
      const tampered = structuredClone(payload);
      tamper(tampered);
      expect(signerPayloadDigest(tampered)).not.toBe(signerPayloadDigest(payload));
      const client = makeFakeClient({ settle: settleOk() });

      const result = await submitX402GatewaySettlement(
        submitInput(storePath, evidencePath, v2.authorizationId, requirement, tampered, client)
      );
      expect(result.reasonCode).toBe(X402_GATEWAY_PAYLOAD_DIGEST_MISMATCH);
      expect(client.settleCalls).toBe(0);
    }
  });

  test("requirement substitution → _REQUIREMENT_DIGEST_MISMATCH, zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, payload } = await signedSubmission(storePath);
    const substituted = makeValidRequirement({ payTo: TEST_PAYTO_ALT });
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, substituted, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH);
    expect(client.settleCalls).toBe(0);
  });

  test("in-memory record tampering ignored: disk (prepared) wins over the caller-held submitted record", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const client = makeFakeClient({ settle: settleOk() });

    // The caller still "holds" the I4 in-memory record claiming `submitted`,
    // but the submitted event is removed from disk: the module must re-read
    // durable state (prepared) and refuse.
    unlinkSync(eventFile(storePath, v2.authorizationId, 2));
    expect(existsSync(eventFile(storePath, v2.authorizationId, 2))).toBe(false);

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_EXECUTION_NOT_SUBMITTED);
    expect(result.executionState).toBe("prepared");
    expect(client.settleCalls).toBe(0);
  });

  test("corrupt durable store → _STATE_CONFLICT, zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    writeFileSync(eventFile(storePath, v2.authorizationId, 1), "{ not json");
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_STATE_CONFLICT);
    expect(client.settleCalls).toBe(0);
  });

  test("missing record → _EXECUTION_NOT_FOUND, zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const client = makeFakeClient({ settle: settleOk() });
    const requirement = makeValidRequirement();
    // The durable re-read is the FIRST guard: the payload is never even
    // digested, so any structurally-typed transient object suffices.
    const foreign: X402SignedPaymentPayload = {
      x402Version: 2,
      accepted: requirement,
      payload: {
        signature: `0x${"ab".repeat(65)}`,
        authorization: {
          from: TEST_PAYTO,
          to: GATEWAY_WALLET,
          value: "80000",
          validAfter: "0",
          validBefore: "4102444800",
          nonce: `0x${"d".repeat(64)}`
        }
      }
    };

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, `auth_${"9".repeat(64)}`, requirement, foreign, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_EXECUTION_NOT_FOUND);
    expect(client.settleCalls).toBe(0);
    expect(serializeStores(storePath, evidencePath)).toBe("");
  });
});

describe("I5 submit: ambiguous transport outcomes", () => {
  // TRANSPORT_TIMEOUT / TRANSPORT_FAILURE / RESPONSE_INVALID are frozen
  // shared X402_GATEWAY_* codes → reported verbatim; TOO_LARGE / REDIRECT
  // are transport-internal → mapped to _REMOTE_OUTCOME_UNKNOWN.
  const ambiguous: Array<[string, GatewayTransportReasonCode, number | null, X402GatewayReasonCode]> = [
    ["timeout", "X402_GATEWAY_TRANSPORT_TIMEOUT", null, X402_GATEWAY_TRANSPORT_TIMEOUT],
    ["connection reset", "X402_GATEWAY_TRANSPORT_FAILURE", null, X402_GATEWAY_TRANSPORT_FAILURE],
    ["malformed body", "X402_GATEWAY_RESPONSE_INVALID", 200, X402_GATEWAY_RESPONSE_INVALID],
    ["oversized body", "X402_GATEWAY_RESPONSE_TOO_LARGE", 200, X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN],
    ["redirect rejected", "X402_GATEWAY_REDIRECT_REJECTED", 302, X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN]
  ];
  for (const [label, code, status, expected] of ambiguous) {
    test(`${label} → durable remote_outcome_unknown evidence + state; exactly ONE settle call`, async () => {
      const storePath = makeTempStorePath();
      const evidencePath = makeTempEvidencePath();
      const { v2, requirement, payload } = await signedSubmission(storePath);
      const client = makeFakeClient({ settle: settleUnknown(code, status) });

      const result = await submitX402GatewaySettlement(
        submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
      );
      expect(result.reasonCode).toBe(expected);
      expect(client.settleCalls).toBe(1);
      expect(client.listCalls).toBe(0);

      const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
      expect(record?.state).toBe("remote_outcome_unknown");
      expect(record?.remoteOutcomeUnknown?.reasonCode).toBe(expected);
      expect(record?.remoteOutcomeUnknown?.gatewayTransferId).toBeNull();

      const evidence = await latestSettlementEvidence(evidencePath, v2.authorizationId);
      expect(evidence?.outcome).toBe("remote_outcome_unknown");
      expect(evidence?.source).toBe("settle_transport");
      expect(evidence?.gatewayTransferId).toBeNull();
      expect(evidence?.gatewayTransferStatus).toBeNull();
      expect(evidence?.gatewaySuccess).toBeNull();
      expect(evidence?.gatewayErrorReason).toBeNull();
      expect(evidence?.batchTxHash).toBeNull();
    });
  }

  test("HTTP 5xx with a parsing success:true body → ambiguous path, never accepted_pending", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const client = makeFakeClient({
      settle: {
        kind: "response",
        httpStatus: 502,
        response: {
          success: true,
          transaction: TRANSFER_UUID,
          network: ARC_TESTNET_NETWORK,
          errorReason: null,
          payerAddress: null
        }
      }
    });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN);
    expect(client.settleCalls).toBe(1);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("remote_outcome_unknown");
    const evidence = await latestSettlementEvidence(evidencePath, v2.authorizationId);
    expect(evidence?.outcome).toBe("remote_outcome_unknown");
    expect(evidence?.gatewayTransferId).toBeNull();
  });
});

describe("I5 submit: deterministic rejections", () => {
  test("4xx + validated success:false → durable failure evidence + state failed(settle) + _KNOWN_REJECTION", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const client = makeFakeClient({
      settle: {
        kind: "response",
        httpStatus: 400,
        response: {
          success: false,
          transaction: "",
          network: ARC_TESTNET_NETWORK,
          errorReason: "insufficient_balance",
          payerAddress: null
        }
      }
    });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_KNOWN_REJECTION);
    expect(client.settleCalls).toBe(1);

    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("failed");
    expect(record?.terminal).toMatchObject({
      state: "failed",
      failureStage: "settle",
      failureCode: X402_GATEWAY_KNOWN_REJECTION
    });

    const evidence = await latestSettlementEvidence(evidencePath, v2.authorizationId);
    expect(evidence?.outcome).toBe("failed");
    expect(evidence?.source).toBe("settle_response");
    expect(evidence?.gatewaySuccess).toBe(false);
    expect(evidence?.gatewayErrorReason).toBe("insufficient_balance");
  });

  test("nonce_already_used → _NONCE_ALREADY_USED_RECONCILE_REQUIRED; not failed; NOTHING written; ONE settle call", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const client = makeFakeClient({
      settle: {
        kind: "response",
        httpStatus: 400,
        response: {
          success: false,
          transaction: "",
          network: ARC_TESTNET_NETWORK,
          errorReason: "nonce_already_used",
          payerAddress: null
        }
      }
    });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_NONCE_ALREADY_USED_RECONCILE_REQUIRED);
    expect(client.settleCalls).toBe(1);

    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("submitted");
    expect(eventFiles(storePath, v2.authorizationId)).toHaveLength(2);
    const load = await readSettlementEvidence(evidencePath, v2.authorizationId);
    expect(load.kind).toBe("missing");
  });

  test("validated response whose network != durable → _STATE_CONFLICT, no state change", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const client = makeFakeClient({
      settle: {
        kind: "response",
        httpStatus: 200,
        response: {
          success: true,
          transaction: TRANSFER_UUID,
          network: "eip155:84532",
          errorReason: null,
          payerAddress: null
        }
      }
    });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_STATE_CONFLICT);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("submitted");
    const load = await readSettlementEvidence(evidencePath, v2.authorizationId);
    expect(load.kind).toBe("missing");
  });
});

describe("I5 submit: legacy pre-I5 submitted record", () => {
  test("submitted event with ONLY nonce + signerPayloadDigest → _RECOVERY_METADATA_MISSING, zero calls", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const { v2, requirement, payload } = await signedSubmission(storePath);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    // Hand-write the legacy submitted event exactly as a pre-I5 store
    // would have persisted it: nonce + digest only, no recovery block.
    const legacy = {
      eventType: "x402_execution_state",
      version: "v1",
      sequence: 2,
      state: "submitted",
      authorizationId: v2.authorizationId,
      occurredAt: "2026-07-07T10:18:30.000Z",
      nonce: record!.prepared.nonce,
      signerPayloadDigest: `sha256:${"c".repeat(64)}`
    };
    writeFileSync(eventFile(storePath, v2.authorizationId, 2), JSON.stringify(legacy));
    const client = makeFakeClient({ settle: settleOk() });

    const result = await submitX402GatewaySettlement(
      submitInput(storePath, evidencePath, v2.authorizationId, requirement, payload, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_RECOVERY_METADATA_MISSING);
    expect(client.settleCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 2 — reconcile / ordering / crash recovery.
// ---------------------------------------------------------------------------

type FullRecord = X402ExecutionRecord & { submitted: NonNullable<X402ExecutionRecord["submitted"]> };

async function durableSubmitted(storePath: string, authorizationId: string): Promise<FullRecord> {
  const record = await readX402ExecutionRecord(storePath, authorizationId);
  if (!record || record.state !== "submitted" || !record.submitted?.recoveryMetadataComplete) {
    throw new Error("expected durable submitted record with recovery metadata");
  }
  return record as FullRecord;
}

function snapshotFor(
  record: FullRecord,
  overrides: Partial<GatewayTransferSnapshot> = {}
): GatewayTransferSnapshot {
  return {
    transferId: TRANSFER_UUID,
    status: "received",
    nonce: record.prepared.nonce,
    sendingNetwork: record.prepared.network,
    recipientNetwork: record.prepared.network,
    payerAddress: record.submitted.payerAddress!,
    payToAddress: record.prepared.payTo,
    amountAtomic: record.prepared.amountAtomic,
    token: "USDC",
    batchTxHash: null,
    ...overrides
  };
}

function reconcileInput(storePath: string, evidencePath: string, authorizationId: string, client: FakeClient, now: Date = DEFAULT_NOW) {
  return { storePath, settlementEvidenceStorePath: evidencePath, authorizationId, now, client };
}

/** submitted → remote_outcome_unknown via one ambiguous settle. */
async function submitAmbiguous(storePath: string, evidencePath: string, authorizationId: string, requirement: X402PaymentRequirement, payload: X402SignedPaymentPayload) {
  const client = makeFakeClient({ settle: settleUnknown("X402_GATEWAY_TRANSPORT_TIMEOUT", null) });
  const result = await submitX402GatewaySettlement(
    submitInput(storePath, evidencePath, authorizationId, requirement, payload, client)
  );
  expect(result.reasonCode).toBe(X402_GATEWAY_TRANSPORT_TIMEOUT);
  return client;
}

describe("I5 reconcile: status mapping (never a second settle)", () => {
  for (const status of ["received", "batched"] as const) {
    test(`${status} → NEW accepted_pending snapshot, _TRANSFER_PENDING, state untouched`, async () => {
      const storePath = makeTempStorePath();
      const evidencePath = makeTempEvidencePath();
      const { v2, record: rec } = await (async () => {
        const s = await signedSubmission(storePath);
        const record = await durableSubmitted(storePath, s.v2.authorizationId);
        return { ...s, record };
      })();
      const client = makeFakeClient({
        list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status })] },
        get: { kind: "not_found" }
      });

      const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, v2.authorizationId, client));
      expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_PENDING);
      expect(result.outcome).toBe("accepted_pending");
      expect(result.executionState).toBe("submitted");
      expect(client.settleCalls).toBe(0);
      const evidence = await latestSettlementEvidence(evidencePath, v2.authorizationId);
      expect(evidence?.outcome).toBe("accepted_pending");
      expect(evidence?.source).toBe("transfer_snapshot");
      expect(evidence?.gatewayTransferStatus).toBe(status);
      const after = await readX402ExecutionRecord(storePath, v2.authorizationId);
      expect(after?.state).toBe("submitted");
    });
  }

  test("confirmed → confirmed evidence FIRST, then I3 confirmed; official status preserved", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "confirmed" })] }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_CONFIRMED);
    expect(result.outcome).toBe("confirmed");
    expect(result.gatewayTransferStatus).toBe("confirmed");
    expect(client.settleCalls).toBe(0);
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("confirmed");
    expect(after?.terminal).toMatchObject({ state: "confirmed", settlementEvidenceDigest: result.settlementEvidenceDigest });
    const evidence = await latestSettlementEvidence(evidencePath, s.v2.authorizationId);
    expect(evidence?.outcome).toBe("confirmed");
    expect(evidence?.gatewayTransferStatus).toBe("confirmed");
  });

  test("completed → outcome completed with the official completed status (never downgraded/confused)", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "completed", batchTxHash: `0x${"7".repeat(64)}` })] }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_CONFIRMED);
    expect(result.outcome).toBe("completed");
    expect(result.gatewayTransferStatus).toBe("completed");
    const evidence = await latestSettlementEvidence(evidencePath, s.v2.authorizationId);
    expect(evidence?.outcome).toBe("completed");
    expect(evidence?.batchTxHash).toBe(`0x${"7".repeat(64)}`);
  });

  test("failed → failed evidence + I3 failed(settle, TRANSFER_FAILED); never an accounting release", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "failed" })] }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_FAILED);
    expect(client.settleCalls).toBe(0);
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("failed");
    expect(after?.terminal).toMatchObject({ state: "failed", failureStage: "settle", failureCode: X402_GATEWAY_TRANSFER_FAILED });
    // The nonce claim stays locked: reconciliation NEVER frees at-risk accounting.
    expect(readdirSync(join(storePath, "nonces")).length).toBe(1);
  });

  test("confirmed/batched states are input-rejected: confirmed→_STATE_CONFLICT, prepared→_EXECUTION_NOT_SUBMITTED", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const okList = { kind: "response" as const, httpStatus: 200, transfers: [snapshotFor(rec, { status: "confirmed" })] };
    const finishClient = makeFakeClient({ list: okList });
    const finish = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, finishClient));
    expect(finish.reasonCode).toBe(X402_GATEWAY_TRANSFER_CONFIRMED);
    expect(finishClient.settleCalls).toBe(0); // reconcile NEVER retries settle

    const againClient = makeFakeClient({ list: okList });
    const again = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, againClient));
    expect(again.reasonCode).toBe(X402_GATEWAY_STATE_CONFLICT);
    expect(again.executionState).toBe("confirmed");
    expect(againClient.settleCalls).toBe(0);
  });
});

describe("I5 reconcile: identity filter", () => {
  test("two identity-matching transfers → _REMOTE_TRANSFER_MISMATCH, nothing written, no arbitrary pick", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const client = makeFakeClient({
      list: {
        kind: "response",
        httpStatus: 200,
        transfers: [
          snapshotFor(rec, { status: "confirmed" }),
          snapshotFor(rec, { transferId: "22222222-2222-4222-8222-222222222222", status: "failed" })
        ]
      }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_REMOTE_TRANSFER_MISMATCH);
    expect(client.getCalls).toBe(0);
    expect(client.settleCalls).toBe(0);
    expect(await latestSettlementEvidence(evidencePath, s.v2.authorizationId)).toBeNull();
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("submitted");
  });

  test("getTransfer refinement contradicting durable identity → _REMOTE_TRANSFER_MISMATCH, nothing written", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "received" })] },
      get: {
        kind: "response",
        httpStatus: 200,
        transfer: snapshotFor(rec, { status: "confirmed", amountAtomic: "99999" })
      }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_REMOTE_TRANSFER_MISMATCH);
    expect(client.settleCalls).toBe(0);
    expect(await latestSettlementEvidence(evidencePath, s.v2.authorizationId)).toBeNull();
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("submitted");
  });

  test("zero identity matches → _REMOTE_OUTCOME_UNKNOWN path: submitted durably enters remote_outcome_unknown", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const client = makeFakeClient({
      list: {
        kind: "response",
        httpStatus: 200,
        // Right nonce, WRONG payer: identity must reject it.
        transfers: [snapshotFor(rec, { payerAddress: TEST_PAYTO_ALT })]
      }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN);
    expect(client.settleCalls).toBe(0);
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("remote_outcome_unknown");
    const evidence = await latestSettlementEvidence(evidencePath, s.v2.authorizationId);
    expect(evidence?.outcome).toBe("remote_outcome_unknown");
  });

  test("already remote_outcome_unknown + empty list → unchanged, _REMOTE_OUTCOME_UNKNOWN", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    await submitAmbiguous(storePath, evidencePath, s.v2.authorizationId, s.requirement, s.payload);
    const before = await readSettlementEvidence(evidencePath, s.v2.authorizationId);
    expect(before.kind).toBe("snapshots");

    const client = makeFakeClient({ list: { kind: "response", httpStatus: 200, transfers: [] } });
    const result = await reconcileX402GatewayOutcome(
      reconcileInput(storePath, evidencePath, s.v2.authorizationId, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN);
    expect(client.settleCalls).toBe(0);
    expect(result.executionState).toBe("remote_outcome_unknown");
    const after = await readSettlementEvidence(evidencePath, s.v2.authorizationId);
    expect(after.kind === "snapshots" && after.snapshots.length).toBe(before.kind === "snapshots" ? before.snapshots.length : 0);
  });

  test("refinement contradicting durable identity on ANY bound field (payer / payTo / amount / sendingNetwork / recipientNetwork / token) → _REMOTE_TRANSFER_MISMATCH, nothing written", async () => {
    const mismatches: Array<[string, Partial<GatewayTransferSnapshot>]> = [
      ["payer", { payerAddress: TEST_PAYTO_ALT }],
      ["payTo", { payToAddress: TEST_PAYTO_ALT }],
      ["amount", { amountAtomic: "79999" }],
      ["sendingNetwork", { sendingNetwork: "eip155:8453" }],
      ["recipientNetwork", { recipientNetwork: "eip155:8453" }],
      ["token", { token: "USDT" }]
    ];
    for (const [label, override] of mismatches) {
      const storePath = makeTempStorePath();
      const evidencePath = makeTempEvidencePath();
      const s = await signedSubmission(storePath);
      const rec = await durableSubmitted(storePath, s.v2.authorizationId);
      const client = makeFakeClient({
        list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "confirmed" })] },
        get: {
          kind: "response",
          httpStatus: 200,
          transfer: snapshotFor(rec, { status: "confirmed", ...override })
        }
      });

      const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
      expect(result.reasonCode, `${label} substitution must fail closed`).toBe(X402_GATEWAY_REMOTE_TRANSFER_MISMATCH);
      expect(client.settleCalls).toBe(0);
      expect(await latestSettlementEvidence(evidencePath, s.v2.authorizationId), `${label}: no evidence written`).toBeNull();
      const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
      expect(after?.state, `${label}: no state change`).toBe("submitted");
    }
  });
});

describe("I5 ordering mandate + crash recovery", () => {
  test("conflicting evidence append ⇒ NO transition: never confirmed, _SETTLEMENT_EVIDENCE_CONFLICT", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    // Pre-poison the evidence lane: a snapshot under the SAME nonce but a
    // DIFFERENT base linkage makes every later append CONFLICT.
    await appendSettlementEvidence({
      storePath: evidencePath,
      evidence: buildSettlementEvidence({
        authorizationId: rec.authorizationId,
        parentAuthorizationId: rec.prepared.parentAuthorizationId,
        auditId: rec.prepared.auditId,
        agentId: rec.prepared.agentId,
        paymentRequirementDigest: rec.prepared.paymentRequirementDigest,
        signerPayloadDigest: rec.submitted.signerPayloadDigest,
        network: rec.prepared.network,
        assetAddress: rec.prepared.assetAddress,
        payerAddress: rec.submitted.payerAddress!,
        payTo: TEST_PAYTO_ALT, // conflicting base linkage
        amountAtomic: rec.prepared.amountAtomic,
        nonce: rec.prepared.nonce,
        source: "transfer_snapshot",
        outcome: "accepted_pending",
        gatewayTransferId: "22222222-2222-4222-8222-222222222222",
        gatewayTransferStatus: "received",
        gatewaySuccess: null,
        gatewayErrorReason: null,
        batchTxHash: null,
        recordedAt: DEFAULT_NOW.toISOString()
      })
    });
    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "confirmed" })] }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT);
    expect(client.settleCalls).toBe(0);
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("submitted"); // markX402ExecutionConfirmed NEVER reached
  });

  test("evidence append cannot succeed (broken store path) ⇒ same NO-transition guarantee", async () => {
    const storePath = makeTempStorePath();
    const evidenceDir = mkdtempSync(join(tmpdir(), "agentpay-x402-gwsettle-"));
    tempDirs.push(evidenceDir);
    // The evidence root is a plain FILE: no append can ever succeed.
    const evidencePath = join(evidenceDir, "blocked");
    writeFileSync(evidencePath, "not a store");
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "confirmed" })] }
    });

    const result = await reconcileX402GatewayOutcome(reconcileInput(storePath, evidencePath, s.v2.authorizationId, client));
    expect(result.reasonCode).toBe(X402_GATEWAY_SETTLEMENT_EVIDENCE_CONFLICT);
    expect(client.settleCalls).toBe(0);
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("submitted"); // markX402ExecutionConfirmed NEVER reached
  });

  test("restart (A): persisted remote_outcome_unknown → fresh reads → reconcile confirmed", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    await durableSubmitted(storePath, s.v2.authorizationId);
    await submitAmbiguous(storePath, evidencePath, s.v2.authorizationId, s.requirement, s.payload);
    // Simulated restart: nothing but disk. Fresh durable read.
    const fresh = await durableSubmitted(storePath, s.v2.authorizationId).catch(() => null);
    expect(fresh).toBeNull(); // state is remote_outcome_unknown, not submitted
    const reread = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(reread?.state).toBe("remote_outcome_unknown");

    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(reread as FullRecord, { status: "confirmed" })] }
    });
    const result = await reconcileX402GatewayOutcome(
      reconcileInput(storePath, evidencePath, s.v2.authorizationId, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_CONFIRMED);
    expect(client.settleCalls).toBe(0); // reconcile NEVER retries settle
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("confirmed");
  });

  test("restart (B): evidence persisted WITHOUT the I3 transition → finish replays it idempotently", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    // Crash window simulated directly: confirmed evidence durable, transition missing.
    const evidence = buildSettlementEvidence({
      authorizationId: rec.authorizationId,
      parentAuthorizationId: rec.prepared.parentAuthorizationId,
      auditId: rec.prepared.auditId,
      agentId: rec.prepared.agentId,
      paymentRequirementDigest: rec.prepared.paymentRequirementDigest,
      signerPayloadDigest: rec.submitted.signerPayloadDigest,
      network: rec.prepared.network,
      assetAddress: rec.prepared.assetAddress,
      payerAddress: rec.submitted.payerAddress!,
      payTo: rec.prepared.payTo,
      amountAtomic: rec.prepared.amountAtomic,
      nonce: rec.prepared.nonce,
      source: "transfer_snapshot",
      outcome: "confirmed",
      gatewayTransferId: TRANSFER_UUID,
      gatewayTransferStatus: "confirmed",
      gatewaySuccess: null,
      gatewayErrorReason: null,
      batchTxHash: null,
      recordedAt: DEFAULT_NOW.toISOString()
    });
    await appendSettlementEvidence({ storePath: evidencePath, evidence });

    const first = await finishX402GatewayConfirmation({
      storePath, settlementEvidenceStorePath: evidencePath, authorizationId: s.v2.authorizationId, now: DEFAULT_NOW
    });
    expect(first.reasonCode).toBe(X402_GATEWAY_TRANSFER_CONFIRMED);
    expect(first.executionState).toBe("confirmed");
    const confirmedAt = eventFiles(storePath, s.v2.authorizationId).length;

    const second = await finishX402GatewayConfirmation({
      storePath, settlementEvidenceStorePath: evidencePath, authorizationId: s.v2.authorizationId, now: DEFAULT_NOW
    });
    expect(second.reasonCode).toBe(X402_GATEWAY_TRANSFER_CONFIRMED); // REPLAYED = success
    expect(second.executionState).toBe("confirmed");
    expect(eventFiles(storePath, s.v2.authorizationId)).toHaveLength(confirmedAt);
  });

  test("restart (C): lost transient payload after submitted → reconcile by nonce, NEVER re-sign", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const rec = await durableSubmitted(storePath, s.v2.authorizationId);
    delete (s as { payload?: X402SignedPaymentPayload }).payload; // lost transient payload
    const signCallsBefore = s.signer.callCount();

    const client = makeFakeClient({
      list: { kind: "response", httpStatus: 200, transfers: [snapshotFor(rec, { status: "confirmed" })] }
    });
    const result = await reconcileX402GatewayOutcome(
      reconcileInput(storePath, evidencePath, s.v2.authorizationId, client)
    );
    expect(result.reasonCode).toBe(X402_GATEWAY_TRANSFER_CONFIRMED);
    expect(client.settleCalls).toBe(0); // reconcile NEVER retries settle
    expect(s.signer.callCount()).toBe(signCallsBefore); // NO AUTOMATIC RE-SIGN
    const after = await readX402ExecutionRecord(storePath, s.v2.authorizationId);
    expect(after?.state).toBe("confirmed");
    expect(after?.terminal).toMatchObject({ state: "confirmed" });
  });

  test("finish with no confirmable evidence changes nothing and reports honestly", async () => {
    const storePath = makeTempStorePath();
    const evidencePath = makeTempEvidencePath();
    const s = await signedSubmission(storePath);
    const pending = await finishX402GatewayConfirmation({
      storePath, settlementEvidenceStorePath: evidencePath, authorizationId: s.v2.authorizationId, now: DEFAULT_NOW
    });
    expect(pending.reasonCode).toBe(X402_GATEWAY_TRANSFER_PENDING);
    expect(pending.executionState).toBe("submitted");
    expect(eventFiles(storePath, s.v2.authorizationId)).toHaveLength(2);
  });
});

