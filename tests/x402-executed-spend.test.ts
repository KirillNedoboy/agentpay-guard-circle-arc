/**
 * x402-executed-spend.test.ts
 *
 * I5 / BLOCKER 3 — read-only executed-spend reconciliation tests. Real I3
 * execution records (prepareX402ExecutionAttempt through the REAL I2 gate) +
 * real durable SettlementEvidence appends + the REAL transition primitives;
 * the summary must bucket each authorization exactly once and the BigInt
 * decimal totals must be exact. No fakes for either store, no mocks, no
 * signer, no Gateway, no network, no funds.
 *
 * Conventions (matching the repo suite): temp store paths ONLY (mkdtempSync —
 * never data/execution-store/ or data/settlement-evidence/); deterministic
 * TEST-ONLY addresses; explicit fixed timestamps — no sleeps, no
 * machine-clock dependence. `data/policies.default.json` is READ (policy
 * attribution) and never written.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import type { ReplayEvidence } from "@/domain/audit/replay-evidence";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import {
  validateX402PaymentRequirement,
  type X402PaymentRequirement
} from "@/domain/x402/payment-requirement";
import { buildPaymentRequirementEvidence } from "@/domain/x402/payment-requirement-evidence";
import {
  evaluateX402ExecutionGate,
  type X402RecipientBinding
} from "@/domain/x402/execution-security-gate";
import type { X402ExecutionAuthorizationV2 } from "@/domain/x402/execution-authorization-v2";
import {
  deriveX402ExecutionNonce,
  markX402ExecutionConfirmed,
  markX402ExecutionFailed,
  markX402ExecutionRemoteOutcomeUnknown,
  markX402ExecutionSubmitted,
  prepareX402ExecutionAttempt,
  X402ExecutionStoreError,
  type X402PreparedExecutionRecord
} from "@/domain/x402/execution-store";
import { X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN } from "@/domain/x402/gateway-reason-codes";
import {
  buildSettlementEvidence,
  fingerprintSettlementEvidence,
  type SettlementEvidence
} from "@/domain/x402/settlement-evidence";
import {
  appendSettlementEvidence,
  X402SettlementEvidenceStoreError
} from "@/domain/x402/settlement-evidence-store";
import {
  summarizeX402ExecutedSpend,
  type X402ExecutedSpendBucket,
  type X402ExecutedSpendSummary
} from "@/domain/x402/executed-spend";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

// Deterministic TEST-ONLY values (same constants as the execution-store suite).
const PARENT_AUTH_ID = `auth_${"a".repeat(64)}`;
const ARC_TESTNET_NETWORK = "eip155:5042002";
const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const PAYTO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const SUBMIT_PAYLOAD_DIGEST = `sha256:${"c".repeat(64)}`;
const SIGNING_REQUEST_DIGEST = `sha256:${"e".repeat(64)}`;
const CONFIRMED_CLAIM_DIGEST = `sha256:${"7".repeat(64)}`;
const VALID_AFTER = "1751883510";
const VALID_BEFORE = "1752488410";
const BATCH_TX_HASH = `0x${"f".repeat(64)}`;
const GATE_NOW = new Date("2026-07-07T10:18:00.000Z");
const TRANSITION_AT = new Date("2026-07-07T10:18:30.000Z");

// ---------------------------------------------------------------------------
// Temp plumbing.
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

type TempPair = { execStore: string; evStore: string };

function makeTempPair(): TempPair {
  const dir = mkdtempSync(join(tmpdir(), "agentpay-x402-executed-spend-"));
  tempDirs.push(dir);
  return { execStore: join(dir, "execution-store"), evStore: join(dir, "settlement-evidence") };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Byte-exact snapshot of a store: relative path + full content of every file. */
function serializeStore(dir: string): string {
  return walkFiles(dir)
    .map((path) => `${relative(dir, path)}\n${readFileSync(path, "utf8")}`)
    .join("---\n");
}

// ---------------------------------------------------------------------------
// Real-chain fixtures: v1 → real I2 gate → real I3 prepare → real transitions
// + real evidence appends.
// ---------------------------------------------------------------------------

