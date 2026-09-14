/**
 * x402-gateway-testnet-runner.ts — the REAL live-mode runner for the I5
 * operator entry point (`scripts/x402-gateway-testnet.mjs`).
 *
 * Executed ONLY after the operator gate (flag `--live` + env
 * `AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT === "true"`) has authorized live
 * mode, via Node's native type stripping and the
 * `scripts/x402-operator-loader.mjs` resolve hook. Tests never invoke it:
 * I5 has ZERO live execution; its first exercise is expected in I6.
 *
 * ALL pre-submit security logic (expiry re-check, binding, digest checks,
 * submitted-claim rules, unknown-outcome transitions, SettlementEvidence
 * writes) lives in the orchestration module `src/domain/x402/gateway-settlement.ts`
 * and in the I4 signing orchestrator — this runner duplicates NONE of it.
 * It wires CLI input to those frozen APIs, spawns the key-isolated external
 * signer CLI (the private key stays in the child's environment; this process
 * never reads, copies, or prints key material), and prints ONE sanitized
 * single line per run — never a payload, signature, raw request/response
 * body, key, or environment dump.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { executionStorePath, settlementEvidencePath } from "@/lib/paths";
import { createLiveGatewayTestnetClient } from "@/domain/x402/gateway-live-transport";
import {
  readX402ExecutionRecord,
  X402ExecutionStoreError,
  type X402ExecutionRecord
} from "@/domain/x402/execution-store";
import {
  fingerprintX402PaymentRequirement,
  validateX402PaymentRequirement,
  type X402PaymentRequirement
} from "@/domain/x402/payment-requirement";
import { signingRequestDigest } from "@/domain/x402/eip3009-signing-request";
import { signPreparedX402Execution } from "@/domain/x402/sign-prepared-x402-execution";
import type { X402ExternalSigner, X402ExternalSignerResponse } from "@/domain/x402/external-signer";
import {
  X402_GATEWAY_EXECUTION_NOT_FOUND,
  X402_GATEWAY_EXECUTION_NOT_SUBMITTED,
  X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH
} from "@/domain/x402/gateway-reason-codes";
import {
  reconcileX402GatewayOutcome,
  submitX402GatewaySettlement,
  type X402GatewaySettlementResult
} from "@/domain/x402/gateway-settlement";

/** Structured options produced by the (pure-JS) gate script's argv parser. */
export type OperatorRunnerOptions = {
  mode: "reconcile" | "sign-and-settle";
  authorizationId: string;
  requirementPath?: string | undefined;
  payer?: string | undefined;
  storePath?: string | undefined;
  settlementEvidencePath?: string | undefined;
  signerScript?: string | undefined;
};

/** Local usage/io failure label (not a reason code); mirrors the gate script. */
const USAGE_LABEL = "X402_GATEWAY_USAGE_ERROR";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

function refuse(code: string, detail: string): void {
  process.stderr.write(`REFUSED ${code}: ${detail}\n`);
}

/**
 * Key-isolated signer adapter: spawns scripts/x402-external-signer.mjs
 * exactly like the I4 CLI contract (stdin JSON envelope → stdout JSON
 * response). The child inherits this process's environment — the key variable
 * is read ONLY by the child. The raw response is returned unvalidated here:
 * the I4 orchestrator (`signPreparedX402Execution`) performs the strict
 * structural validation and cryptographic verification itself; any throw from
 * this adapter is mapped by the orchestrator to a stable `X402_SIGNER_*`
 * failure code (never to a submitted state).
 */
function makeCliSigner(signerScript: string): X402ExternalSigner {
  return {
    async sign(request): Promise<X402ExternalSignerResponse> {
      const envelope = { signingRequestDigest: signingRequestDigest(request), request };
      const stdout = await spawnSigner(signerScript, JSON.stringify(envelope));
      const parsed: unknown = JSON.parse(stdout);
      // I4 owns strict validation of this value (validateX402ExternalSignerResponse);
      // this cast only satisfies the interface — nothing is trusted from the child.
      const response = parsed as X402ExternalSignerResponse;
      return response;
    }
  };
}

function spawnSigner(signerScript: string, input: string): Promise<string> {
  // Executor form: the repo's tsconfig lib is ES2022 (Promise.withResolvers
  // is untyped there) and tsconfig is not this task's file to change.
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(process.execPath, [signerScript], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderrBytes = 0;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string | Buffer) => {
      // Drain without retaining: the signer's stderr is never echoed.
      stderrBytes += Buffer.byteLength(String(chunk));
    });
    child.on("error", () => rejectOutput(new Error("external signer could not be started")));
    child.on("close", (code) => {
      if (code === 0 && stdout.length > 0) {
        resolveOutput(stdout);
      } else {
        rejectOutput(new Error(`external signer failed (exit=${String(code)}, stderrBytes=${String(stderrBytes)})`));
      }
    });
    child.stdin.end(input);
  });
}

function printSettlementResult(result: X402GatewaySettlementResult): number {
  line(
    `RESULT reasonCode=${result.reasonCode} executionState=${result.executionState ?? "none"} ` +
      `gatewayTransferId=${result.gatewayTransferId ?? "none"} gatewayTransferStatus=${result.gatewayTransferStatus ?? "none"} ` +
      `outcome=${result.outcome ?? "none"} settlementEvidenceDigest=${result.settlementEvidenceDigest ?? "none"}`
  );
  const settled =
    result.outcome === "accepted_pending" || result.outcome === "confirmed" || result.outcome === "completed";
  return settled ? 0 : 2;
}

