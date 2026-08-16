/**
 * x402-execution-store.test.ts
 *
 * I3 — restart-safe, filesystem-backed execution state store tests: an
 * eligible x402 ExecutionAuthorization v2 is consumed EXACTLY ONCE into a
 * durable single-use execution claim (prepared record + bound EIP-3009
 * nonce) before any future signer can be contacted. No signer, no payment,
 * no Gateway call, no transaction, no settlement (I4–I6 / Phase 9 out of
 * scope).
 *
 * Conventions (matching the repo suite): temp execution-store paths ONLY
 * (mkdtempSync — never data/execution-store/); temp audit paths with
 * AGENTPAY_* env overrides restored in afterEach; no mocks of execution, no
 * fake transaction hashes/wallets/signatures; deterministic TEST-ONLY
 * addresses; explicit `now`/`occurredAt` values — no sleeps, no
 * machine-clock dependence, no Date.now() in the store.
 */
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
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
  markX402ExecutionConfirmed,
  markX402ExecutionFailed,
  markX402ExecutionSubmitted,
  prepareX402ExecutionAttempt,
  readX402ExecutionRecord,
  X402_EXECUTION_ALREADY_CONSUMED,
  X402_EXECUTION_AUTHORIZATION_EXPIRED,
  X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED,
  X402_EXECUTION_GATE_NOT_ELIGIBLE,
  X402_EXECUTION_INVALID_TRANSITION,
  X402_EXECUTION_NONCE_CONFLICT,
  X402_EXECUTION_NOT_FOUND,
  X402_EXECUTION_PREPARED,
  X402_EXECUTION_STATE_CONFLICT,
  X402_EXECUTION_STORE_CORRUPT,
  X402_EXECUTION_TRANSITION_APPLIED,
  X402_EXECUTION_TRANSITION_REPLAYED,
  X402ExecutionStoreError
} from "@/domain/x402/execution-store";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const TEST_PAYTO = "0x1111111111111111111111111111111111111111";

const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

function makeTempAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-store-"));
  tempDirs.push(dir);
  return join(dir, "audit-log.jsonl");
}

function makeTempStorePath() {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-store-"));
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

/**
 * Deterministic v1 authorization fixture. Defaults are current-policy
 * attributed (policyVersion "3" + live fingerprint) with FIXED timestamps
 * (issuedAt 10:15:30.000Z, expiresAt 10:20:30.000Z = issued + 300 s TTL).
 */
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

/** Deterministic replay evidence: exact replay, no mismatch, no drift. */
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

/** Raw official fixture per integration-feasibility.md (S17/S20/S21/S24/S25). */
function makeRequirementRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scheme: "exact",
    network: ARC_TESTNET_NETWORK,
    amount: "80000", // 0.08 USDC at 6 decimals, matching the canonical ALLOW fixture amount
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

/**
 * Real canonical chain: ALLOW scenario → evaluatePaymentIntent (v1) →
 * I1 requirement+evidence → I2 gate PASS → v2. The audit log is isolated to
 * a temp path. Returns everything needed to drive I3.
 */
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

/** Real I2 gate PASS for the canonical chain, at expiresAt - 1s (within TTL). */
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

/** Rebuild the exact success-shaped gate result for a given v2. */
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

const SUBMITTED_DIGEST = `sha256:${"c".repeat(64)}`;
const SETTLEMENT_DIGEST = `sha256:${"d".repeat(64)}`;
const FAILURE_CODE = "GATEWAY_REJECTED";

describe("prepare: first preparation consumes an eligible v2 exactly once (real chain)", () => {
  test("canonical ALLOW → v1 → I1 requirement → I2 PASS → v2 → I3 prepare: one event, one nonce, record matches v2", async () => {
    const storePath = makeTempStorePath();
    const { v1, replayEvidence } = await evaluateCanonicalAllow();
    const gateResult = gateResultForV1(v1, replayEvidence);
    const v2 = expectAllowed(gateResult);

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: DEFAULT_NOW
    });

    expect(result.prepared).toBe(true);
    if (!result.prepared) {
      throw new Error("prepare unexpectedly rejected");
    }
    expect(result.reasonCode).toBe(X402_EXECUTION_PREPARED);
    expect(result.record.authorizationId).toBe(v2.authorizationId);

    // exactly one authorization state event and exactly one nonce claim
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);

    // nonce format: 0x<64 lowercase hex> (exactly 32 bytes)
    expect(result.record.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.record.nonce.length).toBe(66);

    // record fields match the v2 evidence (payment fields come from v2 only)
    expect(result.record.parentAuthorizationId).toBe(v2.parentAuthorizationId);
    expect(result.record.auditId).toBe(v2.auditId);
    expect(result.record.idempotencyKey).toBe(v2.idempotencyKey);
    expect(result.record.agentId).toBe(v2.agentId);
    expect(result.record.recipient).toBe(v2.recipient);
    expect(result.record.paymentRequirementDigest).toBe(v2.paymentRequirementDigest);
    expect(result.record.network).toBe(v2.x402.network);
    expect(result.record.assetAddress).toBe(v2.x402.assetAddress);
    expect(result.record.payTo).toBe(v2.x402.payTo);
    expect(result.record.amountAtomic).toBe(v2.x402.amountAtomic);
    expect(result.record.policyVersion).toBe(v2.policyVersion);
    expect(result.record.policyFingerprint).toBe(v2.policyFingerprint);
    expect(result.record.authorizationExpiresAt).toBe(v2.expiresAt);
    expect(result.record.preparedAt).toBe(DEFAULT_NOW.toISOString());
    expect(result.record.nonce).toBe(deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest));

    // read API reconstructs the prepared state
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record).not.toBeNull();
    expect(record?.state).toBe("prepared");
    expect(record?.prepared).toEqual(result.record);
    expect(record?.submitted).toBeUndefined();
    expect(record?.terminal).toBeUndefined();

    // no signing/network/settlement fields anywhere in the persisted store
    const serialized = serializeStore(storePath);
    expect(serialized).not.toMatch(
      /privateKey|signature|signedPayload|PaymentPayload|transactionHash|txHash|gatewayTransferId|settlementStatus|rpcUrl|broadcast|seedPhrase/i
    );
  });
});