function makeReplayEvidence(): ReplayEvidence {
  return {
    replayed: true,
    replayMismatch: false,
    policyChanged: false,
    storedIntentFingerprint: `sha256:${"b".repeat(64)}`,
    currentIntentFingerprint: `sha256:${"b".repeat(64)}`,
    storedPolicyVersion: policy.policyVersion,
    currentPolicyVersion: policy.policyVersion,
    storedPolicyFingerprint: fingerprintPolicy(policy),
    currentPolicyFingerprint: fingerprintPolicy(policy)
  };
}

function makeBinding(): X402RecipientBinding {
  return { recipient: "trusted-x402-api.demo", payTo: PAYTO };
}

function uuidFor(tag: number): string {
  return `0f5c7f2a-3b1e-4c8d-9a6f-${tag.toString(16).padStart(12, "0")}`;
}

type Fixture = {
  v2: X402ExecutionAuthorizationV2;
  prepared: X402PreparedExecutionRecord;
  nonce: string;
};

type ScenarioSpec = {
  auditId: string;
  agentId: string;
  amountAtomic: string;
  maxAmountUSDC: string;
};

/** v1 → REAL I2 gate PASS → REAL I3 prepare on the given execution store. */
async function prepareFixture(execStore: string, spec: ScenarioSpec): Promise<Fixture> {
  const requirement: X402PaymentRequirement = validateX402PaymentRequirement({
    scheme: "exact",
    network: ARC_TESTNET_NETWORK,
    amount: spec.amountAtomic,
    asset: ARC_USDC_ASSET,
    payTo: PAYTO,
    maxTimeoutSeconds: 604900,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: GATEWAY_WALLET
    }
  });
  const requirementEvidence = buildPaymentRequirementEvidence(requirement);
  const v1: ExecutionAuthorization = {
    authorizationType: "execution_authorization",
    version: "v1",
    authorizationId: PARENT_AUTH_ID,
    scope: "single_intent",
    intentId: "intent_executed_spend",
    idempotencyKey: `idem-${spec.auditId}`,
    auditId: spec.auditId,
    agentId: spec.agentId,
    recipient: "trusted-x402-api.demo",
    asset: "USDC",
    maxAmountUSDC: spec.maxAmountUSDC,
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
    fundsMoved: false
  };
  const gateResult = evaluateX402ExecutionGate({
    authorization: v1,
    replayEvidence: makeReplayEvidence(),
    paymentRequirement: requirement,
    paymentRequirementEvidence: requirementEvidence,
    recipientBinding: makeBinding(),
    policy,
    now: GATE_NOW
  });
  if (!gateResult.eligibleForSignerRequest || gateResult.authorization === null) {
    throw new Error(`I2 gate unexpectedly rejected: ${gateResult.reasonCodes.join(",")}`);
  }
  const prepared = await prepareX402ExecutionAttempt({
    gateResult,
    storePath: execStore,
    now: GATE_NOW
  });
  if (!prepared.prepared) {
    throw new Error(`I3 prepare unexpectedly rejected: ${prepared.reasonCode}`);
  }
  const v2 = gateResult.authorization;
  return {
    v2,
    prepared: prepared.record,
    nonce: deriveX402ExecutionNonce(v2.authorizationId, v2.paymentRequirementDigest)
  };
}

function evidenceBase(f: Fixture) {
  return {
    authorizationId: f.v2.authorizationId,
    parentAuthorizationId: f.v2.parentAuthorizationId,
    auditId: f.v2.auditId,
    agentId: f.v2.agentId,
    paymentRequirementDigest: f.v2.paymentRequirementDigest,
    signerPayloadDigest: SUBMIT_PAYLOAD_DIGEST,
    network: f.v2.x402.network,
    assetAddress: f.v2.x402.assetAddress,
    payerAddress: PAYER,
    payTo: f.v2.x402.payTo,
    amountAtomic: f.v2.x402.amountAtomic,
    nonce: f.nonce
  };
}

async function toSubmitted(execStore: string, f: Fixture): Promise<void> {
  const result = await markX402ExecutionSubmitted({
    storePath: execStore,
    authorizationId: f.v2.authorizationId,
    nonce: f.nonce,
    signerPayloadDigest: SUBMIT_PAYLOAD_DIGEST,
    payerAddress: PAYER,
    signingRequestDigest: SIGNING_REQUEST_DIGEST,
    validAfter: VALID_AFTER,
    validBefore: VALID_BEFORE,
    occurredAt: TRANSITION_AT
  });
  expect(result.applied).toBe(true);
}

