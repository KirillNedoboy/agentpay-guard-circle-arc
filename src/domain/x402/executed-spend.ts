/**
 * I5 / BLOCKER 3 — read-only executed-spend reconciliation
 * (ExecutedSpendSummary, pre-i5-security-review.md "Executed-Spend
 * Reconciliation").
 *
 * PURPOSE: answer "what did we ACTUALLY spend?" strictly from the two
 * durable stores — the I3 execution state store (what local execution
 * attempts exist and their states) and the I5 SettlementEvidence store
 * (what the official Gateway outcome was) — with ZERO writes and ZERO
 * network calls. This is reconciliation over persisted evidence, never a
 * live Gateway query.
 *
 * READ-ONLY: this module only calls the two stores' read APIs
 * (`listX402ExecutionAuthorizations`, `readX402ExecutionRecord`,
 * `latestSettlementEvidence`). It never creates, mutates, repairs, or
 * deletes anything in either store. A corrupt execution store or a corrupt
 * evidence history fails CLOSED with the owning module's typed error
 * (X402ExecutionStoreError / X402SettlementEvidenceStoreError) — a record is
 * NEVER silently skipped, because a skipped record would under-report spend.
 *
 * SEPARATION: policy spend controls (per-request / daily / velocity caps in
 * the I1/I2 path) are PROPOSED-INTENT accounting over canonical ALLOW audit
 * evidence. ExecutedSpendSummary is ACTUAL-EXECUTION accounting over the I3
 * + I5 durable stores. The two are kept distinct; this module never touches
 * policy/config/spend-control code and never re-reads or re-emits
 * `policyVersion` (the policy attribution lives in the I3 prepared record,
 * untouched).
 *
 * CLASSIFICATION — each enumerated authorization is classified exactly ONCE
 * from the LATEST canonical SettlementEvidence snapshot (multiple lifecycle
 * snapshots for one authorization are NEVER double counted), with
 * terminal-evidence precedence. Decision table (verbatim contract):
 *
 *   1. latest durable evidence outcome ∈ {confirmed, completed} → `settled`
 *      (money actually moved; this also covers the "evidence written, I3
 *      transition crashed" window);
 *   2. else latest durable evidence outcome === failed → `failed`;
 *   3. else I3 state === failed → `failed`;
 *   4. else I3 state === remote_outcome_unknown → `unknown`;
 *   5. else I3 state === submitted → `unknown` (conservative: a `submitted`
 *      record may sit inside a crash window where a settle attempt happened
 *      but no outcome was ever recorded — it must never be counted as
 *      settled or as zero);
 *   6. else (prepared) → `pending` (no remote attempt is possible before
 *      `submitted`).
 *
 * Documented store-inconsistency guard (below the table, conservative by
 * construction): I3 state `confirmed` with NO durable evidence (only
 * reachable if the confirmed transition stored a digest whose evidence
 * never landed or was externally removed) is classified `unknown` — never
 * `settled` (no durable official status proves the money moved) and never
 * `pending` (an attempt demonstrably happened).
 *
 * BUCKET SEMANTICS: `unknown` is AT-RISK and is NEVER zero and NEVER
 * settled; it may later become settled (or failed) once durable evidence
 * lands, at which point the next reconciliation re-derives the bucket from
 * the same stores. `pending` means no remote attempt was possible yet.
 *
 * ARITHMETIC: BigInt ONLY. Every amount is the canonical decimal atomic-unit
 * string from the durable prepared record (`/^[1-9]\d*$/` by construction);
 * sums are emitted as canonical decimal strings, empty set → `"0"`. NEVER
 * floating point. `authorizedAmountAtomic` = Σ amountAtomic over ALL
 * enumerated (post-filter) authorizations, each counted exactly once,
 * regardless of bucket. Enforced invariant:
 * `settled + failed + unknown + pending === authorized`, and
 * `authorizationCount === records.length`.
 *
 * IDENTITY (pre-i5-security-review.md "Identity Residual"): `agentId`,
 * `network`, `assetAddress` are derived from the DURABLE prepared I3 record
 * ONLY — never from raw request data (no raw-request bypass). `agentId` is
 * a SELF-ASSERTED, UNAUTHENTICATED policy identity (ADD-1 residual
 * production control — acceptable for the bounded testnet proof, NOT a
 * production-graded principal). The cryptographic identity on the payment
 * path is the payer EOA (`payerAddress`, recovered from the signed EIP-3009
 * payload in I4 and carried by SettlementEvidence); `agentId` and
 * `payerAddress` are distinct and never conflated.
 *
 * FILTER: `filter.authorizationId` / `filter.agentId` are applied AFTER
 * both stores have been read for every enumerated authorization (each
 * present field must match; absent fields do not constrain). The totals
 * then reflect the FILTERED SUBSET ONLY. Because filtering happens after
 * the reads, a corrupt record anywhere in either store fails closed even
 * if the filter would have excluded it — corruption is never filtered away.
 *
 * Enumeration is execution-store-driven: an authorizationId that has
 * evidence history but NO durable I3 record is not an execution attempt and
 * does not appear in the summary.
 */
