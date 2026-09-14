/**
 * I5 — Circle Gateway testnet x402 transport (pre-Phase-9 Circle integration
 * track). Keyless HTTP transport for the official Gateway x402 endpoints
 * (https://developers.circle.com/openapi/gateway.yaml, accessed 2026-09-14).
 *
 * SECURITY BOUNDARY: this client is KEYLESS — Circle's Gateway x402 endpoints
 * are permissionless (`security: []` in the official OpenAPI). The client
 * NEVER receives, holds, or transmits a private key; the private key boundary
 * stays in the I4 external signer process. The payer's signed
 * `paymentPayload` is passed through untouched only as part of the settle
 * request body.
 *
 * HOST PINNING: the origin is compile-pinned to GATEWAY_TESTNET_ORIGIN. There
 * is no `baseUrl`/`gatewayUrl`/`host` option, and caller input can never
 * influence the origin: nonce and transferId are strictly pattern-validated
 * BEFORE URL construction, and URLs are built only by concatenating the
 * pinned origin with fixed constant paths. Only HTTPS is ever attempted.
 *
 * FAIL-SAFE TRANSPORT: no retries (ever — one fetch call per method call),
 * `redirect: "error"` on every request, bounded timeout, bounded response
 * size, strict JSON content-type handling, and contract validation of every
 * body. Outcomes are stable reason codes, never thrown exceptions and never
 * raw bodies. No logging anywhere in this module (no console.*); nothing is
 * ever persisted.
 */
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
} from "./contracts";

/**
 * Default per-request timeout (10 s). Rationale: the Gateway x402 settle path
 * performs signature verification and batch queueing server-side; a 10 s
 * deadline covers normal processing while keeping the pilot's wait bounded,
 * and is deliberately shorter than the official `maxTimeoutSeconds` (604900)
 * observed in integration-feasibility so an unresponsive gateway is surfaced
 * fast instead of hanging the caller. Callers may override via
 * `createGatewayTestnetClient({ timeoutMs })` — a single bounded value per
 * client, never per request.
 */
export const GATEWAY_TESTNET_DEFAULT_TIMEOUT_MS = 10000;

/**
 * Hard response size bound: 256 KiB. A transfer list page is small (a few
 * transfer objects), and settle bodies are ~200 B; 256 KiB is far beyond any
 * legitimate payload while defeating memory exhaustion via an unbounded body.
 * Enforced BEFORE unbounded buffering: the `content-length` pre-check rejects
 * declared oversize without reading, and the body is consumed through a
 * BOUNDED STREAMING READ that cancels as soon as the running byte total
 * exceeds this cap. The boundary is inclusive-safe: exactly `cap` bytes is
 * accepted; only strictly-greater is rejected.
 */
export const GATEWAY_MAX_RESPONSE_BYTES = 262144;

/** Request init shape the client hands to platform fetch or an injected mock. */
type GatewayFetchInit = {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  redirect: "error";
  signal: AbortSignal;
};

/**
 * Minimal HTTP response shape consumed by the client. `body` is OPTIONAL so
 * minimal mocks that implement only `text()` keep working; when present the
 * body is read through a bounded streaming read so the 256 KiB cap is applied
 * BEFORE the bytes are buffered (a forged/missing `content-length` cannot
 * force an unbounded `text()` allocation).
 */
export type GatewayFetchResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
};

/** Minimal fetch shape this client requires from platform fetch or an injected mock. */
export type GatewayFetchLike = (
  url: string,
  init: GatewayFetchInit
) => Promise<GatewayFetchResponse>;

export type GatewayTransportReasonCode =
  | "X402_GATEWAY_TRANSPORT_TIMEOUT"
  | "X402_GATEWAY_TRANSPORT_FAILURE"
  | "X402_GATEWAY_RESPONSE_INVALID"
  | "X402_GATEWAY_RESPONSE_TOO_LARGE"
  | "X402_GATEWAY_REDIRECT_REJECTED";