async function toRemoteUnknown(execStore: string, f: Fixture): Promise<void> {
  const result = await markX402ExecutionRemoteOutcomeUnknown({
    storePath: execStore,
    authorizationId: f.v2.authorizationId,
    nonce: f.nonce,
    reasonCode: X402_GATEWAY_REMOTE_OUTCOME_UNKNOWN,
    gatewayTransferId: null,
    occurredAt: new Date("2026-07-07T10:18:35.000Z")
  });
  expect(result.applied).toBe(true);
}

async function toI3Confirmed(execStore: string, f: Fixture, digest: string): Promise<void> {
  const result = await markX402ExecutionConfirmed({
    storePath: execStore,
    authorizationId: f.v2.authorizationId,
    settlementEvidenceDigest: digest,
    occurredAt: new Date("2026-07-07T10:18:40.000Z")
  });
  expect(result.applied).toBe(true);
}

async function toI3Failed(execStore: string, f: Fixture): Promise<void> {
  const result = await markX402ExecutionFailed({
    storePath: execStore,
    authorizationId: f.v2.authorizationId,
    failureStage: "submit",
    failureCode: "GATEWAY_REJECTED",
    occurredAt: TRANSITION_AT
  });
  expect(result.applied).toBe(true);
}

/** Durably append one REAL evidence snapshot (APPENDED asserted). */
async function appendSnapshot(evStore: string, snapshot: SettlementEvidence): Promise<string> {
  const result = await appendSettlementEvidence({ storePath: evStore, evidence: snapshot });
  expect(result.appended).toBe(true);
  return fingerprintSettlementEvidence(snapshot);
}

function pendingSnapshot(f: Fixture, transferTag: number, when: string): SettlementEvidence {
  return buildSettlementEvidence({
    ...evidenceBase(f),
    source: "transfer_snapshot",
    outcome: "accepted_pending",
    gatewayTransferId: uuidFor(transferTag),
    gatewayTransferStatus: "received",
    gatewaySuccess: true,
    gatewayErrorReason: null,
    batchTxHash: null,
    recordedAt: when
  });
}

function batchedSnapshot(f: Fixture, transferTag: number, when: string): SettlementEvidence {
  return buildSettlementEvidence({
    ...evidenceBase(f),
    source: "transfer_snapshot",
    outcome: "accepted_pending",
    gatewayTransferId: uuidFor(transferTag),
    gatewayTransferStatus: "batched",
    gatewaySuccess: true,
    gatewayErrorReason: null,
    batchTxHash: BATCH_TX_HASH,
    recordedAt: when
  });
}

type ScenarioKind =
  | "confirmed"
  | "completed"
  | "i3-failed"
  | "evidence-failed"
  | "unknown-i3"
  | "submitted-no-evidence"
  | "prepared"
  | "accepted-pending"
  | "lifecycle-confirmed"
  | "i3-confirmed-no-evidence";

type DrivenFixture = Fixture & { latestEvidenceDigest: string | null };

/**
 * Drive one authorization to a target scenario end-to-end (real stores, real
 * modules). Returns the fixture plus the digest of its latest evidence.
 */