import {
  listX402ExecutionAuthorizations,
  readX402ExecutionRecord,
  X402ExecutionStoreError,
  type X402ExecutionRecord,
  type X402ExecutionState
} from "./execution-store";
import { latestSettlementEvidence } from "./settlement-evidence-store";
import {
  fingerprintSettlementEvidence,
  type SettlementEvidence
} from "./settlement-evidence";
import type { GatewayTransferStatus } from "@/integrations/circle-gateway/contracts";

// ---------------------------------------------------------------------------
// Types (frozen surface).
// ---------------------------------------------------------------------------

/** One of the four mutually exclusive, collectively exhaustive buckets. */
export type X402ExecutedSpendBucket = "settled" | "failed" | "unknown" | "pending";

/** Per-authorization reconciliation row: identity, amount, and bucket. */
export type X402ExecutedSpendRecord = {
  authorizationId: string;
  agentId: string;
  network: string;
  assetAddress: string;
  amountAtomic: string;
  bucket: X402ExecutedSpendBucket;
  /** durable I3 state at read time */
  executionState: X402ExecutionState;
  /** from the latest canonical evidence */
  gatewayTransferStatus: GatewayTransferStatus | null;
  evidenceDigest: string | null;
};

export type X402ExecutedSpendSummary = {
  authorizationCount: number;
  authorizedAmountAtomic: string;
  settledAmountAtomic: string;
  failedAmountAtomic: string;
  unknownAmountAtomic: string;
  pendingAmountAtomic: string;
  records: readonly X402ExecutedSpendRecord[];
};

export type SummarizeX402ExecutedSpendInput = {
  storePath: string;
  settlementEvidenceStorePath: string;
  filter?: { authorizationId?: string; agentId?: string };
};

// ---------------------------------------------------------------------------
// Classification (decision table above; pure, no I/O).
// ---------------------------------------------------------------------------