export type GatewaySettleCallResult =
  | { readonly kind: "response"; readonly httpStatus: number; readonly response: GatewaySettleResponse }
  | { readonly kind: "unknown"; readonly reasonCode: GatewayTransportReasonCode; readonly httpStatus: number | null };

export type GatewayTransferListCallResult =
  | { readonly kind: "response"; readonly httpStatus: number; readonly transfers: readonly GatewayTransferSnapshot[] }
  | { readonly kind: "unknown"; readonly reasonCode: GatewayTransportReasonCode; readonly httpStatus: number | null };

export type GatewayTransferCallResult =
  | { readonly kind: "response"; readonly httpStatus: number; readonly transfer: GatewayTransferSnapshot }
  | { readonly kind: "not_found" }
  | { readonly kind: "unknown"; readonly reasonCode: GatewayTransportReasonCode; readonly httpStatus: number | null };

export interface GatewayTestnetClient {
  settle(request: GatewaySettleRequest, signal?: AbortSignal): Promise<GatewaySettleCallResult>;
  listTransfersByNonce(nonce: string, signal?: AbortSignal): Promise<GatewayTransferListCallResult>;
  getTransfer(transferId: string, signal?: AbortSignal): Promise<GatewayTransferCallResult>;
}

/**
 * Pre-flight input patterns. These are the ONLY gate between caller input and
 * the URL path: anything that fails is rejected locally with zero network
 * calls, so caller input can never smuggle a different origin, path, or query.
 */
const NONCE_PATTERN = /^0x[0-9a-f]{64}$/;
const TRANSFER_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isRedirectRejection(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const haystack = `${error.name} ${error.message}`;
  return /redirect/i.test(haystack);
}

function declaredContentLengthTooLarge(headers: { get(name: string): string | null }): boolean {
  const header = headers.get("content-length");
  if (header === null) {
    return false;
  }
  if (!/^\d+$/.test(header)) {
    // Non-numeric content-length: not a usable bound. Do not guess — it is
    // treated as absent and the actual body length still gets validated.
    return false;
  }
  return Number.parseInt(header, 10) > GATEWAY_MAX_RESPONSE_BYTES;
}

type WireOutcome =
  | { ok: true; status: number; json: unknown }
  | { ok: false; reasonCode: GatewayTransportReasonCode; status: number | null };

/**
 * One bounded, non-retrying HTTP round trip. Never throws for network or HTTP
 * outcomes; contract errors thrown by the caller's body builder are mapped to
 * X402_GATEWAY_TRANSPORT_FAILURE (the request never left the process). Exactly
 * ONE fetch call is ever made per invocation — no retry, no backoff, no
 * automatic re-send under any circumstance.
 */