describe("prepare: duplicate and replay", () => {
  test("second prepare with the same v2 gate result → X402_EXECUTION_ALREADY_CONSUMED; no second event, no second nonce", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);

    const duplicate = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date("2026-07-07T10:19:00.000Z")
    });

    expect(duplicate).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.state).toBe("prepared");
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.prepared.nonce).toBe(record.nonce);
  });

  test("exact replay of the canonical evaluation: replay v2 prepares once, the second exact-replay v2 is duplicate/consumed", async () => {
    const auditPath = makeTempAuditPath();
    const first = await evaluateCanonicalAllow(auditPath);
    const second = await evaluateCanonicalAllow(auditPath);

    // exact replay → same v1, same deterministic v2
    expect(second.replayEvidence).toMatchObject({ replayed: true, replayMismatch: false, policyChanged: false });
    expect(second.v1.authorizationId).toBe(first.v1.authorizationId);
    const v2First = expectAllowed(gateResultForV1(first.v1, first.replayEvidence));
    const v2Second = expectAllowed(gateResultForV1(second.v1, second.replayEvidence));
    expect(v2Second.authorizationId).toBe(v2First.authorizationId);

    const storePath = makeTempStorePath();
    const firstPrepare = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2First),
      storePath,
      now: DEFAULT_NOW
    });
    expect(firstPrepare.prepared).toBe(true);

    // evaluation replay consistency does NOT mean execution may happen twice
    const secondPrepare = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2Second),
      storePath,
      now: new Date("2026-07-07T10:19:00.000Z")
    });
    expect(secondPrepare).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
    expect(eventFiles(storePath, v2First.authorizationId)).toEqual(["0001.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);
  });
});

describe("prepare: concurrency", () => {
  test("Promise.all of 15 identical prepares → exactly one success, one prepared event, one nonce claim", async () => {
    const storePath = makeTempStorePath();
    const { v1, replayEvidence } = await evaluateCanonicalAllow();
    const v2 = expectAllowed(gateResultForV1(v1, replayEvidence));

    const attempts = await Promise.all(
      Array.from({ length: 15 }, () =>
        prepareX402ExecutionAttempt({ gateResult: allowedGateResult(v2), storePath, now: DEFAULT_NOW })
      )
    );

    const successes = attempts.filter((result) => result.prepared === true);
    const duplicates = attempts.filter((result) => result.prepared === false);

    expect(successes).toHaveLength(1);
    expect(duplicates).toHaveLength(14);
    for (const duplicate of duplicates) {
      expect(duplicate).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
    }
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
    expect(nonceFiles(storePath)).toHaveLength(1);
    const record = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(record?.state).toBe("prepared");
    expect(record?.prepared.nonce).toBe(deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest));
  });
});

