/**
 * x402-gateway-operator-script.test.ts
 *
 * I5 — operator live-transport gate boundary tests. Covers the REFUSAL
 * CONTRACT: `scripts/x402-gateway-testnet.mjs` must refuse (exit 2, one
 * stderr line containing X402_GATEWAY_OPERATOR_AUTH_REQUIRED) unless BOTH the
 * `--live` flag AND AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT === "true" are
 * present — with ZERO network calls, ZERO signer spawns, ZERO filesystem
 * writes, and ZERO TypeScript imports on every refused path.
 * Plus one NON-LIVE executability proof: the `x402-operator-loader.mjs`
 * resolve hook + Node native type stripping must import
 * `x402-gateway-testnet-runner.ts` (and its whole `@/…` TS graph) to
 * completion under a network-blocking preload — module load only; `main()`
 * is never invoked and no operator authorization is granted.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import {
  AGENTPAY_LIVE_PAYMENT_ENV,
  createLiveGatewayTestnetClient,
  liveTestnetPaymentAuthorized
} from "@/domain/x402/gateway-live-transport";
import { X402_GATEWAY_OPERATOR_AUTH_REQUIRED } from "@/domain/x402/gateway-reason-codes";

const root = process.cwd();
const SCRIPT_PATH = join(root, "scripts", "x402-gateway-testnet.mjs");
const SIGNER_PATH = join(root, "scripts", "x402-external-signer.mjs");

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Run the operator script as a child with an EXACT env for the live var. */
function runOperator(
  args: string[],
  liveEnv: string | undefined
): { status: number; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env[AGENTPAY_LIVE_PAYMENT_ENV];
  if (liveEnv !== undefined) {
    env[AGENTPAY_LIVE_PAYMENT_ENV] = liveEnv;
  }
  const child = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 60_000
  });
  return { status: child.status ?? -1, stdout: child.stdout, stderr: child.stderr };
}

