/**
 * x402-external-signer-cli.test.ts
 *
 * I4 — external signer CLI boundary tests. `scripts/x402-external-signer.mjs`
 * runs as a SEPARATE child process (node) with an EPHEMERAL private key ONLY
 * in that child's environment. The child must: validate the stdin request,
 * sign exactly the supplied EIP-712 typed data, and emit one valid JSON
 * response on stdout — with ZERO network access (proven at runtime by a
 * network-blocking preload module), no secret in stdout/stderr, and no key
 * ever persisted or printed.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { loadPolicyConfig } from "@/domain/policy/policy-config";
import {
  fingerprintX402PaymentRequirement,
  validateX402PaymentRequirement,
  type X402PaymentRequirement
} from "@/domain/x402/payment-requirement";
import {
  buildX402Eip3009SigningRequest,
  signingRequestDigest,
  type X402Eip3009SigningRequest
} from "@/domain/x402/eip3009-signing-request";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex, type TypedDataDomain } from "viem";

const root = process.cwd();
const policy = loadPolicyConfig(join(root, "data", "policies.default.json"));

const ARC_USDC_ASSET = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const TEST_PAYTO = "0x1111111111111111111111111111111111111111";
const CLI_PATH = join(root, "scripts", "x402-external-signer.mjs");

const tempDirs: string[] = [];
const previousAuditPath = process.env.AGENTPAY_AUDIT_LOG_PATH;
const previousObservationPath = process.env.AGENTPAY_OBSERVATION_LOG_PATH;

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
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

function makeRequirement(overrides: Record<string, unknown> = {}): X402PaymentRequirement {
  return validateX402PaymentRequirement({
    scheme: "exact",
    network: "eip155:5042002",
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
  });
}

function makePreparedRecord(paymentRequirementDigest: string) {
  return {
    authorizationId: `auth_${"a".repeat(64)}`,
    nonce: `0x${"d".repeat(64)}`,
    paymentRequirementDigest,
    parentAuthorizationId: `auth_${"b".repeat(64)}`,
    auditId: "audit_20260707_000001",
    idempotencyKey: "demo-auth-001",
    agentId: "agent_auth_demo_001",
    recipient: "trusted-x402-api.demo",
    network: "eip155:5042002",
    assetAddress: ARC_USDC_ASSET,
    payTo: TEST_PAYTO,
    amountAtomic: "80000",
    policyVersion: policy.policyVersion,
    policyFingerprint: `sha256:${"c".repeat(64)}`,
    authorizationExpiresAt: "2026-07-07T10:20:30.000Z",
    preparedAt: "2026-07-07T10:18:00.000Z"
  };
}

/** Guard-built signing request + its digest (the CLI envelope). */
function buildEnvelope(payerAddress: string): { signingRequestDigest: string; request: X402Eip3009SigningRequest } {
  const requirement = makeRequirement();
  const request = buildX402Eip3009SigningRequest({
    prepared: makePreparedRecord(fingerprintX402PaymentRequirement(requirement)),
    requirement,
    payerAddress,
    now: new Date("2026-07-07T10:18:00.000Z")
  });
  return { signingRequestDigest: signingRequestDigest(request), request };
}

/** Preload that hard-fails ANY network access at runtime (fetch/http/https/net/dns). */
function writeNetworkBlockingPreload(): string {
  const preloadPath = join(makeTempDir("agentpay-x402-cli-netblock-"), "block-network.mjs");
  writeFileSync(
    preloadPath,
    [
      "import http from 'node:http';",
      "import https from 'node:https';",
      "import net from 'node:net';",
      "import dns from 'node:dns';",
      "const fail = () => { throw new Error('NETWORK ACCESS DISABLED BY TEST'); };",
      "http.request = fail; http.get = fail;",
      "https.request = fail; https.get = fail;",
      "net.connect = fail; net.createConnection = fail; net.Socket.prototype.connect = fail;",
      "dns.lookup = fail; dns.resolve = fail; dns.resolve4 = fail; dns.resolve6 = fail;",
      "globalThis.fetch = fail;"
    ].join("\n"),
    "utf8"
  );
  return preloadPath;
}

function runCli(
  envelopeJson: string,
  privateKey: string,
  preloadPath?: string
): { status: number; stdout: string; stderr: string } {
  const args =
    preloadPath === undefined ? [CLI_PATH] : ["--import", pathToFileURL(preloadPath).href, CLI_PATH];
  const child = spawnSync("node", args, {
    cwd: root,
    input: envelopeJson,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENTPAY_X402_SIGNER_PRIVATE_KEY: privateKey
    },
    timeout: 60_000
  });
  return { status: child.status ?? -1, stdout: child.stdout, stderr: child.stderr };
}