describe("prepare: restart safety and crash-window recovery", () => {
  test("restart safety: a fresh independent read sees prepared with the same nonce/digest; prepare stays blocked", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);

    // no module-level state exists; a fresh read reconstructs from the files
    const fresh = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(fresh?.state).toBe("prepared");
    expect(fresh?.prepared.nonce).toBe(record.nonce);
    expect(fresh?.prepared.paymentRequirementDigest).toBe(v2.paymentRequirementDigest);
    expect(fresh?.prepared.amountAtomic).toBe("80000");

    const again = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date("2026-07-07T10:19:30.000Z")
    });
    expect(again).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
  });

  test("crash-window recovery: pre-existing same-authorization nonce claim + no prepared event → prepare succeeds exactly once, reuses the claim", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(makeTempStorePath()); // derive a real v2 (separate store, discarded)

    // Simulate a crash between nonce-claim creation and prepared-event creation:
    // the nonce claim exists, the authorization directory does not.
    const nonce = deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest);
    const nonceDir = join(storePath, "nonces");
    mkdirSync(nonceDir, { recursive: true });
    writeFileSync(
      join(nonceDir, `${nonce}.json`),
      `${JSON.stringify({
        eventType: "x402_nonce_claim",
        version: "v1",
        nonce,
        authorizationId: v2.authorizationId,
        paymentRequirementDigest: v2.paymentRequirementDigest,
        claimedAt: "2026-07-07T10:17:00.000Z"
      })}\n`,
      "utf8"
    );

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: DEFAULT_NOW
    });

    expect(result.prepared).toBe(true);
    if (!result.prepared) {
      throw new Error("recovery prepare unexpectedly rejected");
    }
    expect(result.record.nonce).toBe(nonce);
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]); // exactly one prepared event
    expect(nonceFiles(storePath)).toHaveLength(1); // claim reused, not duplicated

    // a second prepare after recovery is still consumed
    const duplicate = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date("2026-07-07T10:19:00.000Z")
    });
    expect(duplicate).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
  });

  test("crash-window recovery: a corrupt pre-existing nonce claim fails closed with X402_EXECUTION_STORE_CORRUPT", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(makeTempStorePath());

    const nonce = deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest);
    mkdirSync(join(storePath, "nonces"), { recursive: true });
    writeFileSync(join(storePath, "nonces", `${nonce}.json`), "this-is-not-json", "utf8");

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: DEFAULT_NOW
    });

    expect(result).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null });
    expect(existsSync(join(storePath, "authorizations", v2.authorizationId))).toBe(false);
  });
});

describe("nonce derivation and registry", () => {
  test("same v2 → same deterministic nonce; format 0x<64 lowercase hex> (exactly 32 bytes)", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);

    const nonceA = deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest);
    const nonceB = deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest);
    expect(nonceA).toBe(nonceB);
    expect(nonceA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Buffer.from(nonceA.slice(2), "hex")).toHaveLength(32);
  });

  test("different requirement digest (different v2) → different nonce", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);

    const variantRequirement = makeValidRequirement({ maxTimeoutSeconds: 604899 });
    const variant = expectAllowed(
      evaluateX402ExecutionGate(
        allowedGateInput({
          paymentRequirement: variantRequirement,
          paymentRequirementEvidence: makeEvidence(variantRequirement)
        })
      )
    );
    expect(variant.authorizationId).not.toBe(v2.authorizationId);

    const nonceBase = deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest);
    const nonceVariant = deriveX402ExecutionNonce(variant.authorizationId, variant.paymentRequirementDigest);
    expect(nonceVariant).not.toBe(nonceBase);
  });

  test("nonce registry file points to the correct authorization and digest", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);

    const [claimFile] = nonceFiles(storePath);
    expect(claimFile).toBe(`${record.nonce}.json`);
    const claim = JSON.parse(readFileSync(join(storePath, "nonces", claimFile), "utf8")) as Record<string, unknown>;
    expect(claim.eventType).toBe("x402_nonce_claim");
    expect(claim.version).toBe("v1");
    expect(claim.nonce).toBe(record.nonce);
    expect(claim.authorizationId).toBe(v2.authorizationId);
    expect(claim.paymentRequirementDigest).toBe(v2.paymentRequirementDigest);
    expect(claim.claimedAt).toBe(DEFAULT_NOW.toISOString());
  });

  test("a nonce file pre-claimed by a DIFFERENT authorization → X402_EXECUTION_NONCE_CONFLICT, no prepared event", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath); // v2 owns a valid claim on this store

    // v2B: same parent v1, different requirement digest → different v2 id + nonce
    const requirementB = makeValidRequirement({ maxTimeoutSeconds: 604899 });
    const evidenceB = makeEvidence(requirementB);
    const v2B = expectAllowed(
      evaluateX402ExecutionGate({
        authorization: makeV1Authorization(),
        replayEvidence: makeReplayEvidence(),
        paymentRequirement: requirementB,
        paymentRequirementEvidence: evidenceB,
        recipientBinding: makeBinding(),
        policy,
        now: DEFAULT_NOW
      })
    );

    // Pre-claim v2B's nonce path with a FOREIGN authorization's identity (tamper).
    const nonceB = deriveX402ExecutionNonce(v2B.authorizationId, v2B.paymentRequirementDigest);
    writeFileSync(
      join(storePath, "nonces", `${nonceB}.json`),
      `${JSON.stringify({
        eventType: "x402_nonce_claim",
        version: "v1",
        nonce: nonceB,
        authorizationId: v2.authorizationId, // foreign owner
        paymentRequirementDigest: v2.paymentRequirementDigest,
        claimedAt: DEFAULT_NOW.toISOString()
      })}\n`,
      "utf8"
    );

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2B),
      storePath,
      now: DEFAULT_NOW
    });
    expect(result).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_NONCE_CONFLICT, record: null });
    expect(existsSync(join(storePath, "authorizations", v2B.authorizationId))).toBe(false);
  });

  test("deriveX402ExecutionNonce rejects malformed authorizationId and digest (fail closed)", () => {
    expect(() => deriveX402ExecutionNonce("not-an-auth-id", `sha256:${"a".repeat(64)}`)).toThrow(
      X402ExecutionStoreError
    );
    expect(() => deriveX402ExecutionNonce(`auth_${"a".repeat(64)}`, "not-a-digest")).toThrow(
      X402ExecutionStoreError
    );
    expect(() => deriveX402ExecutionNonce(`auth_${"A".repeat(64)}`, `sha256:${"a".repeat(64)}`)).toThrow(
      X402ExecutionStoreError
    ); // uppercase hex rejected
  });
});