function classifyExecutedSpend(
  execution: X402ExecutionRecord,
  evidence: SettlementEvidence | null
): X402ExecutedSpendBucket {
  if (evidence !== null) {
    // 1. settled: the latest durable official interpretation says the money
    //    moved (confirmed) or finished (completed) — regardless of whether
    //    the I3 confirmed transition survived a crash afterwards.
    if (evidence.outcome === "confirmed" || evidence.outcome === "completed") {
      return "settled";
    }
    // 2. failed: a durable known-rejection outranks any non-terminal I3 state.
    if (evidence.outcome === "failed") {
      return "failed";
    }
  }
  switch (execution.state) {
    // 3. I3 terminal failure (failure before any evidence landed, or the
    //    failure itself IS the known outcome).
    case "failed":
      return "failed";
    // 4. explicitly ambiguous remote outcome — at-risk, never zero.
    case "remote_outcome_unknown":
      return "unknown";
    // 5. submitted without a recorded outcome: conservative unknown (a settle
    //    attempt may have happened inside a crash window).
    case "submitted":
      return "unknown";
    // Store-inconsistency guard (documented in the header): a confirmed I3
    // state whose durable evidence never landed is at-risk, not settled.
    case "confirmed":
      return "unknown";
    // 6. prepared: consumed locally, no remote attempt possible yet.
    case "prepared":
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// Summarize (read-only).
// ---------------------------------------------------------------------------

/**
 * Build the read-only ExecutedSpendSummary from the two durable stores.
 * Missing stores behave as empty (all totals "0", count 0); corrupt history
 * in either store throws the owning module's typed error (fail closed, no
 * silent skip, nothing repaired or written).
 */
export async function summarizeX402ExecutedSpend(
  input: SummarizeX402ExecutedSpendInput
): Promise<X402ExecutedSpendSummary> {
  const { storePath, settlementEvidenceStorePath, filter } = input;

  // Enumerate from the execution store (throws X402ExecutionStoreError on any
  // foreign/corrupt entry; missing store → []).
  const authorizationIds = await listX402ExecutionAuthorizations(storePath);

  const records: X402ExecutedSpendRecord[] = [];
  for (const authorizationId of authorizationIds) {
    const execution = await readX402ExecutionRecord(storePath, authorizationId);
    if (execution === null) {
      // listX402ExecutionAuthorizations enumerated a directory that holds no
      // valid events (empty directory from a crash between mkdir and the
      // first exclusive create, or a state deleted under us mid-read). This
      // is store inconsistency, not absence — fail closed, never skip.
      throw new X402ExecutionStoreError(
        `enumerated execution authorization ${authorizationId} has no durable record.`
      );
    }
    // Latest canonical evidence (null = none yet). Throws
    // X402SettlementEvidenceStoreError on corrupt evidence history.
    const evidence = await latestSettlementEvidence(
      settlementEvidenceStorePath,
      authorizationId
    );

    const record: X402ExecutedSpendRecord = {
      authorizationId,
      // identity from the DURABLE prepared record only (no raw-request data)
      agentId: execution.prepared.agentId,
      network: execution.prepared.network,
      assetAddress: execution.prepared.assetAddress,
      amountAtomic: execution.prepared.amountAtomic,
      bucket: classifyExecutedSpend(execution, evidence),
      executionState: execution.state,
      gatewayTransferStatus: evidence === null ? null : evidence.gatewayTransferStatus,
      evidenceDigest: evidence === null ? null : fingerprintSettlementEvidence(evidence)
    };

    // Filter AFTER reading both stores (see header): present fields must
    // match; the totals then reflect the filtered subset only.
    if (filter?.authorizationId !== undefined && filter.authorizationId !== record.authorizationId) {
      continue;
    }
    if (filter?.agentId !== undefined && filter.agentId !== record.agentId) {
      continue;
    }
    records.push(record);
  }

  // BigInt-only aggregation; each record's amount enters exactly one bucket
  // plus the authorized total, so the partition invariant holds by
  // construction — and is re-checked below as a fail-closed guard.
  let authorized = 0n;
  let settled = 0n;
  let failed = 0n;
  let unknown = 0n;
  let pending = 0n;
  for (const record of records) {
    const amount = BigInt(record.amountAtomic);
    authorized += amount;
    switch (record.bucket) {
      case "settled":
        settled += amount;
        break;
      case "failed":
        failed += amount;
        break;
      case "unknown":
        unknown += amount;
        break;
      case "pending":
        pending += amount;
        break;
    }
  }
  if (settled + failed + unknown + pending !== authorized) {
    throw new Error(
      "executed spend partition invariant violated: settled + failed + unknown + pending !== authorized."
    );
  }

  return {
    authorizationCount: records.length,
    authorizedAmountAtomic: authorized.toString(),
    settledAmountAtomic: settled.toString(),
    failedAmountAtomic: failed.toString(),
    unknownAmountAtomic: unknown.toString(),
    pendingAmountAtomic: pending.toString(),
    records
  };
}
