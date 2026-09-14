/**
 * I5 - Circle Gateway x402 wire contract + testnet transport tests.
 *
 * ALL network behavior is exercised against an INJECTED mock fetch. A test
 * guard stubs globalThis.fetch to throw, so any accidental real network
 * attempt fails the suite loudly. Zero requests ever reach
 * gateway-api-testnet.circle.com, gateway-api.circle.com, an Arc RPC host, or
 * any other host. Official contract facts cited from
 * https://developers.circle.com/openapi/gateway.yaml (accessed 2026-09-14).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { X402PaymentRequirement } from "@/domain/x402/payment-requirement";
import type { X402SignedPaymentPayload } from "@/domain/x402/external-signer";
import {
  GATEWAY_TESTNET_ORIGIN,
  GATEWAY_SETTLE_PATH,
  GATEWAY_TRANSFERS_PATH,
  GatewayContractError,
  buildGatewaySettleRequestBody,
  parseGatewayTransfersListResponse,
  validateGatewaySettleResponse,
  validateGatewayTransferSnapshot,
  type GatewaySettleRequest,
  type GatewaySettleResponse,
  type GatewayTransferSnapshot
} from "@/integrations/circle-gateway/contracts";
import {
  GATEWAY_MAX_RESPONSE_BYTES,
  createGatewayTestnetClient,
  type GatewayFetchLike,
  type GatewayFetchResponse
} from "@/integrations/circle-gateway/testnet-client";

// ---------------------------------------------------------------------------
// Fixtures (per the officially verified feasibility sources / I4 shapes).
// ---------------------------------------------------------------------------

const REQUIREMENT: X402PaymentRequirement = {
  scheme: "exact",
  network: "eip155:5042002",
  amount: "10000",
  asset: "0x3600000000000000000000000000000000000000",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 604900,
  extra: {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
  }
};

const PAYMENT_PAYLOAD: X402SignedPaymentPayload = {
  x402Version: 2,
  accepted: REQUIREMENT,
  payload: {
    signature: `0x${"11".repeat(65)}`,
    authorization: {
      from: "0x2222222222222222222222222222222222222222",
      to: "0x3600000000000000000000000000000000000000",
      value: "10000",
      validAfter: "0",
      validBefore: "2000000000",
      nonce: `0x${"aa".repeat(32)}`
    }
  }
};

const CANARY = "agentpay-canary-7f3d";

function makeSettleRequest(overrides: Record<string, unknown> = {}): GatewaySettleRequest {
  return {
    paymentPayload: { ...PAYMENT_PAYLOAD },
    paymentRequirements: { ...REQUIREMENT },
    ...overrides
  } as unknown as GatewaySettleRequest;
}

/** Official WIRE shape of a successful settle response (200 body). */
const SETTLE_SUCCESS_WIRE = {
  success: true,
  transaction: "123e4567-e89b-12d3-a456-426614174000",
  network: "eip155:5042002",
  payer: "0x2222222222222222222222222222222222222222"
};

/** Normalized expectation after validateGatewaySettleResponse(SETTLE_SUCCESS_WIRE). */
const SETTLE_SUCCESS_BODY: GatewaySettleResponse = {
  success: true,
  transaction: "123e4567-e89b-12d3-a456-426614174000",
  network: "eip155:5042002",
  errorReason: null,
  payerAddress: "0x2222222222222222222222222222222222222222"
};

const TRANSFER_SNAPSHOT_BODY = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  status: "batched",
  token: "USDC",
  sendingNetwork: "eip155:5042002",
  recipientNetwork: "eip155:5042002",
  fromAddress: "0x2222222222222222222222222222222222222222",
  toAddress: "0x3600000000000000000000000000000000000000",
  amount: "10000",
  nonce: `0x${"aa".repeat(32)}`,
  txHash: `0x${"cd".repeat(32)}`,
  createdAt: "2026-09-14T12:00:00.000Z",
  updatedAt: "2026-09-14T12:01:00.000Z"
} as const;

// ---------------------------------------------------------------------------
// Mock fetch harness (never a real network call).
// ---------------------------------------------------------------------------

type RecordedCall = {
  url: string;
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    redirect: "error";
    signal: AbortSignal;
  };
};

function makeHeaders(entries: Record<string, string | null>): { get(name: string): string | null } {
  return {
    get(name: string): string | null {
      return Object.hasOwn(entries, name) ? entries[name] : null;
    }
  };
}

function jsonResponse(
  body: unknown,
  overrides: {
    status?: number;
    contentType?: string | null;
    contentLength?: string | null;
    textBody?: string;
  } = {}
): GatewayFetchResponse {
  const status = overrides.status ?? 200;
  const contentType =
    overrides.contentType === undefined ? "application/json" : overrides.contentType;
  const rawText = overrides.textBody ?? JSON.stringify(body);
  return {
    status,
    headers: makeHeaders({
      "content-type": contentType,
      ...(overrides.contentLength !== undefined ? { "content-length": overrides.contentLength } : {})
    }),
    text: async () => rawText
  };
}