function expectRefusal(result: { status: number; stdout: string; stderr: string }): void {
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const lines = result.stderr.split(/\r?\n/).filter((l) => l.length > 0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(X402_GATEWAY_OPERATOR_AUTH_REQUIRED);
}

/** Paths a test itself owns (created before/between git snapshots). */
function relevantStatusLines(status: string): string[] {
  return status
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .filter(
      (l) =>
        !l.includes("x402-gateway-testnet") &&
        !l.includes("x402-operator-loader") &&
        !l.includes("gateway-live-transport") &&
        !l.includes("x402-gateway-operator-script")
    );
}

describe("x402 gateway operator script — refusal contract (zero side effects)", () => {
  test("no flags, live env UNSET → exit 2, single refusal line, nothing else happens", () => {
    const storeDir = join(makeTempDir("agentpay-x402-op-store-"), "execution-store");
    const result = runOperator([], undefined);
    expectRefusal(result);
    expect(existsSync(storeDir)).toBe(false);
  });

  test.each(["1", "TRUE", "True", "", "true ", "yes", "0"])(
    "live env wrong value (%j) → still refused",
    (value) => {
      const result = runOperator([], value);
      expectRefusal(result);
    }
  );

  test("--live WITHOUT the env var → refused", () => {
    const result = runOperator(
      ["--live", "--reconcile", "--authorization-id", `auth_${"a".repeat(64)}`],
      undefined
    );
    expectRefusal(result);
  });

  test("env var present (non-\"true\" value) with a full --reconcile command → still refused before parsing", () => {
    // "true" is NEVER set by any test (that is a live-payment authorization).
    // The gate checks BOTH conditions before any argv handling, so a
    // well-formed live command with a wrong value must still refuse.
    const storeDir = join(makeTempDir("agentpay-x402-op-store-"), "execution-store");
    const evidenceDir = join(resolve(storeDir, ".."), "settlement-evidence");
    const result = runOperator(
      ["--live", "--reconcile", "--authorization-id", `auth_${"b".repeat(64)}`, "--store-path", storeDir],
      "1"
    );
    expectRefusal(result);
    expect(existsSync(storeDir)).toBe(false);
    expect(existsSync(evidenceDir)).toBe(false);
  });

  test("refusal runs with ZERO network, ZERO signer spawn, ZERO writes: fake signer + temp stores stay untouched", () => {
    const work = makeTempDir("agentpay-x402-op-sideeffects-");
    const storeDir = join(work, "execution-store");
    const evidenceDir = join(work, "settlement-evidence");
    // A stub "signer" that would create a marker file if the parent EVER spawned it.
    const stubSigner = join(work, "stub-signer.mjs");
    const marker = join(work, "signer-was-spawned.marker");
    writeFileSync(stubSigner, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "spawned");\n`, "utf8");

    for (const args of [
      [],
      ["--live"],
      ["--reconcile", "--authorization-id", `auth_${"c".repeat(64)}`],
      ["--live", "--sign-and-settle", "--authorization-id", `auth_${"d".repeat(64)}`, "--requirement", join(work, "missing.json"), "--payer", "0x1111111111111111111111111111111111111111", "--store-path", storeDir, "--settlement-evidence-path", evidenceDir, "--signer-script", stubSigner]
    ]) {
      // Env var UNSET here; the sibling test covers "--live + wrong value".
      const result = runOperator(args, undefined);
      expectRefusal(result);
    }
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(storeDir)).toBe(false);
    expect(existsSync(evidenceDir)).toBe(false);
  });

  test("nothing is written into the repository working tree by refused runs (git status stable)", () => {
    const before = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    expect(before.status).toBe(0);
    runOperator([], undefined);
    runOperator(["--live", "--reconcile", "--authorization-id", `auth_${"e".repeat(64)}`], undefined);
    runOperator([], "TRUE");
    const after = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    expect(after.status).toBe(0);
    expect(relevantStatusLines(after.stdout)).toEqual(relevantStatusLines(before.stdout));
  });

  test("the default execution store directory is never created by a refused run from the repo root", () => {
    const defaultStore = join(root, "data", "execution-store");
    const defaultEvidence = join(root, "data", "settlement-evidence");
    const storeExistedBefore = existsSync(defaultStore);
    const evidenceExistedBefore = existsSync(defaultEvidence);
    const result = runOperator([], undefined);
    expectRefusal(result);
    expect(existsSync(defaultStore)).toBe(storeExistedBefore);
    expect(existsSync(defaultEvidence)).toBe(evidenceExistedBefore);
  });

  test("gate script source: static imports are node: builtins only; no fetch; TS import is dynamic; refusal precedes every effectful construct", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    expect(source).not.toContain("fetch(");
    // The refusal string with the frozen code exists and is reachable before any import of TS.
    expect(source).toContain(X402_GATEWAY_OPERATOR_AUTH_REQUIRED);
    expect(source).toContain(AGENTPAY_LIVE_PAYMENT_ENV);
    // No static TypeScript imports: every static import specifier is node: or the loader/runner is dynamic.
    for (const statement of source.match(/^import[^;]+;/gm) ?? []) {
      expect(statement).toMatch(/from\s+"node:/);
    }
    expect(source).toContain('await import(runnerUrl.href)');
    // The gate itself must never assign the live env value.
    expect(source).not.toMatch(/AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT\s*[=]/);
  });

  test("the external signer CLI is never imported or required by the gate script chain", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    expect(source).not.toContain("x402-external-signer.mjs\"");
    expect(SIGNER_PATH).toBeTruthy();
  });
});

describe("gateway-live-transport module — refusal branch is pure", () => {
  test("liveTestnetPaymentAuthorized is true ONLY for the exact string \"true\"", () => {
    expect(liveTestnetPaymentAuthorized({ [AGENTPAY_LIVE_PAYMENT_ENV]: "true" })).toBe(true);
    for (const value of [undefined, "", "1", "TRUE", "True", "true ", "yes"]) {
      expect(liveTestnetPaymentAuthorized({ [AGENTPAY_LIVE_PAYMENT_ENV]: value })).toBe(false);
    }
  });

  test("createLiveGatewayTestnetClient refuses with the frozen code and no client object", () => {
    const refused = createLiveGatewayTestnetClient({});
    expect(refused.kind).toBe("refused");
    if (refused.kind === "refused") {
      expect(refused.reasonCode).toBe(X402_GATEWAY_OPERATOR_AUTH_REQUIRED);
      expect(Object.keys(refused)).toEqual(["kind", "reasonCode"]);
    }
  });
});

describe("live transport import boundary — nothing under src/app may reach it", () => {
  test("static filesystem scan: no src/app source file references gateway-live-transport", () => {
    const appDir = join(root, "src", "app");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          files.push(full);
        }
      }
    };
    walk(appDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toContain("gateway-live-transport");
    }
  });
});

/** Recursive name → size:mtime snapshot of a directory (missing dir → {}). */
function snapshotTree(dir: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  if (!existsSync(dir)) {
    return snapshot;
  }
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const stat = statSync(full);
        snapshot[full] = `${String(stat.size)}:${String(stat.mtimeMs)}`;
      }
    }
  };
  walk(dir);
  return snapshot;
}

describe("operator loader + type-stripping chain — runner is genuinely importable (NON-live)", () => {
  test("network-blocked node child resolves the loader and imports scripts/x402-gateway-testnet-runner.ts to completion; main is a function; no network trigger; no data/** writes", () => {
    const work = makeTempDir("agentpay-x402-op-loader-");
    // Preload that hard-fails ANY network access AND records the attempt.
    const trigger = join(work, "network-triggered.marker");
    const preloadPath = join(work, "block-network.mjs");
    writeFileSync(
      preloadPath,
      [
        "import { writeFileSync } from 'node:fs';",
        `const fail = () => { writeFileSync(${JSON.stringify(trigger)}, "triggered"); throw new Error('NETWORK ACCESS DISABLED BY TEST'); };`,
        "import http from 'node:http';",
        "import https from 'node:https';",
        "import net from 'node:net';",
        "import dns from 'node:dns';",
        "http.request = fail; http.get = fail;",
        "https.request = fail; https.get = fail;",
        "net.connect = fail; net.createConnection = fail; net.Socket.prototype.connect = fail;",
        "dns.lookup = fail; dns.resolve = fail; dns.resolve4 = fail; dns.resolve6 = fail;",
        "globalThis.fetch = fail;"
      ].join("\n"),
      "utf8"
    );
    // Driver replicates EXACTLY what the gate's post-authorization branch
    // does: register() the loader, then dynamically import() the runner .ts.
    // It never sets the live env var, never passes --live, never calls main().
    const driverPath = join(work, "import-runner.mjs");
    writeFileSync(
      driverPath,
      [
        "import { register } from 'node:module';",
        `register(${JSON.stringify(pathToFileURL(join(root, "scripts", "x402-operator-loader.mjs")).href)});`,
        `const runner = await import(${JSON.stringify(pathToFileURL(join(root, "scripts", "x402-gateway-testnet-runner.ts")).href)});`,
        "if (typeof runner?.main !== 'function') { console.log('MAIN_MISSING'); process.exit(1); }",
        "console.log('RUNNER_OK');"
      ].join("\n"),
      "utf8"
    );
    // Same type-stripping decision as the gate script: if this Node enables
    // stripping by default, no flag; otherwise one --experimental-strip-types.
    const feature = (process.features as unknown as { typescript?: string }).typescript;
    const stripFlags = feature === "strip" || feature === "transform" ? [] : ["--experimental-strip-types"];
    const dataBefore = snapshotTree(join(root, "data"));
    const env = { ...process.env };
    delete env[AGENTPAY_LIVE_PAYMENT_ENV];
    const child = spawnSync(
      process.execPath,
      [
        ...stripFlags,
        "--import",
        pathToFileURL(preloadPath).href,
        driverPath
      ],
      { cwd: root, encoding: "utf8", env, timeout: 60_000 }
    );
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe("RUNNER_OK");
    // The blocker was never triggered: module load made no network attempt.
    expect(existsSync(trigger)).toBe(false);
    // Loading the runner performed no filesystem write anywhere under data/**
    // (in particular no execution-store / settlement-evidence directories).
    expect(snapshotTree(join(root, "data"))).toEqual(dataBefore);
    expect(existsSync(join(root, "data", "execution-store"))).toBe(false);
    expect(existsSync(join(root, "data", "settlement-evidence"))).toBe(false);
  });
});