async function driveScenario(
  execStore: string,
  evStore: string,
  spec: ScenarioSpec,
  kind: ScenarioKind,
  tag: number
): Promise<DrivenFixture> {
  const f = await prepareFixture(execStore, spec);
  switch (kind) {
    case "prepared":
      return { ...f, latestEvidenceDigest: null };
    case "i3-failed": {
      await toI3Failed(execStore, f);
      return { ...f, latestEvidenceDigest: null };
    }
    case "i3-confirmed-no-evidence": {
      await toSubmitted(execStore, f);
      await toI3Confirmed(execStore, f, CONFIRMED_CLAIM_DIGEST);
      return { ...f, latestEvidenceDigest: null };
    }
    case "submitted-no-evidence": {
      await toSubmitted(execStore, f);
      return { ...f, latestEvidenceDigest: null };
    }
    case "unknown-i3": {
      await toSubmitted(execStore, f);
      await toRemoteUnknown(execStore, f);
      return { ...f, latestEvidenceDigest: null };
    }
    case "accepted-pending": {
      await toSubmitted(execStore, f);
      await appendSnapshot(evStore, pendingSnapshot(f, tag * 10 + 1, "2026-08-17T10:00:00.000Z"));
      const digest = await appendSnapshot(evStore, batchedSnapshot(f, tag * 10 + 2, "2026-08-17T10:00:30.000Z"));
      return { ...f, latestEvidenceDigest: digest };
    }
    case "confirmed": {
      await toSubmitted(execStore, f);
      await appendSnapshot(evStore, pendingSnapshot(f, tag, "2026-08-17T10:00:00.000Z"));
      const confirmed = buildSettlementEvidence({
        ...evidenceBase(f),
        source: "transfer_snapshot",
        outcome: "confirmed",
        gatewayTransferId: uuidFor(tag),
        gatewayTransferStatus: "confirmed",
        gatewaySuccess: true,
        gatewayErrorReason: null,
        batchTxHash: BATCH_TX_HASH,
        recordedAt: "2026-08-17T10:01:00.000Z"
      });
      const digest = await appendSnapshot(evStore, confirmed);
      await toI3Confirmed(execStore, f, digest);
      return { ...f, latestEvidenceDigest: digest };
    }
    case "completed": {
      await toSubmitted(execStore, f);
      await appendSnapshot(evStore, pendingSnapshot(f, tag, "2026-08-17T10:00:00.000Z"));
      const completed = buildSettlementEvidence({
        ...evidenceBase(f),
        source: "transfer_snapshot",
        outcome: "completed",
        gatewayTransferId: uuidFor(tag),
        gatewayTransferStatus: "completed",
        gatewaySuccess: true,
        gatewayErrorReason: null,
        batchTxHash: BATCH_TX_HASH,
        recordedAt: "2026-08-17T10:02:00.000Z"
      });
      const digest = await appendSnapshot(evStore, completed);
      return { ...f, latestEvidenceDigest: digest };
    }
    case "evidence-failed": {
      await toSubmitted(execStore, f);
      const failed = buildSettlementEvidence({
        ...evidenceBase(f),
        source: "transfer_snapshot",
        outcome: "failed",
        gatewayTransferId: uuidFor(tag),
        gatewayTransferStatus: "failed",
        gatewaySuccess: false,
        gatewayErrorReason: "insufficient_balance",
        batchTxHash: null,
        recordedAt: "2026-08-17T10:01:00.000Z"
      });
      const digest = await appendSnapshot(evStore, failed);
      // I3 deliberately lags behind in the remote_outcome_unknown state — the
      // durable official rejection must still win (rule 2 over rule 4).
      await toRemoteUnknown(execStore, f);
      return { ...f, latestEvidenceDigest: digest };
    }
    case "lifecycle-confirmed": {
      await toSubmitted(execStore, f);
      await appendSnapshot(evStore, pendingSnapshot(f, tag * 10 + 1, "2026-08-17T10:00:00.000Z"));
      await appendSnapshot(evStore, batchedSnapshot(f, tag * 10 + 2, "2026-08-17T10:00:30.000Z"));
      const confirmed = buildSettlementEvidence({
        ...evidenceBase(f),
        source: "transfer_snapshot",
        outcome: "confirmed",
        gatewayTransferId: uuidFor(tag * 10 + 2),
        gatewayTransferStatus: "confirmed",
        gatewaySuccess: true,
        gatewayErrorReason: null,
        batchTxHash: BATCH_TX_HASH,
        recordedAt: "2026-08-17T10:01:00.000Z"
      });
      const digest = await appendSnapshot(evStore, confirmed);
      await toI3Confirmed(execStore, f, digest);
      return { ...f, latestEvidenceDigest: digest };
    }
  }
}

function bucketForKind(kind: ScenarioKind): X402ExecutedSpendBucket {
  switch (kind) {
    case "confirmed":
    case "completed":
    case "lifecycle-confirmed":
      return "settled";
    case "i3-failed":
    case "evidence-failed":
      return "failed";
    case "unknown-i3":
    case "submitted-no-evidence":
    case "accepted-pending":
    case "i3-confirmed-no-evidence":
      return "unknown";
    case "prepared":
      return "pending";
  }
}

