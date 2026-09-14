#!/usr/bin/env node
/**
 * x402-gateway-testnet.mjs — I5 operator-only live Gateway testnet entry point
 * (the live settlement itself is reserved for I6 execution).
 *
 * SAFETY CONTRACT (I5):
 *   - REFUSAL BY DEFAULT. Live mode requires BOTH the `--live` command-line
 *     flag AND environment `AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT` set to
 *     exactly the string "true". Every other invocation prints exactly ONE
 *     refusal line to stderr containing the literal code
 *     X402_GATEWAY_OPERATOR_AUTH_REQUIRED and exits with code 2 — after
 *     ZERO network calls, ZERO signer invocations, ZERO filesystem writes,
 *     ZERO key reads, and ZERO TypeScript imports.
 *   - This file is PURE JavaScript and statically imports ONLY `node:`
 *     builtins; the TypeScript runner is dynamically imported ONLY after the
 *     gate authorizes live mode.
 *   - It is never called by the app, never by CI, never by `pnpm smoke`, and
 *     nothing under `src/app/**` may import any part of this live path
 *     (verified statically by tests/x402-gateway-operator-script.test.ts).
 *
 * Modes (and nothing else):
 *   (none / anything else)     → refusal, exit 2.
 *   --live + --reconcile
 *     --authorization-id <id>  → read-only nonce reconciliation through the
 *                                runner (never invokes a signer; valid for
 *                                durable states submitted /
 *                                remote_outcome_unknown — enforced by the
 *                                orchestration module).
 *   --live + --sign-and-settle
 *     --authorization-id <id>
 *     --requirement <path.json>
 *     --payer <0x...>          → ONLY from durable state `prepared` (fresh
 *                                lineage). Any other state (in particular an
 *                                already-submitted one) is refused with
 *                                X402_GATEWAY_EXECUTION_NOT_SUBMITTED: the
 *                                transient signed payload is lost after a
 *                                restart and re-signing the same deterministic
 *                                nonce is FORBIDDEN. From `prepared` it reads
 *                                + I1-validates the requirement, obtains the
 *                                signature by spawning
 *                                scripts/x402-external-signer.mjs as a child
 *                                (stdin JSON → stdout JSON; the private key
 *                                stays in the child's environment and never
 *                                enters this process), cryptographically
 *                                verifies it via signPreparedX402Execution,
 *                                and submits — all in the SAME process run.
 *
 * Optional overrides (defaulted by the runner through the SAME env-var/default
 * rules as src/lib/paths.ts — executionStorePath() / settlementEvidencePath(),
 * cwd = repo root when run from a repo checkout):
 *   --store-path <dir>               (AGENTPAY_EXECUTION_STORE_PATH default)
 *   --settlement-evidence-path <dir> (AGENTPAY_SETTLEMENT_EVIDENCE_PATH default)
 *   --signer-script <path>           (<repoRoot>/scripts/x402-external-signer.mjs)
 *
 * TypeScript execution: once authorized, the script checks Node's native type
 * stripping (`process.features.typescript`). If the running Node does not
 * enable it by default, it re-execs ITSELF ONCE with
 * `--experimental-strip-types` (loop-guarded by
 * AGENTPAY_X402_OPERATOR_STRIPPED). If that flag is unknown to the running
 * Node (exits with a bad-option error), it REFUSES with a single clear
 * diagnostic and a non-zero exit code — no clever fallbacks. When stripping IS
 * available it registers scripts/x402-operator-loader.mjs as an ESM resolve
 * hook (maps `@/` → <repoRoot>/src/ and extensionless relative specifiers to
 * `.ts`) and dynamically imports scripts/x402-gateway-testnet-runner.ts.
 *
 * Output: one sanitized single-line result per run (reason code, durable
 * execution state, validated Gateway transfer UUID when present, evidence
 * digest). NEVER the payload, a signature, a raw request/response body, a
 * private key, or an environment dump.
 */
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { URL, fileURLToPath } from "node:url";

/** Mirrors AGENTPAY_LIVE_PAYMENT_ENV from src/domain/x402/gateway-live-transport.ts (re-declared because this file MUST NOT statically import TypeScript). */
const LIVE_ENV = "AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT";
/** Mirrors X402_GATEWAY_OPERATOR_AUTH_REQUIRED from src/domain/x402/gateway-reason-codes.ts. */
const REFUSAL_CODE = "X402_GATEWAY_OPERATOR_AUTH_REQUIRED";
/** Non-reason-code usage/local-io failure label for malformed operator invocations. */
const USAGE_LABEL = "X402_GATEWAY_USAGE_ERROR";

const argv = process.argv.slice(2);
const hasLiveFlag = argv.includes("--live");
const envAuthorized = process.env[LIVE_ENV] === "true";

function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