/** Records every call and hands them to `impl`. */
function recordingFetch(
  impl: (url: string, init: RecordedCall["init"]) => Promise<GatewayFetchResponse>
): { calls: RecordedCall[]; fetchImpl: GatewayFetchLike } {
  const calls: RecordedCall[] = [];
  const fetchImpl: GatewayFetchLike = (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return { calls, fetchImpl };
}

function wrapTextCounter(response: GatewayFetchResponse): GatewayFetchResponse & {
  textCallCount: () => number;
} {
  let textCalls = 0;
  const original = response.text.bind(response);
  return Object.assign(response, {
    text: async () => {
      textCalls += 1;
      return original();
    },
    textCallCount: () => textCalls
  });
}

/**
 * Test guard: globalThis.fetch must NEVER run. Every network-capable test
 * injects its own fetchImpl (or deliberately stubs global fetch with a mock),
 * so any real platform fetch here is a hard failure.
 */
let globalFetchGuard = vi.fn();
beforeEach(() => {
  globalFetchGuard = vi.fn(() => {
    throw new Error(
      "REAL NETWORK GUARD: a test reached globalThis.fetch. Tests must inject fetchImpl."
    );
  });
  vi.stubGlobal("fetch", globalFetchGuard);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const expectGlobalFetchNeverCalled = () => {
  expect(globalFetchGuard).not.toHaveBeenCalled();
};

// ---------------------------------------------------------------------------
// contracts.ts - settle response validation.
// ---------------------------------------------------------------------------

describe("validateGatewaySettleResponse", () => {
  test("accepts a complete success response and maps official fields verbatim", () => {
    const result = validateGatewaySettleResponse(SETTLE_SUCCESS_WIRE);
    expect(result).toEqual(SETTLE_SUCCESS_BODY);
  });

  test("accepts a failure response with empty transaction and enum errorReason", () => {
    const result = validateGatewaySettleResponse({
      success: false,
      transaction: "",
      network: "eip155:5042002",
      errorReason: "nonce_already_used"
    });
    expect(result).toEqual({
      success: false,
      transaction: "",
      network: "eip155:5042002",
      errorReason: "nonce_already_used",
      payerAddress: null
    });
  });

  test("accepts the official 500 shape with unexpected_error and empty transaction", () => {
    const result = validateGatewaySettleResponse({
      success: false,
      errorReason: "unexpected_error",
      transaction: "",
      network: "eip155:5042002"
    });
    expect(result.errorReason).toBe("unexpected_error");
    expect(result.transaction).toBe("");
  });

  test("rejects missing required fields (success/transaction/network)", () => {
    for (const missing of ["success", "transaction", "network"]) {
      const input = { ...SETTLE_SUCCESS_WIRE };
      delete (input as Record<string, unknown>)[missing];
      expect(() => validateGatewaySettleResponse(input)).toThrow(
        expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_MISSING" })
      );
    }
  });

  test("rejects unknown/extra fields (normalized names are NOT wire names)", () => {
    expect(() =>
      validateGatewaySettleResponse({
        ...SETTLE_SUCCESS_WIRE,
        payerAddress: "0x2222222222222222222222222222222222222222"
      })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_UNKNOWN_FIELD" }));
    expect(() =>
      validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, extra: 1 })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_UNKNOWN_FIELD" }));
  });

  test("rejects non-boolean success and non-object input", () => {
    expect(() =>
      validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, success: "true" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() =>
      validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, success: null })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() => validateGatewaySettleResponse(null)).toThrow(
      expect.objectContaining({ code: "GATEWAY_CONTRACT_JSON_INVALID" })
    );
    expect(() => validateGatewaySettleResponse([])).toThrow(
      expect.objectContaining({ code: "GATEWAY_CONTRACT_JSON_INVALID" })
    );
  });

  test("success:true requires a transfer UUID - a 0x hash or empty string is rejected", () => {
    // `transaction` is a transfer UUID on success (never a tx hash).
    expect(() =>
      validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, transaction: "" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() =>
      validateGatewaySettleResponse({
        ...SETTLE_SUCCESS_WIRE,
        transaction: `0x${"ab".repeat(32)}`
      })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() =>
      validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, transaction: "not-a-uuid" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
  });

  test("failure may carry empty or valid-UUID transaction but never a random string", () => {
    expect(
      validateGatewaySettleResponse({
        success: false,
        transaction: "123e4567-e89b-12d3-a456-426614174000",
        network: "eip155:5042002",
        errorReason: "insufficient_balance"
      }).transaction
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(() =>
      validateGatewaySettleResponse({
        success: false,
        transaction: "random-string",
        network: "eip155:5042002",
        errorReason: "insufficient_balance"
      })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
  });

  test("rejects invalid errorReason and a success+errorReason contradiction", () => {
    expect(() =>
      validateGatewaySettleResponse({
        success: false,
        transaction: "",
        network: "eip155:5042002",
        errorReason: "not_a_reason"
      })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() =>
      validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, errorReason: "self_transfer" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
  });

  test("rejects malformed CAIP-2 network", () => {
    for (const network of ["base-sepolia", "eip155:0", "eip155:05042002", "arcTestnet", "eip155"]) {
      expect(() => validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, network })).toThrow(
        expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" })
      );
    }
  });

  test("rejects malformed payer address; null when absent", () => {
    expect(() =>
      validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, payer: "0x1234" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() => validateGatewaySettleResponse({ ...SETTLE_SUCCESS_WIRE, payer: null })).toThrow(
      expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" })
    );
    expect(
      validateGatewaySettleResponse({
        success: true,
        transaction: "123e4567-e89b-12d3-a456-426614174000",
        network: "eip155:5042002"
      }).payerAddress
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// contracts.ts - transfer snapshot validation.
// ---------------------------------------------------------------------------

describe("validateGatewayTransferSnapshot", () => {
  test("accepts a complete official X402TransferResponse and maps all fields", () => {
    const result = validateGatewayTransferSnapshot(TRANSFER_SNAPSHOT_BODY);
    expect(result).toEqual<GatewayTransferSnapshot>({
      transferId: "123e4567-e89b-12d3-a456-426614174000",
      status: "batched",
      nonce: `0x${"aa".repeat(32)}`,
      sendingNetwork: "eip155:5042002",
      recipientNetwork: "eip155:5042002",
      payerAddress: "0x2222222222222222222222222222222222222222",
      payToAddress: "0x3600000000000000000000000000000000000000",
      amountAtomic: "10000",
      token: "USDC",
      batchTxHash: `0x${"cd".repeat(32)}`
    });
  });

  test("accepts txHash null (batch hash remains null until batched)", () => {
    const result = validateGatewayTransferSnapshot({
      ...TRANSFER_SNAPSHOT_BODY,
      txHash: null
    });
    expect(result.batchTxHash).toBeNull();
  });

  test("rejects missing required fields", () => {
    for (const missing of [
      "id",
      "status",
      "token",
      "sendingNetwork",
      "recipientNetwork",
      "fromAddress",
      "toAddress",
      "amount",
      "nonce",
      "txHash",
      "createdAt",
      "updatedAt"
    ]) {
      const input = { ...TRANSFER_SNAPSHOT_BODY };
      delete (input as Record<string, unknown>)[missing];
      expect(() => validateGatewayTransferSnapshot(input)).toThrow(
        expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_MISSING" })
      );
    }
  });

  test("rejects unknown/extra fields, including fabricated assetAddress", () => {
    for (const extra of [
      { assetAddress: "0x0000000000000000000000000000000000000000" },
      { network: "eip155:5042002" },
      { pagination: true }
    ]) {
      expect(() =>
        validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, ...extra })
      ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_UNKNOWN_FIELD" }));
    }
  });

  test("rejects invalid status enum values", () => {
    for (const status of ["submitted", "pending", "settled", "COMPLETED", 3, null]) {
      expect(() =>
        validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, status })
      ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    }
  });

  test("token is a SYMBOL never an address; rejects lowercase, addresses, and junk", () => {
    // Official: "Token symbol (e.g., USDC).", example USDC.
    expect(validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, token: "USDC" }).token).toBe(
      "USDC"
    );
    for (const token of [
      "usdc",
      "0x3600000000000000000000000000000000000000",
      "U",
      "A".repeat(11),
      "USD C"
    ]) {
      expect(() => validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, token })).toThrow(
        expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" })
      );
    }
  });

  test("rejects malformed nonce (0x + 64 lowercase hex required)", () => {
    for (const nonce of [
      `0x${"AA".repeat(32)}`, // uppercase
      `0x${"ab".repeat(31)}`, // 62 hex
      `0x${"ab".repeat(33)}`, // 66 hex
      "1234",
      null
    ]) {
      expect(() => validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, nonce })).toThrow(
        expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" })
      );
    }
  });

  test("rejects malformed amounts (leading zeros, decimals, negatives, zero)", () => {
    for (const amount of ["0100", "0", "100.5", "-5", "1e3", ""]) {
      expect(() => validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, amount })).toThrow(
        expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" })
      );
    }
  });

  test("rejects malformed txHash (only 0x + 64 hex acceptable when non-null)", () => {
    for (const txHash of ["0x1234", `0x${"zz".repeat(32)}`, "123", 42]) {
      expect(() => validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, txHash })).toThrow(
        expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" })
      );
    }
  });

  test("transferId is a transfer UUID - a 0x hash is NOT a valid id", () => {
    // Transfer id is NEVER a tx hash (official: format uuid).
    expect(() =>
      validateGatewayTransferSnapshot({
        ...TRANSFER_SNAPSHOT_BODY,
        id: `0x${"ab".repeat(32)}`
      })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
  });

  test("rejects malformed addresses and CAIP-2 networks", () => {
    expect(() =>
      validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, fromAddress: "0x1234" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() =>
      validateGatewayTransferSnapshot({
        ...TRANSFER_SNAPSHOT_BODY,
        toAddress: "0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"
      })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() =>
      validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, sendingNetwork: "base-sepolia" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    expect(() =>
      validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, recipientNetwork: "eip155:" })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
  });

  test("rejects malformed createdAt/updatedAt timestamps", () => {
    for (const createdAt of ["yesterday", "2026-13-45T99:99:99Z", 42, null]) {
      expect(() =>
        validateGatewayTransferSnapshot({ ...TRANSFER_SNAPSHOT_BODY, createdAt })
      ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" }));
    }
  });
});