function summarize(
  { execStore, evStore }: TempPair,
  filter?: { authorizationId?: string; agentId?: string }
): Promise<X402ExecutedSpendSummary> {
  return summarizeX402ExecutedSpend({
    storePath: execStore,
    settlementEvidenceStorePath: evStore,
    ...(filter ? { filter } : {})
  });
}

function findRecord(summary: X402ExecutedSpendSummary, authorizationId: string) {
  const record = summary.records.find((r) => r.authorizationId === authorizationId);
  if (record === undefined) {
    throw new Error(`record for ${authorizationId} missing from summary`);
  }
  return record;
}

// ---------------------------------------------------------------------------

describe("classification — each target state buckets exactly once", () => {
  test("I3 confirmed + evidence confirmed → settled; evidence fields carried on the record", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_confirmed", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" },
      "confirmed", 1);

    const summary = await summarize(pair);
    expect(summary.authorizationCount).toBe(1);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("settled");
    expect(record.executionState).toBe("confirmed");
    expect(record.gatewayTransferStatus).toBe("confirmed");
    expect(record.evidenceDigest).toBe(f.latestEvidenceDigest);
    expect(summary).toMatchObject({
      authorizedAmountAtomic: "80000",
      settledAmountAtomic: "80000",
      failedAmountAtomic: "0",
      unknownAmountAtomic: "0",
      pendingAmountAtomic: "0"
    });
  });

  test("evidence completed while I3 still submitted (crash window) → settled", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_completed", agentId: "agent_two", amountAtomic: "40000", maxAmountUSDC: "0.04" },
      "completed", 2);

    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("settled");
    expect(record.executionState).toBe("submitted");
    expect(record.gatewayTransferStatus).toBe("completed");
    expect(summary.settledAmountAtomic).toBe("40000");
  });

  test("I3 failed with no evidence → failed", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_i3failed", agentId: "agent_one", amountAtomic: "20000", maxAmountUSDC: "0.02" },
      "i3-failed", 3);

    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("failed");
    expect(record.executionState).toBe("failed");
    expect(record.evidenceDigest).toBeNull();
    expect(record.gatewayTransferStatus).toBeNull();
    expect(summary.failedAmountAtomic).toBe("20000");
  });

  test("evidence failed beats a non-terminal I3 state → failed (rule 2 over rule 4)", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_evfailed", agentId: "agent_two", amountAtomic: "10000", maxAmountUSDC: "0.01" },
      "evidence-failed", 4);

    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("failed");
    // I3 says remote_outcome_unknown — the durable official rejection wins:
    expect(record.executionState).toBe("remote_outcome_unknown");
    expect(record.gatewayTransferStatus).toBe("failed");
    expect(summary.failedAmountAtomic).toBe("10000");
    expect(summary.unknownAmountAtomic).toBe("0");
  });

  test("I3 remote_outcome_unknown with no evidence → unknown", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_unknown", agentId: "agent_two", amountAtomic: "16000", maxAmountUSDC: "0.016" },
      "unknown-i3", 5);

    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("unknown");
    expect(record.executionState).toBe("remote_outcome_unknown");
    expect(summary.unknownAmountAtomic).toBe("16000");
  });

  test("submitted with no evidence → unknown (conservative: not settled, not pending, not zero)", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_submitted", agentId: "agent_two", amountAtomic: "32000", maxAmountUSDC: "0.032" },
      "submitted-no-evidence", 6);

    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("unknown");
    expect(record.executionState).toBe("submitted");
    expect(summary.unknownAmountAtomic).toBe("32000");
    expect(summary.settledAmountAtomic).toBe("0");
    expect(summary.pendingAmountAtomic).toBe("0");
  });

  test("prepared → pending", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_prepared", agentId: "agent_two", amountAtomic: "64000", maxAmountUSDC: "0.064" },
      "prepared", 7);

    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("pending");
    expect(record.executionState).toBe("prepared");
    expect(summary.pendingAmountAtomic).toBe("64000");
  });

  test("latest evidence accepted_pending (received → batched) → unknown; record carries the LATEST snapshot", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_pending_evi", agentId: "agent_two", amountAtomic: "128000", maxAmountUSDC: "0.128" },
      "accepted-pending", 8);

    // two lifecycle snapshots on disk; the later one is "batched"
    expect(readdirSync(join(pair.evStore, "authorizations", f.v2.authorizationId))).toEqual([
      "0001.json",
      "0002.json"
    ]);
    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("unknown");
    expect(record.gatewayTransferStatus).toBe("batched");
    expect(record.evidenceDigest).toBe(f.latestEvidenceDigest);
    expect(summary.unknownAmountAtomic).toBe("128000");
    expect(summary.settledAmountAtomic).toBe("0");
  });

  test("I3 confirmed with NO durable evidence → unknown (inconsistency guard, never settled)", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_es_confirmed_noev", agentId: "agent_two", amountAtomic: "100000", maxAmountUSDC: "0.1" },
      "i3-confirmed-no-evidence", 9);

    const summary = await summarize(pair);
    const record = findRecord(summary, f.v2.authorizationId);
    expect(record.bucket).toBe("unknown");
    expect(record.executionState).toBe("confirmed");
    expect(record.evidenceDigest).toBeNull();
    expect(summary.settledAmountAtomic).toBe("0");
    expect(summary.unknownAmountAtomic).toBe("100000");
  });
});