if (!hasLiveFlag || !envAuthorized) {
  // Gate FIRST: nothing above this point has any side effect; this branch
  // performs zero network, zero signer, zero filesystem writes, zero key
  // reads, and zero TypeScript imports.
  refuse(
    `REFUSED ${REFUSAL_CODE}: live Gateway testnet settlement requires BOTH the --live flag AND ${LIVE_ENV} set to exactly "true"; no client was constructed, no signer spawned, no files written, no code imported.`
  );
} else {
  await runLive(argv);
}

async function runLive(rawArgv) {
  let options;
  try {
    options = parseOptions(rawArgv);
  } catch (error) {
    refuse(`${USAGE_LABEL}: ${error instanceof Error ? error.message : "invalid arguments"}`);
    return;
  }
  const loaderHref = new URL("./x402-operator-loader.mjs", import.meta.url).href;
  if (!ensureTypeStripping(loaderHref)) {
    return;
  }
  try {
    register(loaderHref);
    // Security requirement (I5): the TypeScript runner MUST be loaded
    // dynamically — a static import would evaluate it on the refusal path,
    // breaking the zero-TS-import guarantee. This is not lazy loading.
    const runnerUrl = new URL("./x402-gateway-testnet-runner.ts", import.meta.url);
    const runner = await import(runnerUrl.href);
    process.exitCode = await runner.main(options);
  } catch {
    refuse(`${USAGE_LABEL}: the live runner could not be loaded or failed unexpectedly (details suppressed).`);
  }
}

/**
 * Node's native type stripping executes the runner. Enabled by default on
 * Node >= 22.18 (process.features.typescript = "strip"|"transform"). Older
 * 22.6+ builds need one re-exec of this script with
 * --experimental-strip-types (loop-guarded by AGENTPAY_X402_OPERATOR_STRIPPED).
 * The flag is PROBED first (`node --experimental-strip-types -e ""`): if the
 * running Node does not understand it, REFUSE with one clear diagnostic —
 * never fall back to anything clever.
 */
function ensureTypeStripping(loaderHref) {
  const feature = process.features?.typescript;
  if (feature === "strip" || feature === "transform") {
    return true;
  }
  if (process.env.AGENTPAY_X402_OPERATOR_STRIPPED === "1") {
    refuse(
      "REFUSED X402_GATEWAY_TYPE_STRIPPING_UNAVAILABLE: this Node build cannot execute TypeScript source; run with Node >= 22.18 (type stripping enabled by default)."
    );
    return false;
  }
  const probe = spawnSync(process.execPath, ["--experimental-strip-types", "-e", ""], { encoding: "utf8" });
  if (probe.status !== 0) {
    refuse(
      "REFUSED X402_GATEWAY_TYPE_STRIPPING_UNAVAILABLE: --experimental-strip-types is not supported by this Node build; run with Node >= 22.18 (type stripping enabled by default)."
    );
    return false;
  }
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", loaderHref, fileURLToPath(import.meta.url), ...argv],
    {
      encoding: "utf8",
      cwd: process.cwd(),
      env: { ...process.env, AGENTPAY_X402_OPERATOR_STRIPPED: "1" }
    }
  );
  if (child.stdout) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }
  process.exitCode = child.status ?? 2;
  return false;
}

/** Parse the post-gate operator options into the runner's structured input. */
function parseOptions(rawArgv) {
  const modes = [];
  const values = {};
  const flags = new Set(["--live", "--reconcile", "--sign-and-settle"]);
  const valued = new Set([
    "--authorization-id",
    "--requirement",
    "--payer",
    "--store-path",
    "--settlement-evidence-path",
    "--signer-script"
  ]);
  for (let index = 0; index < rawArgv.length; index += 1) {
    const token = rawArgv[index];
    if (token === "--reconcile" || token === "--sign-and-settle") {
      modes.push(token.slice(2));
    } else if (valued.has(token)) {
      const value = rawArgv[index + 1];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
        throw new Error(`${token} requires a value.`);
      }
      if (token in values) {
        throw new Error(`${token} was provided more than once.`);
      }
      values[token] = value;
      index += 1;
    } else if (!flags.has(token)) {
      throw new Error(`unsupported argument: ${token}`);
    }
  }
  if (modes.length !== 1) {
    throw new Error("exactly one of --reconcile or --sign-and-settle is required in live mode.");
  }
  if (!("--authorization-id" in values)) {
    throw new Error("--authorization-id is required.");
  }
  const mode = modes[0];
  if (mode === "sign-and-settle") {
    if (!("--requirement" in values) || !("--payer" in values)) {
      throw new Error("--sign-and-settle requires --requirement <path.json> and --payer <0x...>.");
    }
  } else if ("--requirement" in values || "--payer" in values) {
    throw new Error("--reconcile is read-only and accepts neither --requirement nor --payer.");
  }
  return {
    mode,
    authorizationId: values["--authorization-id"],
    requirementPath: values["--requirement"],
    payer: values["--payer"],
    storePath: values["--store-path"],
    settlementEvidencePath: values["--settlement-evidence-path"],
    signerScript: values["--signer-script"]
  };
}