describe("prepare: expiry recheck (defense-in-depth)", () => {
  test("now just before v2 expiresAt → prepare succeeds", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(makeTempStorePath());

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date(Date.parse(v2.expiresAt) - 1)
    });
    expect(result.prepared).toBe(true);
    expect((await readX402ExecutionRecord(storePath, v2.authorizationId))?.state).toBe("prepared");
  });

  test("now === expiresAt → X402_EXECUTION_AUTHORIZATION_EXPIRED; nothing persisted", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(makeTempStorePath());

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date(v2.expiresAt)
    });
    expect(result).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_AUTHORIZATION_EXPIRED, record: null });
    expect(existsSync(join(storePath, "nonces"))).toBe(false);
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);
  });

  test("now > expiresAt → X402_EXECUTION_AUTHORIZATION_EXPIRED; nothing persisted", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(makeTempStorePath());

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date(Date.parse(v2.expiresAt) + 1)
    });
    expect(result).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_AUTHORIZATION_EXPIRED, record: null });
    expect(existsSync(join(storePath, "nonces"))).toBe(false);
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);
  });

  test("malformed expiresAt → X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED; nothing persisted", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(makeTempStorePath());
    const malformed = { ...v2, expiresAt: "not-a-timestamp" } as unknown as X402ExecutionAuthorizationV2;

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(malformed),
      storePath,
      now: DEFAULT_NOW
    });
    expect(result).toMatchObject({
      prepared: false,
      reasonCode: X402_EXECUTION_AUTHORIZATION_TIMESTAMP_MALFORMED,
      record: null
    });
    expect(existsSync(join(storePath, "nonces"))).toBe(false);
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);
  });

  test("NaN now → X402_EXECUTION_AUTHORIZATION_EXPIRED; nothing persisted", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(makeTempStorePath());

    const result = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date(NaN)
    });
    expect(result).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_AUTHORIZATION_EXPIRED, record: null });
    expect(existsSync(join(storePath, "nonces"))).toBe(false);
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);
  });
});

describe("prepare: rejected gate writes nothing", () => {
  test("replay-mismatch gate result → X402_EXECUTION_GATE_NOT_ELIGIBLE; no authorization dir, no nonce claim", async () => {
    const storePath = makeTempStorePath();
    const rejected = evaluateX402ExecutionGate(
      allowedGateInput({ replayEvidence: makeReplayEvidence({ replayMismatch: true }) })
    );
    expect(rejected.eligibleForSignerRequest).toBe(false);

    const result = await prepareX402ExecutionAttempt({
      gateResult: rejected,
      storePath,
      now: DEFAULT_NOW
    });
    expect(result).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_GATE_NOT_ELIGIBLE, record: null });
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);
    expect(existsSync(join(storePath, "nonces"))).toBe(false);
  });

  test("network-rejection gate result → X402_EXECUTION_GATE_NOT_ELIGIBLE; no durable state", async () => {
    const storePath = makeTempStorePath();
    const requirement = makeValidRequirement({ network: "eip155:84532" });
    const rejected = evaluateX402ExecutionGate(
      allowedGateInput({ paymentRequirement: requirement, paymentRequirementEvidence: makeEvidence(requirement) })
    );
    expect(rejected.eligibleForSignerRequest).toBe(false);
    expect(rejected.reasonCodes).toEqual(["X402_GATE_NETWORK_NOT_ALLOWED"]);

    const result = await prepareX402ExecutionAttempt({
      gateResult: rejected,
      storePath,
      now: DEFAULT_NOW
    });
    expect(result).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_GATE_NOT_ELIGIBLE, record: null });
    expect(existsSync(join(storePath, "authorizations"))).toBe(false);
    expect(existsSync(join(storePath, "nonces"))).toBe(false);
  });
});