describe("mixed set — exact BigInt aggregates + partition invariant", () => {
  test("9 authorizations across all buckets: sums exact, each counted once", async () => {
    const pair = makeTempPair();
    const specs: Array<[ScenarioKind, ScenarioSpec, number]> = [
      ["confirmed", { auditId: "audit_mix_a", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" }, 11],
      ["completed", { auditId: "audit_mix_b", agentId: "agent_one", amountAtomic: "40000", maxAmountUSDC: "0.04" }, 12],
      ["i3-failed", { auditId: "audit_mix_c", agentId: "agent_one", amountAtomic: "20000", maxAmountUSDC: "0.02" }, 13],
      ["evidence-failed", { auditId: "audit_mix_d", agentId: "agent_two", amountAtomic: "10000", maxAmountUSDC: "0.01" }, 14],
      ["unknown-i3", { auditId: "audit_mix_e", agentId: "agent_two", amountAtomic: "16000", maxAmountUSDC: "0.016" }, 15],
      ["submitted-no-evidence", { auditId: "audit_mix_f", agentId: "agent_two", amountAtomic: "32000", maxAmountUSDC: "0.032" }, 16],
      ["prepared", { auditId: "audit_mix_g", agentId: "agent_two", amountAtomic: "64000", maxAmountUSDC: "0.064" }, 17],
      ["accepted-pending", { auditId: "audit_mix_h", agentId: "agent_two", amountAtomic: "128000", maxAmountUSDC: "0.128" }, 18],
      ["lifecycle-confirmed", { auditId: "audit_mix_l", agentId: "agent_two", amountAtomic: "800000", maxAmountUSDC: "0.8" }, 19]
    ];
    const driven: Array<{ fixture: DrivenFixture; bucket: X402ExecutedSpendBucket; amount: string }> = [];
    for (const [kind, spec, tag] of specs) {
      const fixture = await driveScenario(pair.execStore, pair.evStore, spec, kind, tag);
      driven.push({ fixture, bucket: bucketForKind(kind), amount: spec.amountAtomic });
    }

    const summary = await summarize(pair);
    expect(summary.authorizationCount).toBe(9);
    expect(summary.authorizationCount).toBe(summary.records.length);

    // exact aggregates: authorized 1190000 = settled 920000 (80000 + 40000 +
    // 800000) + failed 30000 (20000 + 10000) + unknown 176000 (16000 + 32000
    // + 128000) + pending 64000 — nothing disappears, nothing doubles.
    expect(summary.authorizedAmountAtomic).toBe("1190000");
    expect(summary.settledAmountAtomic).toBe("920000");
    expect(summary.failedAmountAtomic).toBe("30000");
    expect(summary.unknownAmountAtomic).toBe("176000");
    expect(summary.pendingAmountAtomic).toBe("64000");
    const total =
      BigInt(summary.settledAmountAtomic) +
      BigInt(summary.failedAmountAtomic) +
      BigInt(summary.unknownAmountAtomic) +
      BigInt(summary.pendingAmountAtomic);
    expect(total).toBe(BigInt(summary.authorizedAmountAtomic));

    for (const { fixture, bucket, amount } of driven) {
      const record = findRecord(summary, fixture.v2.authorizationId);
      expect(record.bucket).toBe(bucket);
      expect(record.amountAtomic).toBe(amount);
    }

    // unknown is at-risk: NOT zero, NOT settled; failed is NOT settled
    expect(summary.unknownAmountAtomic).not.toBe("0");
    expect(summary.unknownAmountAtomic).not.toBe(summary.settledAmountAtomic);
    expect(summary.failedAmountAtomic).not.toBe(summary.settledAmountAtomic);
  });
});

describe("no double counting", () => {
  test("received → batched → confirmed lifecycle counts ONCE as settled (amount, not just bucket)", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_dbl", agentId: "agent_one", amountAtomic: "800000", maxAmountUSDC: "0.8" },
      "lifecycle-confirmed", 5);
    // three immutable snapshots on disk — one authorization, one bucket entry
    expect(readdirSync(join(pair.evStore, "authorizations", f.v2.authorizationId))).toEqual([
      "0001.json",
      "0002.json",
      "0003.json"
    ]);

    const summary = await summarize(pair);
    expect(summary.authorizationCount).toBe(1);
    expect(summary.authorizedAmountAtomic).toBe("800000");
    expect(summary.settledAmountAtomic).toBe("800000");
    expect(summary.failedAmountAtomic).toBe("0");
    expect(summary.unknownAmountAtomic).toBe("0");
    expect(summary.pendingAmountAtomic).toBe("0");
    // the record reflects the LATEST snapshot, not an earlier one
    const record = summary.records[0];
    expect(record.gatewayTransferStatus).toBe("confirmed");
    expect(record.evidenceDigest).toBe(f.latestEvidenceDigest);
  });
});