// ---------------------------------------------------------------------------
// contracts.ts - list envelope + request body builder.
// ---------------------------------------------------------------------------

describe("parseGatewayTransfersListResponse", () => {
  test("unwraps the official envelope key `transfers` verbatim", () => {
    const list = parseGatewayTransfersListResponse({ transfers: [TRANSFER_SNAPSHOT_BODY] });
    expect(list).toHaveLength(1);
    expect(list[0].transferId).toBe(TRANSFER_SNAPSHOT_BODY.id);
  });

  test("accepts an empty list", () => {
    expect(parseGatewayTransfersListResponse({ transfers: [] })).toEqual([]);
  });

  test("rejects missing envelope key, non-array value, and unknown envelope keys", () => {
    expect(() => parseGatewayTransfersListResponse({})).toThrow(
      expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_MISSING" })
    );
    expect(() => parseGatewayTransfersListResponse({ transfers: {} })).toThrow(
      expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_INVALID" })
    );
    expect(() =>
      parseGatewayTransfersListResponse({ transfers: [], pagination: { next: "cursor" } })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_UNKNOWN_FIELD" }));
    expect(() =>
      parseGatewayTransfersListResponse({ transfers: [{ ...TRANSFER_SNAPSHOT_BODY, extra: true }] })
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_UNKNOWN_FIELD" }));
  });
});

describe("buildGatewaySettleRequestBody", () => {
  test("emits exactly {paymentPayload, paymentRequirements} with no top-level x402Version", () => {
    const body = buildGatewaySettleRequestBody(makeSettleRequest());
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["paymentPayload", "paymentRequirements"]);
    expect(parsed).not.toHaveProperty("x402Version");
    // x402Version lives INSIDE paymentPayload (official required: x402Version,
    // accepted, payload).
    expect((parsed.paymentPayload as Record<string, unknown>).x402Version).toBe(2);
    expect(parsed.paymentPayload).toEqual(PAYMENT_PAYLOAD);
    expect(parsed.paymentRequirements).toEqual(REQUIREMENT);
  });

  test("never emits caller-supplied extra top-level keys", () => {
    const request = makeSettleRequest({
      x402Version: 1,
      note: CANARY,
      gatewayUrl: "https://evil.example"
    });
    const parsed = JSON.parse(buildGatewaySettleRequestBody(request)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["paymentPayload", "paymentRequirements"]);
    expect(JSON.stringify(parsed)).not.toContain(CANARY);
  });

  test("throws GatewayContractError for missing required members", () => {
    expect(() =>
      buildGatewaySettleRequestBody({ paymentPayload: undefined } as unknown as GatewaySettleRequest)
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_MISSING" }));
    expect(() =>
      buildGatewaySettleRequestBody({} as unknown as GatewaySettleRequest)
    ).toThrow(expect.objectContaining({ code: "GATEWAY_CONTRACT_FIELD_MISSING" }));
  });
});

// ---------------------------------------------------------------------------
// Client - URL pinning, exact wire shape, request construction.
// ---------------------------------------------------------------------------

describe("GatewayTestnetClient transport", () => {
  test("settle POSTs exactly to the pinned testnet settle URL with a JSON body", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => jsonResponse(SETTLE_SUCCESS_WIRE));
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });
    const result = await client.settle(makeSettleRequest());

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.httpStatus).toBe(200);
      expect(result.response).toEqual(SETTLE_SUCCESS_BODY);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GATEWAY_TESTNET_ORIGIN}${GATEWAY_SETTLE_PATH}`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.headers["content-type"]).toBe("application/json");
    expect(calls[0].init.headers.accept).toBe("application/json");
    expect(calls[0].init.body).toBe(buildGatewaySettleRequestBody(makeSettleRequest()));
    expectGlobalFetchNeverCalled();
  });

  test("listTransfersByNonce GETs the exact nonce-filtered URL", async () => {
    const nonce = `0x${"aa".repeat(32)}`;
    const { calls, fetchImpl } = recordingFetch(async () =>
      jsonResponse({ transfers: [TRANSFER_SNAPSHOT_BODY] })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });
    const result = await client.listTransfersByNonce(nonce);

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.transfers).toHaveLength(1);
      expect(result.transfers[0].nonce).toBe(nonce);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GATEWAY_TESTNET_ORIGIN}${GATEWAY_TRANSFERS_PATH}?nonce=${nonce}`);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    expectGlobalFetchNeverCalled();
  });

  test("getTransfer GETs the exact transfer UUID URL", async () => {
    const transferId = "123e4567-e89b-12d3-a456-426614174000";
    const { calls, fetchImpl } = recordingFetch(async () => jsonResponse(TRANSFER_SNAPSHOT_BODY));
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });
    const result = await client.getTransfer(transferId);

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.transfer.transferId).toBe(transferId);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GATEWAY_TESTNET_ORIGIN}${GATEWAY_TRANSFERS_PATH}/${transferId}`);
    expect(calls[0].init.method).toBe("GET");
    expectGlobalFetchNeverCalled();
  });

  test("API surface has no baseUrl/host/gatewayUrl option (compile-time pin)", () => {
    // @ts-expect-error createGatewayTestnetClient options are {fetchImpl?, timeoutMs?} only
    createGatewayTestnetClient({ baseUrl: "https://evil.example" });
    // @ts-expect-error no host override exists
    createGatewayTestnetClient({ host: "evil.example" });
    // @ts-expect-error no gatewayUrl override exists
    createGatewayTestnetClient({ gatewayUrl: "https://evil.example" });
    expectGlobalFetchNeverCalled();
  });

  test("an attacker-ish fetchImpl still receives ONLY the pinned origin", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => jsonResponse(SETTLE_SUCCESS_WIRE));
    // Widened options object: stray keys (baseUrl/host/gatewayUrl/apiKey) are
    // structurally possible at runtime and must never influence the origin.
    const evilOptions: Record<string, unknown> = {
      fetchImpl,
      timeoutMs: 500,
      baseUrl: "https://evil.example",
      host: "evil.example",
      gatewayUrl: "https://evil.example",
      apiKey: "secret"
    };
    const client = createGatewayTestnetClient(
      evilOptions as unknown as { fetchImpl: GatewayFetchLike; timeoutMs: number }
    );
    const evilRequest = makeSettleRequest({
      baseUrl: "https://evil.example",
      gatewayUrl: "https://evil.example"
    } as never);
    await client.settle(evilRequest);
    await client.settle(makeSettleRequest());
    await client.listTransfersByNonce(`0x${"aa".repeat(32)}`);
    await client.getTransfer("123e4567-e89b-12d3-a456-426614174000");

    for (const call of calls) {
      expect(call.url.startsWith(GATEWAY_TESTNET_ORIGIN)).toBe(true);
      expect(call.url).not.toMatch(/^https?:\/\/(?!gateway-api-testnet\.circle\.com)/);
      expect(call.url).not.toContain("localhost");
      expect(call.url).not.toContain("evil");
    }
    expectGlobalFetchNeverCalled();
  });

  test("malformed nonce/transferId are rejected locally with ZERO fetch calls", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => jsonResponse(SETTLE_SUCCESS_WIRE));
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const badNonceResults = await Promise.all([
      client.listTransfersByNonce("abc"),
      client.listTransfersByNonce(`0x${"AA".repeat(32)}`),
      client.listTransfersByNonce(`0x${"ab".repeat(31)}`),
      client.listTransfersByNonce("https://gateway-api.circle.com/v1/x402/transfers?nonce=x"),
      client.listTransfersByNonce("../../../etc/passwd")
    ]);
    for (const result of badNonceResults) {
      expect(result).toEqual({
        kind: "unknown",
        reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
        httpStatus: null
      });
    }

    const badIdResults = await Promise.all([
      client.getTransfer("abc"),
      client.getTransfer(`0x${"ab".repeat(32)}`),
      client.getTransfer("../../admin"),
      client.getTransfer(
        "http://localhost:9999/v1/x402/transfers/123e4567-e89b-12d3-a456-426614174000"
      )
    ]);
    for (const result of badIdResults) {
      expect(result).toEqual({
        kind: "unknown",
        reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
        httpStatus: null
      });
    }

    expect(calls).toHaveLength(0);
    expectGlobalFetchNeverCalled();
  });

  test("default fetchImpl uses platform fetch (stubbed) and still only the pinned origin", async () => {
    let seenUrl: string | null = null;
    const platformMock = vi.fn(async (url: string) => {
      seenUrl = url;
      return jsonResponse(SETTLE_SUCCESS_WIRE);
    });
    vi.stubGlobal("fetch", platformMock);
    const client = createGatewayTestnetClient({ timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result.kind).toBe("response");
    expect(platformMock).toHaveBeenCalledTimes(1);
    expect(seenUrl).toBe(`${GATEWAY_TESTNET_ORIGIN}${GATEWAY_SETTLE_PATH}`);
  });

  test("createGatewayTestnetClient rejects a non-positive timeoutMs", () => {
    expect(() => createGatewayTestnetClient({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => createGatewayTestnetClient({ timeoutMs: -5 })).toThrow(RangeError);
    expect(() => createGatewayTestnetClient({ timeoutMs: 1.5 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Client - failure classification and transport safety.
// ---------------------------------------------------------------------------

describe("GatewayTestnetClient failure classification", () => {
  test("redirect (300-399 status) -> X402_GATEWAY_REDIRECT_REJECTED, never followed", async () => {
    const { calls, fetchImpl } = recordingFetch(async () =>
      jsonResponse({}, { status: 302, contentType: "text/html" })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_REDIRECT_REJECTED",
      httpStatus: 302
    });
    expect(calls).toHaveLength(1); // the redirect target is never fetched
    expectGlobalFetchNeverCalled();
  });

  test("fetch throwing a redirect rejection -> X402_GATEWAY_REDIRECT_REJECTED, one call", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => {
      throw new TypeError("Request would redirect to https://evil.example/steal");
    });
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.getTransfer("123e4567-e89b-12d3-a456-426614174000");

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_REDIRECT_REJECTED",
      httpStatus: null
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.redirect).toBe("error");
    expectGlobalFetchNeverCalled();
  });

  test("timeout -> X402_GATEWAY_TRANSPORT_TIMEOUT, httpStatus null, EXACTLY ONE fetch call (no retry)", async () => {
    let calls = 0;
    const hangingFetch: GatewayFetchLike = (url, init) => {
      calls += 1;
      // NOTE: executor form is required here because Promise.withResolvers is
      // not available under this repo's `lib: ["dom", "dom.iterable", "ES2022"]`
      // (it lives in lib.es2024.promise.d.ts).
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        });
      });
    };
    const client = createGatewayTestnetClient({ fetchImpl: hangingFetch, timeoutMs: 40 });

    const startedAt = Date.now();
    const result = await client.settle(makeSettleRequest());
    const elapsed = Date.now() - startedAt;

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_TRANSPORT_TIMEOUT",
      httpStatus: null
    });
    expect(calls).toBe(1); // no retry, no backoff, no automatic re-send
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expectGlobalFetchNeverCalled();
  });

  test("caller-provided already-aborted signal -> no request issued", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => jsonResponse(SETTLE_SUCCESS_WIRE));
    const controller = new AbortController();
    controller.abort();
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.listTransfersByNonce(`0x${"aa".repeat(32)}`, controller.signal);

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
      httpStatus: null
    });
    expect(calls).toHaveLength(0);
    expectGlobalFetchNeverCalled();
  });

  test("fetch rejection (connection reset / DNS failure) -> X402_GATEWAY_TRANSPORT_FAILURE, one call", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => {
      throw new TypeError("fetch failed: connection reset");
    });
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());
    const listResult = await client.listTransfersByNonce(`0x${"aa".repeat(32)}`);

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
      httpStatus: null
    });
    expect(listResult).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
      httpStatus: null
    });
    expect(calls).toHaveLength(2);
    expectGlobalFetchNeverCalled();
  });

  test("non-JSON content type -> X402_GATEWAY_RESPONSE_INVALID (no guessing)", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({ message: "ok" }, { contentType: "text/plain" })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_INVALID",
      httpStatus: 200
    });
    expectGlobalFetchNeverCalled();
  });

  test("malformed JSON body -> X402_GATEWAY_RESPONSE_INVALID", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse(null, { textBody: "{not json" })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_INVALID",
      httpStatus: 200
    });
    expectGlobalFetchNeverCalled();
  });

  test("contract-invalid JSON body -> X402_GATEWAY_RESPONSE_INVALID", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({ success: true, transaction: "nope", network: "eip155:1" })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_INVALID",
      httpStatus: 200
    });
    expectGlobalFetchNeverCalled();
  });

  test("declared content-length over the bound -> X402_GATEWAY_RESPONSE_TOO_LARGE without reading text()", async () => {
    const response = wrapTextCounter(
      jsonResponse(SETTLE_SUCCESS_WIRE, {
        contentLength: String(GATEWAY_MAX_RESPONSE_BYTES + 1)
      })
    );
    const { calls, fetchImpl } = recordingFetch(async () => response);
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_TOO_LARGE",
      httpStatus: 200
    });
    expect(calls).toHaveLength(1);
    expect(response.textCallCount()).toBe(0); // rejected from the header alone
    expectGlobalFetchNeverCalled();
  });

  test("actual body over the bound -> X402_GATEWAY_RESPONSE_TOO_LARGE (no content-length)", async () => {
    const oversizedBody = JSON.stringify({
      transfers: [
        {
          ...TRANSFER_SNAPSHOT_BODY,
          amount: `1${"0".repeat(GATEWAY_MAX_RESPONSE_BYTES)}`
        }
      ]
    });
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse(null, { textBody: oversizedBody })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.listTransfersByNonce(`0x${"aa".repeat(32)}`);

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_TOO_LARGE",
      httpStatus: 200
    });
    expectGlobalFetchNeverCalled();
  });

  test("getTransfer 404 -> not_found, body never parsed", async () => {
    const { calls, fetchImpl } = recordingFetch(async () =>
      jsonResponse({}, { status: 404, contentType: "text/plain" })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.getTransfer("123e4567-e89b-12d3-a456-426614174000");

    expect(result).toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(1);
    expectGlobalFetchNeverCalled();
  });

  test("a 4xx/5xx body that validates -> kind response with the httpStatus preserved", async () => {
    const { fetchImpl } = recordingFetch(async (url) => {
      if (url.includes(GATEWAY_SETTLE_PATH)) {
        return jsonResponse(
          {
            success: false,
            transaction: "",
            network: "eip155:5042002",
            errorReason: "unsupported_scheme"
          },
          { status: 400 }
        );
      }
      return jsonResponse({ transfers: [TRANSFER_SNAPSHOT_BODY] }, { status: 500 });
    });
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const settleResult = await client.settle(makeSettleRequest());
    const listResult = await client.listTransfersByNonce(`0x${"aa".repeat(32)}`);

    expect(settleResult).toEqual({
      kind: "response",
      httpStatus: 400,
      response: {
        success: false,
        transaction: "",
        network: "eip155:5042002",
        errorReason: "unsupported_scheme",
        payerAddress: null
      }
    });
    expect(listResult).toEqual({
      kind: "response",
      httpStatus: 500,
      transfers: [validateGatewayTransferSnapshot(TRANSFER_SNAPSHOT_BODY)]
    });
    expectGlobalFetchNeverCalled();
  });

  test("listTransfersByNonce with a 404 -> unknown RESPONSE_INVALID (404 is only special for getTransfer)", async () => {
    const { fetchImpl } = recordingFetch(async () =>
      jsonResponse({}, { status: 404, contentType: "text/plain" })
    );
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.listTransfersByNonce(`0x${"aa".repeat(32)}`);

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_INVALID",
      httpStatus: 404
    });
    expectGlobalFetchNeverCalled();
  });

  test("transport NEVER logs: no console output during settle with a canary payload body", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { fetchImpl } = recordingFetch(async () => {
      throw new TypeError("fetch failed: connection reset");
    });
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });
    const request = makeSettleRequest();

    const result = await client.settle(request);
    // Malformed nonce attempt as well - nothing may be logged either.
    await client.listTransfersByNonce(`${CANARY}?secret=${CANARY}`);

    expect(result.kind).toBe("unknown");
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();

    // The result object must not echo the request body (only stable reason codes).
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(JSON.stringify(result)).not.toContain("paymentPayload");
    expectGlobalFetchNeverCalled();
  });

  test("mock fetch was ALWAYS the injected transport - the global guard never fired across the suite", () => {
    expect(globalFetchGuard).not.toHaveBeenCalled();
  });

  test("GatewayContractError carries the stable machine-readable code", () => {
    try {
      validateGatewaySettleResponse({ success: true });
      throw new Error("expected validation to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayContractError);
      const contractError = error as GatewayContractError;
      expect(contractError.code).toBe("GATEWAY_CONTRACT_FIELD_MISSING");
      expect(contractError.message).not.toContain(CANARY);
    }
  });
});

// ---------------------------------------------------------------------------
// Client - bounded STREAMING read (the cap applies BEFORE unbounded buffering).
// ---------------------------------------------------------------------------

const CHUNK_BYTES = 131072; // 128 KiB: two chunks fit under the cap, a third busts it.

/** Valid settle JSON padded with trailing whitespace to an exact byte length. */
function paddedSettleBody(totalBytes: number): string {
  const json = JSON.stringify(SETTLE_SUCCESS_WIRE);
  if (json.length > totalBytes) {
    throw new Error("settle fixture is larger than the requested body size");
  }
  return json + " ".repeat(totalBytes - json.length);
}

function asciiChunks(text: string, chunkBytes: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    chunks.push(bytes.slice(offset, offset + chunkBytes));
  }
  return chunks;
}

type StreamState = {
  receivedBytes: number;
  cancelCount: number;
  textCalls: number;
};

/**
 * A streamed settle response with NO content-length header - exactly the
 * forged/missing-declared-size case a pre-read header check cannot catch.
 * `failPullAfter` makes the source throw mid-read after N delivered chunks.
 */
function streamSettleResponse(
  chunks: Uint8Array[],
  options: { failPullAfter?: number } = {}
): { response: GatewayFetchResponse; state: StreamState } {
  const state: StreamState = { receivedBytes: 0, cancelCount: 0, textCalls: 0 };
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller): Promise<void> {
      if (options.failPullAfter !== undefined && index >= options.failPullAfter) {
        return Promise.reject(new TypeError("connection reset mid-body"));
      }
      if (index >= chunks.length) {
        controller.close();
        return Promise.resolve();
      }
      state.receivedBytes += chunks[index].byteLength;
      controller.enqueue(chunks[index]);
      index += 1;
      return Promise.resolve();
    },
    cancel(): void {
      state.cancelCount += 1;
    }
  });
  const response: GatewayFetchResponse = {
    status: 200,
    headers: makeHeaders({ "content-type": "application/json" }),
    text: async () => {
      state.textCalls += 1;
      return JSON.stringify(SETTLE_SUCCESS_WIRE);
    },
    body
  };
  return { response, state };
}

describe("GatewayTestnetClient bounded streaming read", () => {
  test("oversized stream with forged content-length: capped before buffering, reader cancelled, text() never called", async () => {
    // 6 x 128 KiB of JSON-prefixed garbage with NO content-length header:
    // a header-only pre-check is useless here, and unbounded text() would
    // buffer ~768 KiB. The streaming bound must stop at cap + one chunk.
    const { response, state } = streamSettleResponse(
      asciiChunks(paddedSettleBody(CHUNK_BYTES * 6), CHUNK_BYTES)
    );
    const { calls, fetchImpl } = recordingFetch(async () => response);
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_TOO_LARGE",
      httpStatus: 200
    });
    expect(state.cancelCount).toBe(1); // reader.cancel() reached the source
    expect(state.textCalls).toBe(0); // the oversized body was never buffered
    expect(state.receivedBytes).toBeGreaterThan(GATEWAY_MAX_RESPONSE_BYTES);
    expect(state.receivedBytes).toBeLessThanOrEqual(GATEWAY_MAX_RESPONSE_BYTES + CHUNK_BYTES);
    expect(calls).toHaveLength(1); // still exactly one fetch call, no retry
    expectGlobalFetchNeverCalled();
  });

  test("exactly GATEWAY_MAX_RESPONSE_BYTES of valid JSON is accepted (inclusive-safe boundary)", async () => {
    const content = paddedSettleBody(GATEWAY_MAX_RESPONSE_BYTES);
    expect(new TextEncoder().encode(content).byteLength).toBe(GATEWAY_MAX_RESPONSE_BYTES);
    const { response, state } = streamSettleResponse(asciiChunks(content, CHUNK_BYTES));
    const { calls, fetchImpl } = recordingFetch(async () => response);
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({ kind: "response", httpStatus: 200, response: SETTLE_SUCCESS_BODY });
    expect(state.receivedBytes).toBe(GATEWAY_MAX_RESPONSE_BYTES);
    expect(state.cancelCount).toBe(0);
    expect(state.textCalls).toBe(0); // decoded from the bounded chunks
    expect(calls).toHaveLength(1);
    expectGlobalFetchNeverCalled();
  });

  test("cap+1 bytes is rejected as X402_GATEWAY_RESPONSE_TOO_LARGE", async () => {
    // 4 x 64 KiB chunks + 1 trailing byte: the running total busts the cap by
    // exactly one byte on the final read.
    const content = paddedSettleBody(GATEWAY_MAX_RESPONSE_BYTES + 1);
    const { response, state } = streamSettleResponse(asciiChunks(content, 65536));
    const { calls, fetchImpl } = recordingFetch(async () => response);
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_RESPONSE_TOO_LARGE",
      httpStatus: 200
    });
    expect(state.receivedBytes).toBe(GATEWAY_MAX_RESPONSE_BYTES + 1);
    expect(state.cancelCount).toBe(1);
    expect(state.textCalls).toBe(0);
    expect(calls).toHaveLength(1);
    expectGlobalFetchNeverCalled();
  });

  test("stream that throws mid-read -> X402_GATEWAY_TRANSPORT_FAILURE, no partial parse, one call", async () => {
    const { response, state } = streamSettleResponse(
      asciiChunks(paddedSettleBody(GATEWAY_MAX_RESPONSE_BYTES), CHUNK_BYTES),
      { failPullAfter: 1 }
    );
    const { calls, fetchImpl } = recordingFetch(async () => response);
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
      httpStatus: 200
    });
    expect(state.textCalls).toBe(0); // never a crash, never a partial parse
    expect(calls).toHaveLength(1);
    expectGlobalFetchNeverCalled();
  });

  test("body:null responses keep using the unchanged text() fallback", async () => {
    let textCalls = 0;
    const fallback: GatewayFetchResponse = {
      status: 200,
      headers: makeHeaders({ "content-type": "application/json" }),
      text: async () => {
        textCalls += 1;
        return JSON.stringify(SETTLE_SUCCESS_WIRE);
      },
      body: null
    };
    const { calls, fetchImpl } = recordingFetch(async () => fallback);
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 500 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({ kind: "response", httpStatus: 200, response: SETTLE_SUCCESS_BODY });
    expect(textCalls).toBe(1); // fallback path consumed text() exactly as before
    expect(calls).toHaveLength(1);
    expectGlobalFetchNeverCalled();
  });

  test("timeout while a streaming body is stalled -> TIMEOUT on the stream path, ONE fetch call", async () => {
    // Platform fetch errors the body stream when the request signal aborts;
    // the mock mirrors exactly that (an ignored never-resolving pull would
    // just hang, so abort must surface as a read rejection).
    const { calls, fetchImpl } = recordingFetch(async (_url, init) => {
      let pendingController: ReadableStreamDefaultController<Uint8Array> | null = null;
      let pullCount = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller): void {
          pendingController = controller;
        },
        pull(controller): void {
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(new TextEncoder().encode("{}"));
          }
          // Afterwards: stalled server - delivers nothing more.
        }
      });
      init.signal.addEventListener(
        "abort",
        () => {
          pendingController?.error(new Error("aborted"));
        },
        { once: true }
      );
      return {
        status: 200,
        headers: makeHeaders({ "content-type": "application/json" }),
        text: async () => "{}",
        body
      };
    });
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 40 });

    const result = await client.settle(makeSettleRequest());

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_TRANSPORT_TIMEOUT",
      httpStatus: 200
    });
    expect(calls).toHaveLength(1); // no retry, ever
    expectGlobalFetchNeverCalled();
  });

  test("caller abort while a streaming body is stalled -> TRANSPORT_FAILURE, never a timeout label", async () => {
    // Deterministic trigger (no wall-clock sleep): the SECOND pull is the
    // moment the caller cancels - exactly when the client sits on reader.read().
    const caller = new AbortController();
    const { calls, fetchImpl } = recordingFetch(async (_url, init) => {
      let pendingController: ReadableStreamDefaultController<Uint8Array> | null = null;
      let pullCount = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller): void {
          pendingController = controller;
        },
        pull(controller): void {
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(new TextEncoder().encode("{}"));
            return;
          }
          caller.abort(); // the real event the test waits on
        }
      });
      init.signal.addEventListener(
        "abort",
        () => {
          pendingController?.error(new Error("aborted"));
        },
        { once: true }
      );
      return {
        status: 200,
        headers: makeHeaders({ "content-type": "application/json" }),
        text: async () => "{}",
        body
      };
    });
    // The internal timer is effectively never reached (huge budget); only the
    // caller cancel can end this read, and it must not be mislabeled TIMEOUT.
    const client = createGatewayTestnetClient({ fetchImpl, timeoutMs: 60_000 });

    const result = await client.settle(makeSettleRequest(), caller.signal);

    expect(result).toEqual({
      kind: "unknown",
      reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
      httpStatus: 200
    });
    expect(calls).toHaveLength(1);
    expectGlobalFetchNeverCalled();
  });

});