describe("state machine", () => {
  test("prepared → submitted: applied; digest stored; nonce bound to the stored nonce", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);

    const result = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    expect(result.applied).toBe(true);
    if (!result.applied) {
      throw new Error("submitted transition unexpectedly rejected");
    }
    expect(result.reasonCode).toBe(X402_EXECUTION_TRANSITION_APPLIED);
    expect(result.record.state).toBe("submitted");
    expect(result.record.submitted).toMatchObject({ nonce: record.nonce, signerPayloadDigest: SUBMITTED_DIGEST });
    expect(result.record.terminal).toBeUndefined();
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("submitted → confirmed: applied with settlementEvidenceDigest; terminal confirmed", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const result = await markX402ExecutionConfirmed({
      storePath,
      authorizationId: v2.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:35.000Z")
    });

    expect(result.applied).toBe(true);
    if (!result.applied) {
      throw new Error("confirmed transition unexpectedly rejected");
    }
    expect(result.record.state).toBe("confirmed");
    expect(result.record.terminal).toEqual({
      sequence: 3,
      occurredAt: "2026-07-07T10:18:35.000Z",
      state: "confirmed",
      settlementEvidenceDigest: SETTLEMENT_DIGEST
    });
    expect(result.record.prepared.paymentRequirementDigest).toBe(v2.paymentRequirementDigest); // prepared evidence intact
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json", "0003.json"]);
  });

  test("prepared → failed: applied; terminal failed with stable stage/code", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);

    const result = await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "prepare",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    expect(result.applied).toBe(true);
    if (!result.applied) {
      throw new Error("failed transition unexpectedly rejected");
    }
    expect(result.record.state).toBe("failed");
    expect(result.record.terminal).toMatchObject({ state: "failed", failureStage: "prepare", failureCode: FAILURE_CODE });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("submitted → failed: applied; authorization stays non-reusable", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const result = await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "submit",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:40.000Z")
    });
    expect(result.applied).toBe(true);
    if (!result.applied) {
      throw new Error("failed transition unexpectedly rejected");
    }
    expect(result.record.state).toBe("failed");

    // even after terminal failure the v2 must not be prepared again
    const again = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: new Date("2026-07-07T10:19:00.000Z")
    });
    expect(again).toMatchObject({ prepared: false, reasonCode: X402_EXECUTION_ALREADY_CONSUMED, record: null });
  });

  test("prepared → confirmed: X402_EXECUTION_INVALID_TRANSITION; no new event", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);

    const result = await markX402ExecutionConfirmed({
      storePath,
      authorizationId: v2.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(result).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_INVALID_TRANSITION, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
  });

  test("confirmed → failed: X402_EXECUTION_INVALID_TRANSITION; no new event", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    await markX402ExecutionConfirmed({
      storePath,
      authorizationId: v2.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:35.000Z")
    });

    const result = await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "settle",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:40.000Z")
    });
    expect(result).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_INVALID_TRANSITION, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json", "0003.json"]);
  });

  test("failed → submitted: X402_EXECUTION_INVALID_TRANSITION; history unchanged", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "prepare",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const result = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest),
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:40.000Z")
    });
    expect(result).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_INVALID_TRANSITION, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("terminal → anything: rejected for confirmed and failed lifecycles", async () => {
    // failed lifecycle
    const failedStore = makeTempStorePath();
    const { v2: v2Failed } = await prepareOnRealChain(failedStore);
    await markX402ExecutionFailed({
      storePath: failedStore,
      authorizationId: v2Failed.authorizationId,
      failureStage: "submit",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    const failedConfirmed = await markX402ExecutionConfirmed({
      storePath: failedStore,
      authorizationId: v2Failed.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:40.000Z")
    });
    expect(failedConfirmed.reasonCode).toBe(X402_EXECUTION_INVALID_TRANSITION);
    expect(eventFiles(failedStore, v2Failed.authorizationId)).toEqual(["0001.json", "0002.json"]);

    // confirmed lifecycle
    const confirmedStore = makeTempStorePath();
    const { v2: v2Confirmed, record } = await prepareOnRealChain(confirmedStore);
    await markX402ExecutionSubmitted({
      storePath: confirmedStore,
      authorizationId: v2Confirmed.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    await markX402ExecutionConfirmed({
      storePath: confirmedStore,
      authorizationId: v2Confirmed.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:35.000Z")
    });
    const confirmedSubmitted = await markX402ExecutionSubmitted({
      storePath: confirmedStore,
      authorizationId: v2Confirmed.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:40.000Z")
    });
    expect(confirmedSubmitted.reasonCode).toBe(X402_EXECUTION_INVALID_TRANSITION);
    expect(eventFiles(confirmedStore, v2Confirmed.authorizationId)).toEqual(["0001.json", "0002.json", "0003.json"]);
  });

  test("submitted with the wrong nonce → X402_EXECUTION_INVALID_TRANSITION", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);

    const result = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: `0x${"f".repeat(64)}`,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(result).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_INVALID_TRANSITION, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
  });

  test("submitted with a malformed digest → X402_EXECUTION_INVALID_TRANSITION", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);

    const result = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: "not-a-digest",
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(result).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_INVALID_TRANSITION, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
  });

  test("transition on a missing authorization → X402_EXECUTION_NOT_FOUND", async () => {
    const storePath = makeTempStorePath();
    const missingAuth = `auth_${"e".repeat(64)}`;

    const submitted = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: missingAuth,
      nonce: `0x${"f".repeat(64)}`,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    const confirmed = await markX402ExecutionConfirmed({
      storePath,
      authorizationId: missingAuth,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    const failed = await markX402ExecutionFailed({
      storePath,
      authorizationId: missingAuth,
      failureStage: "submit",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(submitted.reasonCode).toBe(X402_EXECUTION_NOT_FOUND);
    expect(confirmed.reasonCode).toBe(X402_EXECUTION_NOT_FOUND);
    expect(failed.reasonCode).toBe(X402_EXECUTION_NOT_FOUND);
  });
});

describe("transition retry and conflict", () => {
  test("retry of the exact same submitted transition → X402_EXECUTION_TRANSITION_REPLAYED; no new event", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const retry = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:45.000Z")
    });
    expect(retry).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_TRANSITION_REPLAYED, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("competing submitted with a different digest → X402_EXECUTION_STATE_CONFLICT; no new event", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const conflict = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: `sha256:${"9".repeat(64)}`,
      occurredAt: new Date("2026-07-07T10:18:45.000Z")
    });
    expect(conflict).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_STATE_CONFLICT, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });

  test("retry of the exact same failed transition → X402_EXECUTION_TRANSITION_REPLAYED", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "submit",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const retry = await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "submit",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:45.000Z")
    });
    expect(retry).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_TRANSITION_REPLAYED, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json"]);
  });
});