describe("filters", () => {
  test("by authorizationId narrows records AND totals", async () => {
    const pair = makeTempPair();
    const a = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_f_a", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" }, "confirmed", 21);
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_f_b", agentId: "agent_two", amountAtomic: "64000", maxAmountUSDC: "0.064" }, "prepared", 22);

    const filtered = await summarize(pair, { authorizationId: a.v2.authorizationId });
    expect(filtered.authorizationCount).toBe(1);
    expect(filtered.records.map((r) => r.authorizationId)).toEqual([a.v2.authorizationId]);
    expect(filtered.authorizedAmountAtomic).toBe("80000");
    expect(filtered.settledAmountAtomic).toBe("80000");
    expect(filtered.pendingAmountAtomic).toBe("0");
  });

  test("by agentId narrows records AND totals (subset sums)", async () => {
    const pair = makeTempPair();
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_g_a", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" }, "confirmed", 23);
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_g_b", agentId: "agent_one", amountAtomic: "40000", maxAmountUSDC: "0.04" }, "completed", 24);
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_g_c", agentId: "agent_one", amountAtomic: "20000", maxAmountUSDC: "0.02" }, "i3-failed", 25);
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_g_d", agentId: "agent_two", amountAtomic: "64000", maxAmountUSDC: "0.064" }, "prepared", 26);

    const filtered = await summarize(pair, { agentId: "agent_one" });
    expect(filtered.authorizationCount).toBe(3);
    expect(filtered.records.map((r) => r.agentId)).toEqual(["agent_one", "agent_one", "agent_one"]);
    expect(filtered.authorizedAmountAtomic).toBe("140000");
    expect(filtered.settledAmountAtomic).toBe("120000");
    expect(filtered.failedAmountAtomic).toBe("20000");
    expect(filtered.unknownAmountAtomic).toBe("0");
    expect(filtered.pendingAmountAtomic).toBe("0");
  });
});

describe("empty and missing stores", () => {
  test("missing store paths → count 0, every total \"0\"", async () => {
    const pair = makeTempPair(); // neither store directory exists yet
    expect(existsSync(pair.execStore)).toBe(false);
    const summary = await summarize(pair);
    expect(summary).toEqual({
      authorizationCount: 0,
      authorizedAmountAtomic: "0",
      settledAmountAtomic: "0",
      failedAmountAtomic: "0",
      unknownAmountAtomic: "0",
      pendingAmountAtomic: "0",
      records: []
    });
  });

  test("empty but existing store dirs → count 0, all totals \"0\"", async () => {
    const pair = makeTempPair();
    mkdirSync(pair.execStore, { recursive: true });
    mkdirSync(pair.evStore, { recursive: true });
    const summary = await summarize(pair);
    expect(summary.authorizationCount).toBe(0);
    expect(summary.authorizedAmountAtomic).toBe("0");
  });
});