describe("x402 external signer CLI (separate process, key only in child env)", () => {
  test("valid stdin request → valid stdout response; no network; no secrets; key not persisted", async () => {
    const key = generatePrivateKey(); // ephemeral, test-process memory only
    const account = privateKeyToAccount(key);
    const envelope = buildEnvelope(account.address);
    const preloadPath = writeNetworkBlockingPreload();

    const { status, stdout, stderr } = runCli(JSON.stringify(envelope), key, preloadPath);

    expect(status).toBe(0);
    expect(stderr).toBe("");

    const response = JSON.parse(stdout) as Record<string, unknown>;
    expect(response.responseType).toBe("x402_eip3009_signature");
    expect(response.version).toBe("v1");
    expect(response.signingRequestDigest).toBe(envelope.signingRequestDigest);
    expect(response.payerAddress).toBe(account.address);
    expect(response.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);

    // The response signature cryptographically verifies against the EXACT
    // typed data the Guard built (proves the child signed what it was asked).
    const signature = response.signature as string;
    const recovered = await awaitRecover(envelope.request, signature);
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());

    // No secret anywhere: not in stdout, not in stderr, not on disk.
    expect(stdout).not.toContain(key);
    expect(stderr).not.toContain(key);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(key);
    expect(serialized).not.toMatch(/privateKey|mnemonic|seed/i);

    // The CLI performs no network (the blocking preload would have thrown)
    // and no key write (the child only reads stdin and writes stdout).
  });

  test("response digest echoes the Guard envelope digest exactly", () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const envelope = buildEnvelope(account.address);
    const { status, stdout } = runCli(JSON.stringify(envelope), key);
    expect(status).toBe(0);
    const response = JSON.parse(stdout) as { signingRequestDigest: string };
    expect(response.signingRequestDigest).toBe(envelope.signingRequestDigest);
  });

  test("payer mismatch (child key != request.payerAddress) → exit non-zero, JSON error on stderr, no signature", () => {
    const requestKey = generatePrivateKey();
    const requestAccount = privateKeyToAccount(requestKey);
    const envelope = buildEnvelope(requestAccount.address);

    const wrongKey = generatePrivateKey(); // different EOA
    const { status, stdout, stderr } = runCli(JSON.stringify(envelope), wrongKey);

    expect(status).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Derived EOA address does not match request.payerAddress");
    expect(stderr).not.toContain(wrongKey);
    expect(stderr).not.toContain(requestKey);
  });

  test("missing private key env → exit non-zero with a JSON error; no signature", () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const envelope = buildEnvelope(account.address);

    const child = spawnSync("node", [CLI_PATH], {
      cwd: root,
      input: JSON.stringify(envelope),
      encoding: "utf8",
      env: { ...process.env, AGENTPAY_X402_SIGNER_PRIVATE_KEY: "" },
      timeout: 60_000
    });

    expect(child.status).not.toBe(0);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("AGENTPAY_X402_SIGNER_PRIVATE_KEY");
    expect(child.stderr).not.toContain(key);
  });

  test("malformed request on stdin → exit non-zero with a JSON error; no signature", () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const envelope = buildEnvelope(account.address);

    // Injected execution field must be rejected by the CLI's strict validation.
    const tampered = {
      ...envelope,
      request: { ...envelope.request, privateKey: "0xdeadbeef" }
    };
    const { status, stdout, stderr } = runCli(JSON.stringify(tampered), key);
    expect(status).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("unsupported field");
    expect(stderr).not.toContain(key);

    // Non-JSON stdin fails closed too.
    const badJson = runCli("not json at all", key);
    expect(badJson.status).not.toBe(0);
    expect(badJson.stderr).toContain("not valid JSON");
  });

  test("CLI never writes the key or any file: repo tree and temp dirs stay clean", () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const envelope = buildEnvelope(account.address);
    const workDir = makeTempDir("agentpay-x402-cli-clean-");
    const before = readFileSync(CLI_PATH, "utf8");

    const child = spawnSync("node", [CLI_PATH], {
      cwd: workDir,
      input: JSON.stringify(envelope),
      encoding: "utf8",
      env: { ...process.env, AGENTPAY_X402_SIGNER_PRIVATE_KEY: key },
      timeout: 60_000
    });
    expect(child.status).toBe(0);

    // No new files appeared in the working directory and the script file is
    // unchanged (it contains no key by construction).
    expect(readdirSync(workDir)).toEqual([]);
    expect(readFileSync(CLI_PATH, "utf8")).toBe(before);
    expect(before).not.toContain(key);
  });
});

function awaitRecover(request: X402Eip3009SigningRequest, signature: string): Promise<string> {
  return recoverTypedDataAddress({
    domain: request.eip712.domain as TypedDataDomain,
    types: request.eip712.types,
    primaryType: request.eip712.primaryType,
    message: {
      from: request.eip712.message.from as `0x${string}`,
      to: request.eip712.message.to as `0x${string}`,
      value: BigInt(request.eip712.message.value),
      validAfter: BigInt(request.eip712.message.validAfter),
      validBefore: BigInt(request.eip712.message.validBefore),
      nonce: request.eip712.message.nonce as `0x${string}`
    },
    signature: signature as Hex
  });
}