describe("concurrent terminal", () => {
  test("from submitted, Promise.all([confirmed, failed]) → exactly one next event; loser gets conflict; history valid", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const [confirmed, failed] = await Promise.all([
      markX402ExecutionConfirmed({
        storePath,
        authorizationId: v2.authorizationId,
        settlementEvidenceDigest: SETTLEMENT_DIGEST,
        occurredAt: new Date("2026-07-07T10:18:35.000Z")
      }),
      markX402ExecutionFailed({
        storePath,
        authorizationId: v2.authorizationId,
        failureStage: "submit",
        failureCode: FAILURE_CODE,
        occurredAt: new Date("2026-07-07T10:18:35.000Z")
      })
    ]);

    const applied = [confirmed, failed].filter((result) => result.applied === true);
    const rejected = [confirmed, failed].filter((result) => result.applied === false);
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasonCode).toBe(X402_EXECUTION_STATE_CONFLICT);

    // exactly one next event (0003), no compensating 0004
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json", "0002.json", "0003.json"]);

    // history reconstructs to the winner's terminal state
    const recordAfter = await readX402ExecutionRecord(storePath, v2.authorizationId);
    expect(recordAfter?.state).toBe("confirmed");
    expect(recordAfter?.terminal).toMatchObject({ state: "confirmed", settlementEvidenceDigest: SETTLEMENT_DIGEST });
    expect(recordAfter?.prepared.nonce).toBe(record.nonce);
  });
});