describe("read-only proof", () => {
  test("summarize never writes: every file in both stores byte-identical before/after", async () => {
    const pair = makeTempPair();
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_ro_a", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" }, "confirmed", 31);
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_ro_b", agentId: "agent_two", amountAtomic: "64000", maxAmountUSDC: "0.064" }, "prepared", 32);

    const execFilesBefore = walkFiles(pair.execStore);
    const evFilesBefore = walkFiles(pair.evStore);
    const execBefore = serializeStore(pair.execStore);
    const evBefore = serializeStore(pair.evStore);

    const summary = await summarize(pair);
    expect(summary.authorizationCount).toBe(2);

    expect(walkFiles(pair.execStore)).toEqual(execFilesBefore);
    expect(walkFiles(pair.evStore)).toEqual(evFilesBefore);
    expect(serializeStore(pair.execStore)).toBe(execBefore);
    expect(serializeStore(pair.evStore)).toBe(evBefore);
  });
});

describe("corruption — fail closed with the owning module's typed error", () => {
  test("corrupt execution-store event → X402ExecutionStoreError (record never silently skipped)", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_cx_exec", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" }, "confirmed", 41);
    const file = join(pair.execStore, "authorizations", f.v2.authorizationId, "0001.json");
    writeFileSync(file, "{ broken!\n");

    await expect(summarize(pair)).rejects.toThrow(X402ExecutionStoreError);
    // fail closed WITHOUT repair: the broken bytes remain
    expect(readFileSync(file, "utf8")).toBe("{ broken!\n");
  });

  test("corrupt evidence snapshot → X402SettlementEvidenceStoreError", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_cx_evidence", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" }, "confirmed", 42);
    const file = join(pair.evStore, "authorizations", f.v2.authorizationId, "0002.json");
    writeFileSync(file, "not-json\n");

    await expect(summarize(pair)).rejects.toThrow(X402SettlementEvidenceStoreError);
    expect(readFileSync(file, "utf8")).toBe("not-json\n");
  });

  test("enumerated authorization directory with no durable record → X402ExecutionStoreError (never skipped)", async () => {
    const pair = makeTempPair();
    await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_cx_empty", agentId: "agent_one", amountAtomic: "80000", maxAmountUSDC: "0.08" }, "prepared", 43);
    // crash-window artifact: a valid-named directory that holds no events
    mkdirSync(join(pair.execStore, "authorizations", `auth_${"d".repeat(64)}`), { recursive: true });

    await expect(summarize(pair)).rejects.toThrow(X402ExecutionStoreError);
  });
});

describe("record surface", () => {
  test("summary/records expose exactly the frozen non-secret fields; identity from the durable prepared record", async () => {
    const pair = makeTempPair();
    const f = await driveScenario(pair.execStore, pair.evStore,
      { auditId: "audit_surface", agentId: "agent_surface", amountAtomic: "80000", maxAmountUSDC: "0.08" }, "confirmed", 51);
    const summary = await summarize(pair);
    const record = summary.records[0];

    expect(Object.keys(summary).sort()).toEqual([
      "authorizationCount",
      "authorizedAmountAtomic",
      "failedAmountAtomic",
      "pendingAmountAtomic",
      "records",
      "settledAmountAtomic",
      "unknownAmountAtomic"
    ]);
    expect(Object.keys(record).sort()).toEqual([
      "agentId",
      "amountAtomic",
      "assetAddress",
      "authorizationId",
      "bucket",
      "evidenceDigest",
      "executionState",
      "gatewayTransferStatus",
      "network"
    ]);
    // derived from the DURABLE prepared record only
    expect(record.agentId).toBe(f.prepared.agentId);
    expect(record.network).toBe(f.prepared.network);
    expect(record.assetAddress).toBe(f.prepared.assetAddress);
    expect(record.amountAtomic).toBe(f.prepared.amountAtomic);
    // policy attribution is NOT re-emitted here (stays in the I3 record)
    expect(JSON.stringify(summary)).not.toContain("policyVersion");
    // no secret-shaped material in the summary
    expect(JSON.stringify(summary)).not.toMatch(/[0-9a-fA-F]{130}/);
  });
});