async function roundTrip(
  fetchImpl: GatewayFetchLike,
  timeoutMs: number,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
  callerSignal?: AbortSignal
): Promise<WireOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;

  const abortFromCaller = () => {
    if (!controller.signal.aborted && !timedOut) {
      callerAborted = true;
      controller.abort();
    }
  };
  if (callerSignal?.aborted) {
    // Caller already canceled; do not issue the request at all.
    return { ok: false, reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE", status: null };
  }
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: GatewayFetchResponse;
    try {
      response = await fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        redirect: "error",
        signal: controller.signal
      });
    } catch (error) {
      // Abort-source discrimination: a caller-initiated abort is NEVER
      // mislabeled as a timeout, even when it races the internal timer.
      if (!callerAborted && timedOut) {
        return { ok: false, reasonCode: "X402_GATEWAY_TRANSPORT_TIMEOUT", status: null };
      }
      if (!callerAborted && isRedirectRejection(error)) {
        return { ok: false, reasonCode: "X402_GATEWAY_REDIRECT_REJECTED", status: null };
      }
      // DNS / connect / TLS / reset / caller-abort: never retried.
      return { ok: false, reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE", status: null };
    }

    // With redirect:"error" a compliant fetch never resolves to a 3xx; defend
    // regardless — never read nor follow a redirect body.
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, reasonCode: "X402_GATEWAY_REDIRECT_REJECTED", status: response.status };
    }

    const contentType = response.headers.get("content-type");
    if (contentType === null || !contentType.toLowerCase().includes("application/json")) {
      return { ok: false, reasonCode: "X402_GATEWAY_RESPONSE_INVALID", status: response.status };
    }
    if (declaredContentLengthTooLarge(response.headers)) {
      return { ok: false, reasonCode: "X402_GATEWAY_RESPONSE_TOO_LARGE", status: response.status };
    }

    // The 256 KiB cap is applied BEFORE unbounded buffering: whenever the
    // implementation exposes the body stream, read it bounded and cancel on
    // overflow. Only the fallback (no stream) reads text() and measures.
    let text: string;
    if (response.body) {
      const bounded = await readBoundedStreamText(response.body);
      if (!bounded.ok) {
        if (bounded.reason === "too-large") {
          return {
            ok: false,
            reasonCode: "X402_GATEWAY_RESPONSE_TOO_LARGE",
            status: response.status
          };
        }
        // Mid-stream read error (connection reset, or the composed abort
        // signal firing): never a crash, never a partial JSON parse. A
        // caller-initiated abort is never mislabeled as a timeout.
        if (timedOut && !callerAborted) {
          return {
            ok: false,
            reasonCode: "X402_GATEWAY_TRANSPORT_TIMEOUT",
            status: response.status
          };
        }
        return {
          ok: false,
          reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE",
          status: response.status
        };
      }
      text = bounded.text;
    } else {
      // Fallback path (unchanged): minimal mocks and other fetch
      // implementations may not expose a body stream, so we must consume
      // text(). The content-length pre-check above still rejects declared
      // oversize before any read, and the actual length is verified here.
      try {
        text = await response.text();
      } catch {
        // Body read failed after headers arrived (connection reset): transport-level.
        return { ok: false, reasonCode: "X402_GATEWAY_TRANSPORT_FAILURE", status: response.status };
      }
      if (new TextEncoder().encode(text).byteLength > GATEWAY_MAX_RESPONSE_BYTES) {
        return { ok: false, reasonCode: "X402_GATEWAY_RESPONSE_TOO_LARGE", status: response.status };
      }
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reasonCode: "X402_GATEWAY_RESPONSE_INVALID", status: response.status };
    }

    return { ok: true, status: response.status, json };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Bounded streaming read: accumulate chunks while tracking the running byte
 * total, and STOP (cancel the reader) as soon as the total strictly exceeds
 * GATEWAY_MAX_RESPONSE_BYTES — without ever calling text() and without
 * decoding the oversized body. Only the accumulated (bounded) bytes are
 * decoded. read() errors are reported, never thrown.
 */
async function readBoundedStreamText(
  body: ReadableStream<Uint8Array>
): Promise<
  { ok: true; text: string } | { ok: false; reason: "too-large" | "read-failed" }
> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        return { ok: false, reason: "read-failed" };
      }
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > GATEWAY_MAX_RESPONSE_BYTES) {
        // Inclusive-safe: exactly the cap is accepted; strictly-more is not.
        // Cancel before decoding — the oversized bytes are never buffered.
        try {
          await reader.cancel();
        } catch {
          /* best-effort cancel; the outcome is already decided */
        }
        return { ok: false, reason: "too-large" };
      }
      chunks.push(result.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released by cancel()/error; never mask the outcome */
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

const unknownResult = (
  reasonCode: GatewayTransportReasonCode,
  status: number | null
): { kind: "unknown"; reasonCode: GatewayTransportReasonCode; httpStatus: number | null } => ({
  kind: "unknown",
  reasonCode,
  httpStatus: status
});

export function createGatewayTestnetClient(options?: {
  fetchImpl?: GatewayFetchLike;
  timeoutMs?: number;
}): GatewayTestnetClient {
  const fetchImpl: GatewayFetchLike =
    options?.fetchImpl ??
    // Platform fetch only — no new HTTP dependency. globalThis.fetch's
    // `Response` is structurally compatible with the minimal GatewayFetchResponse.
    ((url: string, init: GatewayFetchInit) => globalThis.fetch(url, init));

  const timeoutMs = options?.timeoutMs ?? GATEWAY_TESTNET_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError(
      "createGatewayTestnetClient: timeoutMs must be a positive safe integer."
    );
  }

  return {
    async settle(request, signal) {
      let body: string;
      try {
        body = buildGatewaySettleRequestBody(request);
      } catch (error) {
        if (error instanceof GatewayContractError) {
          return unknownResult("X402_GATEWAY_TRANSPORT_FAILURE", null);
        }
        throw error;
      }

      const outcome = await roundTrip(
        fetchImpl,
        timeoutMs,
        `${GATEWAY_TESTNET_ORIGIN}${GATEWAY_SETTLE_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body
        },
        signal
      );
      if (!outcome.ok) {
        return unknownResult(outcome.reasonCode, outcome.status);
      }
      try {
        const response = validateGatewaySettleResponse(outcome.json);
        return { kind: "response", httpStatus: outcome.status, response };
      } catch (error) {
        if (error instanceof GatewayContractError) {
          return unknownResult("X402_GATEWAY_RESPONSE_INVALID", outcome.status);
        }
        throw error;
      }
    },

    async listTransfersByNonce(nonce, signal) {
      if (!NONCE_PATTERN.test(nonce)) {
        // Fail-closed local rejection BEFORE any URL construction: malformed
        // nonce input can never reach the wire or smuggle a query/path.
        return unknownResult("X402_GATEWAY_TRANSPORT_FAILURE", null);
      }

      const outcome = await roundTrip(
        fetchImpl,
        timeoutMs,
        `${GATEWAY_TESTNET_ORIGIN}${GATEWAY_TRANSFERS_PATH}?nonce=${nonce}`,
        {
          method: "GET",
          headers: { accept: "application/json" }
        },
        signal
      );
      if (!outcome.ok) {
        return unknownResult(outcome.reasonCode, outcome.status);
      }
      try {
        const transfers = parseGatewayTransfersListResponse(outcome.json);
        return { kind: "response", httpStatus: outcome.status, transfers };
      } catch (error) {
        if (error instanceof GatewayContractError) {
          return unknownResult("X402_GATEWAY_RESPONSE_INVALID", outcome.status);
        }
        throw error;
      }
    },

    async getTransfer(transferId, signal) {
      if (!TRANSFER_ID_PATTERN.test(transferId)) {
        // Fail-closed local rejection BEFORE any URL construction: a malformed
        // transferId can never smuggle a path segment, origin, or query.
        return unknownResult("X402_GATEWAY_TRANSPORT_FAILURE", null);
      }

      const outcome = await roundTrip(
        fetchImpl,
        timeoutMs,
        `${GATEWAY_TESTNET_ORIGIN}${GATEWAY_TRANSFERS_PATH}/${transferId}`,
        {
          method: "GET",
          headers: { accept: "application/json" }
        },
        signal
      );
      if (!outcome.ok) {
        if (
          outcome.reasonCode === "X402_GATEWAY_RESPONSE_INVALID" &&
          outcome.status === 404
        ) {
          // Official: GET /v1/x402/transfers/{id} → 404 "Transfer not found".
          return { kind: "not_found" };
        }
        return unknownResult(outcome.reasonCode, outcome.status);
      }
      if (outcome.status === 404) {
        // Official: 404 = "Transfer not found" — never attempt a body parse.
        return { kind: "not_found" };
      }
      try {
        const transfer = validateGatewayTransferSnapshot(outcome.json);
        return { kind: "response", httpStatus: outcome.status, transfer };
      } catch (error) {
        if (error instanceof GatewayContractError) {
          return unknownResult("X402_GATEWAY_RESPONSE_INVALID", outcome.status);
        }
        throw error;
      }
    }
  };
}