describe("corruption fails closed", () => {
  test("invalid JSON event → reads throw; transitions return X402_EXECUTION_STORE_CORRUPT; no new event", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    writeFileSync(join(storePath, "authorizations", v2.authorizationId, "0001.json"), "this-is-not-json", "utf8");

    await expect(readX402ExecutionRecord(storePath, v2.authorizationId)).rejects.toThrow(X402ExecutionStoreError);
    const submitted = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: `0x${"f".repeat(64)}`,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(submitted).toMatchObject({ applied: false, reasonCode: X402_EXECUTION_STORE_CORRUPT, record: null });
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]); // no new event written
  });

  test("invalid state value → X402_EXECUTION_STORE_CORRUPT", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const event = readEvent(storePath, v2.authorizationId, 1);
    event.state = "banana";
    writeFileSync(
      join(storePath, "authorizations", v2.authorizationId, "0001.json"),
      `${JSON.stringify(event)}\n`,
      "utf8"
    );

    await expect(readX402ExecutionRecord(storePath, v2.authorizationId)).rejects.toThrow(X402ExecutionStoreError);
    const failed = await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "prepare",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(failed.reasonCode).toBe(X402_EXECUTION_STORE_CORRUPT);
  });

  test("sequence gap (0001 + 0003 without 0002) → X402_EXECUTION_STORE_CORRUPT", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const submittedEvent = {
      eventType: "x402_execution_state",
      version: "v1",
      sequence: 3,
      state: "submitted",
      authorizationId: v2.authorizationId,
      occurredAt: "2026-07-07T10:18:30.000Z",
      nonce: deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest),
      signerPayloadDigest: SUBMITTED_DIGEST
    };
    writeFileSync(
      join(storePath, "authorizations", v2.authorizationId, "0003.json"),
      `${JSON.stringify(submittedEvent)}\n`,
      "utf8"
    );

    await expect(readX402ExecutionRecord(storePath, v2.authorizationId)).rejects.toThrow(X402ExecutionStoreError);
    const confirmed = await markX402ExecutionConfirmed({
      storePath,
      authorizationId: v2.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:35.000Z")
    });
    expect(confirmed.reasonCode).toBe(X402_EXECUTION_STORE_CORRUPT);
  });

  test("wrong authorizationId inside an event → X402_EXECUTION_STORE_CORRUPT", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const event = readEvent(storePath, v2.authorizationId, 1);
    event.authorizationId = `auth_${"f".repeat(64)}`;
    writeFileSync(
      join(storePath, "authorizations", v2.authorizationId, "0001.json"),
      `${JSON.stringify(event)}\n`,
      "utf8"
    );

    await expect(readX402ExecutionRecord(storePath, v2.authorizationId)).rejects.toThrow(X402ExecutionStoreError);
    const submitted = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: `0x${"f".repeat(64)}`,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(submitted.reasonCode).toBe(X402_EXECUTION_STORE_CORRUPT);
  });

  test("invalid nonce inside the prepared event → X402_EXECUTION_STORE_CORRUPT", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const event = readEvent(storePath, v2.authorizationId, 1);
    event.nonce = "0xnot-a-nonce";
    writeFileSync(
      join(storePath, "authorizations", v2.authorizationId, "0001.json"),
      `${JSON.stringify(event)}\n`,
      "utf8"
    );

    await expect(readX402ExecutionRecord(storePath, v2.authorizationId)).rejects.toThrow(X402ExecutionStoreError);
  });

  test("unexpected file in the authorization directory → X402_EXECUTION_STORE_CORRUPT (never silently skipped)", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    writeFileSync(join(storePath, "authorizations", v2.authorizationId, "readme.txt"), "hi", "utf8");

    await expect(readX402ExecutionRecord(storePath, v2.authorizationId)).rejects.toThrow(X402ExecutionStoreError);
    const failed = await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "prepare",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(failed.reasonCode).toBe(X402_EXECUTION_STORE_CORRUPT);
  });

  test("no automatic repair: corrupt history stays byte-identical after a failed transition", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const corruptPath = join(storePath, "authorizations", v2.authorizationId, "0001.json");
    const corruptContent = `{"eventType":"x402_execution_state","version":"v1","sequence":1,"state":"prepared"`; // truncated JSON
    writeFileSync(corruptPath, corruptContent, "utf8");
    const before = readFileSync(corruptPath);

    const submitted = await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: `0x${"f".repeat(64)}`,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    expect(submitted.reasonCode).toBe(X402_EXECUTION_STORE_CORRUPT);
    expect(readFileSync(corruptPath)).toEqual(before); // untouched
    expect(eventFiles(storePath, v2.authorizationId)).toEqual(["0001.json"]);
  });
});