async function readRecord(storePath: string, authorizationId: string): Promise<X402ExecutionRecord | null> {
  try {
    return await readX402ExecutionRecord(storePath, authorizationId);
  } catch (error) {
    // Fail closed on corrupt history: report NOT_FOUND, never repair.
    if (error instanceof X402ExecutionStoreError) {
      return null;
    }
    throw error;
  }
}

/**
 * Read-only nonce reconciliation. NEVER spawns the signer. State eligibility
 * (submitted / remote_outcome_unknown) is enforced by the orchestration
 * module — this runner adds no duplicated checks.
 */
async function runReconcile(options: OperatorRunnerOptions, now: Date): Promise<number> {
  const storePath = options.storePath ?? executionStorePath();
  const evidencePath = options.settlementEvidencePath ?? settlementEvidencePath();
  const transport = createLiveGatewayTestnetClient(process.env);
  if (transport.kind === "refused") {
    refuse(transport.reasonCode, "operator live authorization is not present in the environment.");
    return 2;
  }
  const result = await reconcileX402GatewayOutcome({
    storePath,
    settlementEvidenceStorePath: evidencePath,
    authorizationId: options.authorizationId,
    now,
    client: transport.client
  });
  return printSettlementResult(result);
}

/**
 * Sign + settle, ONLY from durable state `prepared` (fresh lineage). Any other
 * state is refused BEFORE the signer is spawned: the transient signed payload
 * cannot survive a restart, and re-signing the same deterministic nonce is
 * FORBIDDEN — use --reconcile for submitted/unknown states.
 */
async function runSignAndSettle(options: OperatorRunnerOptions, now: Date): Promise<number> {
  const storePath = options.storePath ?? executionStorePath();
  const evidencePath = options.settlementEvidencePath ?? settlementEvidencePath();
  const signerScript = resolvePath(process.cwd(), options.signerScript ?? "scripts/x402-external-signer.mjs");
  if (options.requirementPath === undefined || options.payer === undefined) {
    refuse(USAGE_LABEL, "--sign-and-settle requires --requirement and --payer.");
    return 2;
  }
  if (!EVM_ADDRESS_PATTERN.test(options.payer)) {
    refuse(USAGE_LABEL, "--payer must be a 0x-prefixed 20-byte hex EVM address.");
    return 2;
  }
  let requirementJson: unknown;
  try {
    requirementJson = JSON.parse(await readFile(resolvePath(process.cwd(), options.requirementPath), "utf8"));
  } catch {
    refuse(USAGE_LABEL, "the --requirement file could not be read or parsed as JSON.");
    return 2;
  }
  let requirement: X402PaymentRequirement;
  try {
    requirement = validateX402PaymentRequirement(requirementJson);
  } catch {
    refuse(X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH, "the --requirement file failed strict I1 payment-requirement validation.");
    return 2;
  }
  const record = await readRecord(storePath, options.authorizationId);
  if (record === null) {
    refuse(X402_GATEWAY_EXECUTION_NOT_FOUND, "no durable execution record for this authorization id.");
    return 2;
  }
  if (record.state !== "prepared") {
    refuse(
      X402_GATEWAY_EXECUTION_NOT_SUBMITTED,
      "sign-and-settle is valid only from durable state prepared; use --reconcile for submitted/remote_outcome_unknown (re-signing a used deterministic nonce is forbidden)."
    );
    return 2;
  }
  if (fingerprintX402PaymentRequirement(requirement) !== record.prepared.paymentRequirementDigest) {
    refuse(
      X402_GATEWAY_REQUIREMENT_DIGEST_MISMATCH,
      "the supplied requirement file does not match the digest committed to the prepared record."
    );
    return 2;
  }
  const transport = createLiveGatewayTestnetClient(process.env);
  if (transport.kind === "refused") {
    refuse(transport.reasonCode, "operator live authorization is not present in the environment.");
    return 2;
  }
  // I4 orchestrator: builds the EXACT signing request, invokes the CLI signer
  // child, cryptographically verifies the signature, applies the durable
  // submitted claim, and returns ONLY the transient payload (never persisted).
  const signed = await signPreparedX402Execution({
    storePath,
    authorizationId: options.authorizationId,
    paymentRequirement: requirement,
    payerBinding: { payerAddress: options.payer },
    now,
    signer: makeCliSigner(signerScript)
  });
  if (!signed.signerReady || signed.payload === null) {
    refuse(
      X402_GATEWAY_EXECUTION_NOT_SUBMITTED,
      `signing stage rejected the execution (stable signer code: ${signed.reasonCode}).`
    );
    return 2;
  }
  // Submission — including every pre-submit security check — lives in the
  // orchestration module; SAME process run, so the transient payload is never lost.
  const result = await submitX402GatewaySettlement({
    storePath,
    settlementEvidenceStorePath: evidencePath,
    authorizationId: options.authorizationId,
    paymentRequirement: requirement,
    signedPayload: signed.payload,
    now,
    client: transport.client
  });
  return printSettlementResult(result);
}

/** Live-mode entry: called by the gate script ONLY after the operator gate passed. */
export async function main(options: OperatorRunnerOptions): Promise<number> {
  const now = new Date();
  if (options.mode === "reconcile") {
    return runReconcile(options, now);
  }
  return runSignAndSettle(options, now);
}

