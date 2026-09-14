/**
 * I5 — the ONLY operator-authorized live Gateway transport gate.
 *
 * This is the single way to obtain a live (real `globalThis.fetch`) Circle
 * Gateway testnet transport in this codebase. It exists exclusively for
 * operator-authorized I6 execution, driven by `scripts/x402-gateway-testnet.mjs`
 * (via `scripts/x402-gateway-testnet-runner.ts`).
 *
 * It is keyless: the Gateway API is permissionless (no API key) and the
 * EIP-3009 private key never leaves the external signer process
 * (`scripts/x402-external-signer.mjs`). This module handles no secrets and
 * makes no network call by itself — constructing a client binds no socket;
 * the first request is made only by an explicit orchestration call.
 *
 * IMPORT BOUNDARY (I5 security contract, verified statically by
 * `tests/x402-gateway-operator-script.test.ts`):
 *   - NOTHING under `src/app/**` may import this module;
 *   - it must never be reachable from a public API route or the UI;
 *   - automated tests, CI, and `pnpm smoke` must never construct the
 *     authorized branch — the refusal path is the only path tests exercise.
 *
 * The transport returned by the authorized branch is the standard
 * `createGatewayTestnetClient()` with no injected fetch: the host is already
 * pinned inside the client to `https://gateway-api-testnet.circle.com`
 * (Arc Testnet only; mainnet is forbidden in this track), so there is no
 * baseUrl to pass and no way for an operator flag to redirect the transport.
 */
import {
  createGatewayTestnetClient,
  type GatewayTestnetClient
} from "@/integrations/circle-gateway/testnet-client";
import { X402_GATEWAY_OPERATOR_AUTH_REQUIRED } from "./gateway-reason-codes";

/** Exact name of the operator live-payment environment switch. */
export const AGENTPAY_LIVE_PAYMENT_ENV = "AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT";

/**
 * True ONLY when `AGENTPAY_ALLOW_LIVE_ARC_TESTNET_PAYMENT` is exactly the
 * string "true". Anything else — unset, empty, "1", "TRUE", "yes" — is a
 * refusal. There is no secondary/implicit authorization.
 */
export function liveTestnetPaymentAuthorized(env: Record<string, string | undefined>): boolean {
  return env[AGENTPAY_LIVE_PAYMENT_ENV] === "true";
}

/**
 * Operator-gated live transport factory.
 *
 * - Refused (default): returns `{ kind: "refused", reasonCode:
 *   "X402_GATEWAY_OPERATOR_AUTH_REQUIRED" }`. NO client object is constructed
 *   and NO fetch binding is created on this path.
 * - Authorized (operator explicitly enabled the env switch): returns the real
 *   platform-fetch `GatewayTestnetClient` (host-pinned Gateway testnet).
 */
export function createLiveGatewayTestnetClient(
  env: Record<string, string | undefined>
):
  | { kind: "authorized"; client: GatewayTestnetClient }
  | { kind: "refused"; reasonCode: typeof X402_GATEWAY_OPERATOR_AUTH_REQUIRED } {
  if (!liveTestnetPaymentAuthorized(env)) {
    return { kind: "refused", reasonCode: X402_GATEWAY_OPERATOR_AUTH_REQUIRED };
  }
  return { kind: "authorized", client: createGatewayTestnetClient() };
}