describe("secret-free store", () => {
  test("serialized execution store never contains keys/signatures/payloads/tx hashes/Gateway ids", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    await markX402ExecutionConfirmed({
      storePath,
      authorizationId: v2.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:35.000Z")
    });

    const serialized = serializeStore(storePath);
    expect(serialized).not.toMatch(
      /privateKey|mnemonic|seedPhrase|signature|signedPayload|PaymentPayload|transactionHash|txHash|GatewayTransferId|gatewayTransferId|settlementStatus|rpcUrl|broadcast/i
    );
  });

  test("submitted event stores only signerPayloadDigest, never the payload or signature", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });

    const submitted = readEvent(storePath, v2.authorizationId, 2);
    expect(Object.keys(submitted).sort()).toEqual([
      "authorizationId",
      "eventType",
      "nonce",
      "occurredAt",
      "sequence",
      "signerPayloadDigest",
      "state",
      "version"
    ]);
    expect(submitted.signerPayloadDigest).toBe(SUBMITTED_DIGEST);
    expect(JSON.stringify(submitted)).not.toMatch(
      /"signature"|"authorization"|"payload"|signedPayload|validBefore|validAfter/i
    );
  });

  test("confirmed event stores only settlementEvidenceDigest, no fake settlement fields", async () => {
    const storePath = makeTempStorePath();
    const { v2, record } = await prepareOnRealChain(storePath);
    await markX402ExecutionSubmitted({
      storePath,
      authorizationId: v2.authorizationId,
      nonce: record.nonce,
      signerPayloadDigest: SUBMITTED_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:30.000Z")
    });
    await markX402ExecutionConfirmed({
      storePath,
      authorizationId: v2.authorizationId,
      settlementEvidenceDigest: SETTLEMENT_DIGEST,
      occurredAt: new Date("2026-07-07T10:18:35.000Z")
    });

    const confirmed = readEvent(storePath, v2.authorizationId, 3);
    expect(Object.keys(confirmed).sort()).toEqual([
      "authorizationId",
      "eventType",
      "occurredAt",
      "sequence",
      "settlementEvidenceDigest",
      "state",
      "version"
    ]);
    expect(confirmed.settlementEvidenceDigest).toBe(SETTLEMENT_DIGEST);
    expect(JSON.stringify(confirmed)).not.toMatch(
      /transactionHash|txHash|transferId|status|amount|payer|network/i
    );
  });
});

describe("store isolation", () => {
  test("I3 operations do not modify audit log, observation log, policy file, or canonical scenarios", async () => {
    const auditPath = makeTempAuditPath();
    process.env.AGENTPAY_AUDIT_LOG_PATH = auditPath;
    process.env.AGENTPAY_OBSERVATION_LOG_PATH = join(dirname(auditPath), "evaluation-observations.jsonl");
    const policyBytes = readFileSync(join(root, "data", "policies.default.json"));
    const scenarioBytes = readFileSync(join(root, "examples", "scenario-allow-api.json"));

    const { v1, replayEvidence } = await evaluateCanonicalAllow(auditPath);
    const auditBefore = readFileSync(auditPath);
    const observationPath = join(dirname(auditPath), "evaluation-observations.jsonl");
    const observationBefore = readFileSync(observationPath);

    const storePath = makeTempStorePath();
    const gateResult = gateResultForV1(v1, replayEvidence);
    const v2 = expectAllowed(gateResult);
    const prepared = await prepareX402ExecutionAttempt({
      gateResult: allowedGateResult(v2),
      storePath,
      now: DEFAULT_NOW
    });
    expect(prepared.prepared).toBe(true);
    await markX402ExecutionFailed({
      storePath,
      authorizationId: v2.authorizationId,
      failureStage: "submit",
      failureCode: FAILURE_CODE,
      occurredAt: new Date("2026-07-07T10:18:40.000Z")
    });

    expect(readFileSync(auditPath)).toEqual(auditBefore);
    expect(readFileSync(observationPath)).toEqual(observationBefore);
    expect(readFileSync(join(root, "data", "policies.default.json"))).toEqual(policyBytes);
    expect(readFileSync(join(root, "examples", "scenario-allow-api.json"))).toEqual(scenarioBytes);
    // the default repository runtime location is never created by tests
    expect(existsSync(join(root, "data", "execution-store"))).toBe(false);
  });
});

describe("read API", () => {
  test("missing authorization → null; malformed authorizationId → null (path traversal guard)", async () => {
    const storePath = makeTempStorePath();
    const missing = await readX402ExecutionRecord(storePath, `auth_${"e".repeat(64)}`);
    expect(missing).toBeNull();
    expect(await readX402ExecutionRecord(storePath, "not-an-auth-id")).toBeNull();
    expect(await readX402ExecutionRecord(storePath, "../../../etc/passwd")).toBeNull();
    expect(await readX402ExecutionRecord(storePath, `auth_${"A".repeat(64)}`)).toBeNull(); // uppercase hex rejected
  });

  test("reads never mutate the store (byte-identical)", async () => {
    const storePath = makeTempStorePath();
    const { v2 } = await prepareOnRealChain(storePath);
    const before = serializeStore(storePath);

    await readX402ExecutionRecord(storePath, v2.authorizationId);
    await readX402ExecutionRecord(storePath, `auth_${"e".repeat(64)}`);
    await readX402ExecutionRecord(storePath, "garbage");

    expect(serializeStore(storePath)).toBe(before);
  });
});
