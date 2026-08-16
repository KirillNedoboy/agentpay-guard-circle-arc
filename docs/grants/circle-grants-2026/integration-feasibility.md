# Integration Feasibility — AgentPay Guard → ExecutionAuthorization → Circle Gateway / x402 → Arc Testnet

Status: **PROPOSED / NOT IMPLEMENTED**. This document is a research and
architecture decision record. No integration exists in this repository. Nothing
in this document was executed; no payment was sent; no wallet was created; no
private key was handled. Research findings are labeled VERIFIED EXTERNAL
TECHNICAL FACT where they come from the official sources listed in
[Verified Official Sources](#verified-official-sources); the AgentPay
integration itself is PROPOSED only.

# Decision Summary

**Decision: GO WITH BLOCKERS.**

An officially supported technical path exists end-to-end: Circle Gateway's x402
nanopayments interface explicitly supports **Arc Testnet** (`eip155:5042002`,
`SupportedChainName: arcTestnet`, nanopayments: Yes), the Gateway API is
permissionless (no API key, no sign-up), and the signing that authorizes a
payment is an EIP-3009 signature made by a buyer **EOA outside** AgentPay Guard
core. AgentPay Guard can therefore remain completely keyless. The blockers are
concrete implementation work — the 14 unchecked future-execution preconditions
in the threat model, a durable execution/idempotency record, an exact
payment-requirement binding, an external-signer adapter, and settlement
evidence capture — none of which require turning AgentPay Guard into a custody
or payment platform.

External grant-strengthening work in parallel: 1–2 design-partner conversations.
This is a manual/user activity. It is not an implementation result.

# Verified Official Sources

All external facts in this document were read directly from the sources below
on **2026-08-16** (access/verification date). Facts marked `[S#]` in the text
refer to this list.

| # | Source URL | Page title | Key facts supported |
| --- | --- | --- | --- |
| S1 | https://docs.x402.org/ | Welcome to x402 (official x402 docs) | HTTP 402-based open payment standard; client/server/facilitator flow; docs are the "credibly neutral source of truth" for x402, Apache-2.0. |
| S2 | https://docs.x402.org/llms.txt | x402 documentation index | Full official page inventory: core concepts, schemes (exact/upto/batch-settlement), payment-identifier extension, wallet, facilitator, migration V1→V2. |
| S3 | https://docs.x402.org/core-concepts/http-402.md | HTTP 402 (official x402 docs) | V2 uses three headers: `PAYMENT-REQUIRED` (server→client), `PAYMENT-SIGNATURE` (client→server), `PAYMENT-RESPONSE` (server→client); all Base64-encoded JSON. |
| S4 | https://docs.x402.org/core-concepts/facilitator.md | Facilitator (official x402 docs) | Facilitator verifies (`/verify`) and settles (`/settle`) onchain on behalf of servers; does not hold funds/custody; public x402.org facilitator is for development/testnet workflows. |
| S5 | https://docs.x402.org/schemes/exact.md | Exact (official x402 docs) | `exact` scheme = fixed price; seller advertises one amount, buyer signs for that exact amount, facilitator settles; EVM uses EIP-3009 or Permit2; `network` in CAIP-2 (`eip155:<chainId>`). |
| S6 | https://docs.x402.org/core-concepts/wallet.md | Wallet (official x402 docs) | Buyers use wallets to store USDC and **sign payment payloads**; wallet address is the payer identity; CDP Wallet API recommended for key management (third-party recommendation). |
| S7 | https://docs.x402.org/core-concepts/network-and-token-support.md | Networks & Token Support (official x402 docs) | CAIP-2 identifiers; any EVM chain is expressible at protocol level (`eip155:<chainId>`); default-asset table lists Base, Base Sepolia, Polygon, Arbitrum, etc. — **Arc is not in the default-asset table**; runtime registration supports any EVM network given a facilitator/settlement path; production support requires a facilitator path. |
| S8 | https://docs.x402.org/extensions/payment-identifier.md | Payment-Identifier (Idempotency) (official x402 docs) | Optional extension: client generates a unique payment ID included in `PaymentPayload.extensions`; server caches responses keyed by payment ID with TTL; retries with same ID return cached responses without re-processing payment. |
| S9 | https://raw.githubusercontent.com/x402-foundation/x402/main/specs/x402-specification-v2.md | X402 Protocol Specification, Protocol Version 2 (official x402 GitHub org) | `PaymentRequired`/`PaymentPayload`/`SettlementResponse`/`VerifyResponse` schemas; field definitions (scheme, network CAIP-2, amount in atomic units, asset, payTo, maxTimeoutSeconds, extra); `/verify`, `/settle`, `/supported`; payment flows (`authorization` = verify → resource → settle → respond); replay protection = EIP-3009 nonce (32-byte) + contract-level nonce reuse prevention + time constraints + signature verification; v2.0 dated 2025-12-09. |
| S10 | https://raw.githubusercontent.com/x402-foundation/x402/main/specs/transports-v2/http.md | Transport: HTTP (official x402 GitHub org) | HTTP 402 status + `PAYMENT-REQUIRED` header is the canonical wire location of the `PaymentRequired` object; response body is a server implementation concern; error mapping (402/400/500/200). |
| S11 | https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact.md | Scheme: exact (official x402 GitHub org) | `exact` uses the `authorization` flow (verify → resource → settle); facilitators MUST enforce destination `payTo` correctness and amount exactness per network. |
| S12 | https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_evm.md | Scheme: exact on EVM (official x402 GitHub org) | EIP-3009 `transferWithAuthorization` payload: `signature` (65 bytes) + `authorization {from, to, value, validAfter, validBefore, nonce}`; facilitator pays gas; facilitator cannot modify amount or destination. |
| S13 | https://developers.circle.com/gateway/references/supported-blockchains | Gateway supported blockchains (Circle official docs) | Gateway supports Arc Testnet (Domain 26, Nanopayments Yes, `SupportedChainName: arcTestnet`); full testnet table (13 chains); Arc testnet ~1 block confirmation, ~0.5 s to attestation. |
| S14 | https://developers.circle.com/gateway | Circle Gateway (Circle official docs) | "Gateway is fully permissionless, and you can start integrating with it immediately with no sign-up needed"; non-custodial Gateway Wallet contracts; ERC-1271 for smart-account transfers; unified USDC balance; instant transfers <500 ms. |
| S15 | https://developers.circle.com/openapi/gateway.yaml | Circle Gateway OpenAPI (Circle official docs) | Servers `gateway-api-testnet.circle.com` and `gateway-api.circle.com`; `/v1/x402/settle`, `/v1/x402/verify`, `/v1/x402/supported`, `/v1/x402/transfers`, `/v1/batch/submit`; core Gateway endpoints have **no security requirement** (only webhook subscription management at `api.circle.com` requires `BearerAuth`); settle error enum includes `nonce_already_used`; batch submit returns 409 "Nonce has already been used"; `X402TransferResponse` (id UUID, status received/batched/confirmed/completed/failed, token, sendingNetwork, recipientNetwork, fromAddress, toAddress, amount, nonce, batch-level `txHash`, createdAt, updatedAt); `PaymentRequirements` fields (scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra). |
| S16 | https://developers.circle.com/gateway/nanopayments.md | Nanopayments (Circle official docs) | Gas-free USDC nanopayments down to $0.000001 via Gateway batched settlement; EIP-3009 offchain authorizations; "Nanopayments and x402 batch settlement require EOA signatures and do not support ERC-1271". |
| S17 | https://developers.circle.com/gateway/nanopayments/quickstarts/seller.md | Quickstart: Accept payments with nanopayments (Circle official docs) | Seller middleware `createGatewayMiddleware({sellerAddress, facilitatorUrl: "https://gateway-api-testnet.circle.com"})`; quickstart uses **Arc Testnet**; `network: "eip155:5042002"` is the CAIP-2 identifier for Arc Testnet (chain ID 5042002); `maxTimeoutSeconds: 604900`; EIP-712 domain `name: "GatewayWalletBatched"`, `version: "1"`, `verifyingContract` = Gateway Wallet contract; "Gateway's settle() endpoint is optimized for low latency and guarantees settlement. Use settle() directly rather than calling verify() followed by settle()"; payment signatures must have `validBefore` at least 7 days + buffer in the future; network restriction via `networks: ["eip155:5042002"]`. |
| S18 | https://developers.circle.com/gateway/nanopayments/quickstarts/buyer.md | Quickstart: Pay for resources with nanopayments (Circle official docs) | Buyer needs an EOA private key to sign transactions and payment authorizations; `GatewayClient({chain: "arcTestnet", privateKey})`; one-time onchain deposit to Gateway Wallet; `pay()` = request → 402 → sign EIP-3009 offchain → retry with `PAYMENT-SIGNATURE` header → submit through the Settle x402 Payment endpoint; nanopayments require EOA (SCA unsupported because batched settlement verifies EIP-3009 via `ecrecover`). |
| S19 | https://developers.circle.com/gateway/nanopayments/supported-networks.md | Supported networks (Circle official docs) | Nanopayments work on all EVM chains where the Nanopayments column is Yes (includes Arc Testnet); `SupportedChainName` used in SDK; GatewayWallet address is the EIP-712 `verifyingContract`; testnet USDC from the Circle Faucet (`https://faucet.circle.com`); native gas from each testnet's faucet. |
| S20 | https://developers.circle.com/stablecoins/usdc-contract-addresses.md | USDC contract addresses (Circle official docs) | Arc Testnet USDC token address: `0x3600000000000000000000000000000000000000` (linked to testnet.arcscan.app). |
| S21 | https://developers.circle.com/gateway/references/contract-addresses.md | Gateway smart contract addresses on EVM (Circle official docs) | Arc Testnet GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` (Domain 26); Arc Testnet GatewayMinter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` (Domain 26). |
| S22 | https://developers.circle.com/gateway/references/fees.md | Gateway fees (Circle official docs) | Crosschain transfer fee 0.005% (0.5 bps); gas fees per source chain; forwarding service fee $0.05/transfer; `maxFee ≥ gas fee + forwarding fee + (amount × 0.00005)`; fee estimate via `/estimate`. |
| S23 | https://docs.arc.io/llms.txt | Arc docs index (official Arc domain) | Arc is an open Layer-1 blockchain purpose-built for programmable money; **USDC is the native gas token**; sub-second deterministic finality; EVM compatible; **"Arc is currently available on Testnet only"**; explorer `https://testnet.arcscan.app`; faucet `https://faucet.circle.com`; always check official contract addresses page. |
| S24 | https://docs.arc.io/arc/references/connect-to-arc.md | Connect to Arc (official Arc domain) | Arc Testnet network config: RPC `https://rpc.testnet.arc.io`, **Chain ID 5042002**, currency symbol USDC, explorer `https://testnet.arcscan.app`; native USDC gas token uses 18 decimals, USDC ERC-20 interface uses 6 decimals. |
| S25 | https://docs.arc.io/arc/references/contract-addresses.md | Contract addresses (official Arc domain) | Arc Testnet USDC (optional ERC-20 interface) `0x3600000000000000000000000000000000000000` (6 decimals); GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` (domain 26); GatewayMinter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` (domain 26); Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`; "Mainnet addresses are not yet available"; testnet USDC from the Circle Faucet. |
| S26 | https://docs.arc.io/arc/concepts/deterministic-finality.md | Deterministic finality and settlement (official Arc domain) | Arc deterministic finality <1 s; every committed block is immediately and irreversibly settled; no reorganization risk; no confirmation windows. |
| S27 | https://www.circle.com/grant | Circle Developer Grants (official Circle program page) | "Grants for exceptional teams building on Arc and the Circle Developer Platform"; milestone-based tiered USDC funding tied to meaningful integrations and ecosystem impact; co-marketing, technical guidance, ecosystem access; looks for strong platform alignment (Arc core to flow of value/liquidity/settlement; Circle products e.g. USDC, Wallets, CCTP, **Nanopayments, Gateway** as meaningful building blocks), exceptional teams (proven shipping ability, clear technical ownership), traction and path to success (evidence of usage, pilots, partnerships, revenue or credible path), ecosystem impact; focused use cases include **agentic economic activity**; process: application → initial review → finalist technical review → milestone design → milestone-based disbursement; apply at `https://circle.questbook.app/`; **no deadline or grant amount is stated on the page**. |

Secondary sources used for framing only (no technical facts taken from them):
x402.org homepage (S0, https://x402.org/ — program/product context: "x402 is an
open, neutral standard for internet-native payments"; the FAQ states production
readiness, blockchain-agnostic support — used as context, not for protocol
behavior). The Circle docs reference `https://github.com/coinbase/x402` as their
open-source implementation link; the protocol specification used here is the
one from the x402-foundation GitHub org (the org linked by the official
docs.x402.org).

# Proposed Integration Thesis

> AgentPay Guard evaluates a proposed payment intent for a paid resource.
> On ALLOW it emits a bounded `ExecutionAuthorization`. An external signer
> (buyer EOA, outside Guard core) signs an EIP-3009 payment authorization
> matching the exact x402 payment requirement. The signed payload is submitted
> through Circle Gateway's x402 nanopayments interface, which batches and
> settles USDC on Arc Testnet. The durable settlement outcome
> (`X402TransferResponse` — transfer UUID, status, nonce, batch transaction
> hash) is recorded as `SettlementEvidence` in a durable execution store,
> separate from canonical policy audit evidence.

The thesis does NOT put execution inside Guard. Guard stays keyless:
`ALLOW` → `ExecutionAuthorization` → external signing boundary → Gateway x402
→ Arc Testnet → settlement evidence.

VERIFIED EXTERNAL TECHNICAL FACT (S13, S17, S18, S19): the exact path
"HTTP 402 → EIP-3009 signature → Gateway x402 settle → Arc Testnet" is what
Circle's own official nanopayments buyer/seller quickstarts implement, with
Arc Testnet as the reference network in the seller quickstart.

# Current Guard Boundary

From source (threat-model.md, limitations.md, src/domain/*), current Guard
state:

- **No execution surface.** Nothing in `src/` signs, broadcasts, submits
  transactions, calls blockchain RPC, or moves funds. Dependencies are
  `next` + `react` only.
- `ALLOW` means only that a separately authorized future adapter could be
  considered; it never means funds moved.
- `ExecutionAuthorization` is bounded evidence: `scope: "single_intent"`,
  `executionScope: ["prepare","simulate"]` (literal), `executionStatus:
  "not_executed"` (literal), `fundsMoved: false` (literal), `maxAmountUSDC` =
  proposed amount, never the policy cap, deterministic `auth_<sha256>`
  `authorizationId`.
- `expiresAt` = audit timestamp + `policy.authorization.ttlSeconds` (300 s);
  **no runtime wall-clock enforcement of expiry exists anywhere** (T09).
- Canonical audit is append-only JSONL, **in-process only** (promise-chain
  lock per path); no hash chain, no signatures, no cross-process protection
  (T13/T14).
- `agentId` is self-asserted, unauthenticated input (ADD-1).
- `replayMismatch === false && policyChanged === false` is the exact gate for
  issuing an authorization; `null` or `true` on either side yields no
  authorization.
- Unknown top-level request fields (including `transactionHash`, `signature`,
  `to`, `data`, `programmablePaymentContext`) are silently ignored and never
  survive into the validated `PaymentIntent` (T15); `routeContext` unknown
  fields are rejected (strict).
- All 14 future-execution preconditions in the threat model are **unchecked
  and unimplemented**.

# Current x402 Flow

All facts VERIFIED EXTERNAL TECHNICAL FACT against the official x402 spec
(S9), HTTP transport (S10), exact scheme (S11, S12), and official docs
(S1–S5, S8).

**A. What the resource server returns on an unpaid request.** HTTP `402
Payment Required` with a `PAYMENT-REQUIRED` header carrying the Base64-encoded
`PaymentRequired` object (S10, S3). The HTTP response body is a server
implementation concern — all protocol information is in the header (S10).
The `PaymentRequired` object is `{ x402Version: 2, error?, resource, accepts:
PaymentRequirements[], extensions? }` (S9).

**B. Where the payment requirement is encoded.** In the `PaymentRequired`
object's `accepts` array, transmitted in the `PAYMENT-REQUIRED` header (S9,
S10). Each entry is a `PaymentRequirements` object.

**C. Exact fields of the payment requirement** (S9 §5.1.2):

| Field | Semantics |
| --- | --- |
| `scheme` | Payment scheme identifier, e.g. `"exact"` |
| `network` | CAIP-2 network id, e.g. `eip155:5042002` (Arc Testnet) |
| `amount` | Required amount **in atomic token units** (e.g. `10000` = 0.01 USDC at 6 decimals) |
| `asset` | Token contract address (or ISO currency code for fiat) |
| `payTo` | Recipient wallet address (or role constant) |
| `maxTimeoutSeconds` | Maximum time allowed for payment completion |
| `extra` | Scheme-specific: reserved keys `assetTransferMethod` (e.g. `eip3009`), `paymentFlow` (e.g. `authorization`); Gateway nanopayments uses `name: "GatewayWalletBatched"`, `version: "1"`, `verifyingContract` = GatewayWallet address (S17) |

**D. What the client signs.** For the EVM `exact` scheme, an EIP-3009
`transferWithAuthorization` EIP-712 signature (65 bytes) over the
`Authorization` object `{ from, to, value, validAfter, validBefore, nonce }`
(S12, S9 §5.2). The EIP-712 domain is the token contract's domain
(name/version); for Gateway nanopayments the domain is `GatewayWalletBatched`
v1 with `verifyingContract` = Gateway Wallet contract on the target chain
(S17). The signed payload is placed in the `PAYMENT-SIGNATURE` header as
Base64 JSON (`PaymentPayload` = `{ x402Version, resource?, accepted
(PaymentRequirements echo), payload { signature, authorization }, extensions?
}`) (S9, S10).

**E. Which component verifies payment.** The facilitator's read-only `/verify`
endpoint (scheme- and network-based validation), or the resource server
verifying locally (S9 §7.1, S4). Circle Gateway exposes `/v1/x402/verify`
(validation of scheme/network/token/signature/temporal/address-amount
matching; balance and nonce checks only at settle time) (S15). Official
guidance: use `/settle` directly in production flows rather than
verify-then-settle (S17).

**F. Which component performs/facilitates settlement.** The facilitator's
`/settle` endpoint submits the payment onchain; the facilitator does not hold
funds or act as custodian (S9 §7.2, S4). Circle Gateway's `/v1/x402/settle`
"submits the EIP-3009 authorization; the authorization will be verified, the
sender's balance locked, and the transaction queued for batch processing"
(S15). Gateway aggregates authorizations and settles net positions onchain in
bulk (S16).

**G. What settlement evidence is returned, and to whom.** The facilitator
returns a `SettlementResponse`/`Payment Execution Response` to the resource
server: `{ success, errorReason?, payer?, transaction, network, amount?,
extensions? }` where `transaction` is the blockchain transaction hash (empty
if failed) (S9 §5.3). The resource server then returns the resource with a
`PAYMENT-RESPONSE` header carrying the Base64 `SettlementResponse` to the
client (S10). For Circle Gateway x402 the settle response `transaction` field
is a **transaction UUID** (empty on failure) and the full per-payment detail —
`X402TransferResponse` with status, nonce, addresses, amount, and a
**batch-level settlement transaction hash** (`txHash`, null until batched) —
is retrievable via `GET /v1/x402/transfers/{id}` (S15).

**H. Replay / duplicate-payment protection.** Defined by the protocol:
EIP-3009 includes a unique 32-byte `nonce`; EIP-3009 contracts prevent nonce
reuse at the smart-contract level; authorizations carry explicit validity
windows; payloads are cryptographically signed (S9 §10.1). Gateway adds
API-level enforcement: settle error `nonce_already_used`, `/v1/batch/submit`
returns `409 Nonce has already been used`, and the x402 transfer search
supports filtering by `nonce` (S15).

**I. Official idempotency/nonce mechanism bindable to an authorizationId.**
Yes, two layers: (1) the **EIP-3009 nonce** — a required, protocol-defined,
contract-enforced, Gateway-enforced unique identifier that can be generated
and bound by an application; (2) the optional **payment-identifier extension**
— a client-generated payment ID carried in `PaymentPayload.extensions`, with
the server caching responses keyed by payment ID (TTL) so retries do not
re-process payments (S8). Neither is bound to a Guard `authorizationId` today;
binding is designable (see Duplicate-Settlement Strategy).

# Current Circle Gateway Model

All facts VERIFIED EXTERNAL TECHNICAL FACT (S13–S22).

**A. Testnet availability.** Yes — testnet API base URL
`https://gateway-api-testnet.circle.com` (S15, S17).

**B. Documented test networks (S13, testnet table).** Arc Testnet (domain 26),
Arbitrum Sepolia (3), Avalanche Fuji (1), Base Sepolia (6), Ethereum Sepolia
(0), HyperEVM Testnet (19), OP Sepolia (2), Polygon Amoy (7), Sei Atlantic
(16), Solana Devnet (5 — nanopayments: No), Sonic Testnet (13), Unichain
Sepolia (10), World Chain Sepolia (14).

**C. Arc Testnet directly supported?** **YES, directly.** Domain 26,
Nanopayments: **Yes**, `SupportedChainName: arcTestnet` (S13); the official
nanopayments seller quickstart uses Arc Testnet as its reference network with
`network: "eip155:5042002"` (S17); Arc Testnet GatewayWallet/Minter contract
addresses are published (S21, S25); Arc testnet attestation ~0.5 s at ~1 block
confirmation (S13). The original thesis is not bent: it is directly supported.

**D. Credentials/accounts.** None for the Gateway core API — "Gateway is fully
permissionless, and you can start integrating with it immediately with no
sign-up needed" (S14); the Gateway OpenAPI declares no security requirement on
the core `v1` endpoints (balances, transfer, x402, batch) (S15). Only webhook
subscription management (`api.circle.com/v2/notifications/...`) requires a
Bearer API key (S15). Testnet assets come from faucets (S19).

**E. Where signing happens.** Offchain, by the buyer/user. EIP-3009 payment
authorizations are signed offchain at zero gas (S16, S18); standard Gateway
transfers require user-signed EIP-712 `BurnIntent`s; the Gateway System signs
`Attestation`s for mints (S14 technical guide).

**F. Signer model.** For nanopayments/x402: **EOA signatures only** (verified
offchain with `ecrecover`); smart contract accounts are not supported for
nanopayments (S16, S18). For standard Gateway transfers: EOA (static ECDSA)
or ERC-1271 smart-contract signatures (S14 technical guide). Signer is
developer/user-controlled (the depositing address).

**G. Can an external app remain completely keyless?** **Yes.** The Gateway API
is permissionless and the signing key never needs to be present in the
application's server: the EIP-3009 signature is produced by the buyer's EOA
client (e.g. `GatewayClient` with a private key in the client environment
(S18)) or by a separate signer process. Guard itself needs no key.

**H. Officially recommended API/SDK.** REST API reference for Gateway
(OpenAPI: `gateway-api-testnet.circle.com` / `gateway-api.circle.com`) (S15);
TypeScript SDK `@circle-fin/x402-batching` for nanopayments (S17, S18);
`Unified Balance Kit` recommended for general Gateway flows (S14).

**I. Settlement/result identifier available as durable outcome evidence.**
Multiple, officially defined (S15):
- `transferId` (UUID) for standard Gateway transfers;
- x402 transfer `id` (UUID) via `/v1/x402/transfers/{id}` with status
  (`received`/`batched`/`confirmed`/`completed`/`failed`), `nonce`, addresses,
  amount, and batch-level `txHash`;
- the settle response `transaction` field (transaction UUID, empty on failure).
`txHash` is the batch-level settlement transaction hash, shared by all
transfers in the same batch, and remains null until the batch settles onchain
(S15) — explorer-verifiable on Arc Testnet via `https://testnet.arcscan.app`.

**J. Network/asset/recipient data checkable before settlement.**
`GET /v1/x402/supported` returns the supported payment kinds per network,
including the GatewayWallet `verifyingContract` (EIP-712 domain) and the
supported token addresses/symbols/decimals (S15); `GET /v1/balances`,
`GET /v1/deposits`, `GET /v1/info`, and `POST /v1/estimate` provide
pre-settlement balance/domain/fee checks (S15, S22). The exact
`PaymentRequirements` (network, asset, amount, payTo, maxTimeoutSeconds) are
themselves independently checkable against the allowlist before any signature
is made.

# Current Arc Testnet Model

All facts VERIFIED EXTERNAL TECHNICAL FACT (S23–S26, S20, S21).

- **Network identifier:** Chain ID **5042002**; CAIP-2 `eip155:5042002` (S17
  comment, S24); RPC `https://rpc.testnet.arc.io` (S24); Arc is currently
  available on **Testnet only** — mainnet addresses are not yet available
  (S23, S25).
- **EVM compatibility:** Yes — Solidity via standard EVM tooling; EVM
  differences documented (S23).
- **Testnet USDC:** Official address `0x3600000000000000000000000000000000000000`
  (USDC ERC-20 interface, 6 decimals) (S20, S25). **USDC is also the native
  gas token** on Arc (18 decimals native) (S23, S24); gas is paid in USDC.
- **Official faucet/test-token path:** `https://faucet.circle.com` for testnet
  USDC (S23, S25, S19). Native gas = USDC on Arc, so the same faucet covers
  the deposit transaction gas.
- **Official explorer:** `https://testnet.arcscan.app` (S23, S24).
- **Confirmation/finality model:** deterministic finality — every committed
  block is final and irreversible in under one second; no reorganization risk,
  no confirmation windows (S26); Gateway requires ~1 block / ~0.5 s for Arc
  testnet attestations (S13).
- **Wallet/signing requirements:** EOA wallets (standard EVM wallets work,
  e.g. MetaMask with custom gas token) (S24); nanopayments require an EOA —
  smart-contract accounts are not supported for the batched x402 path (S18,
  S16).
- **Can the Gateway/x402 flow target Arc Testnet?** **Yes.** Officially: the
  nanopayments seller quickstart runs on Arc Testnet via
  `gateway-api-testnet.circle.com` with `network: eip155:5042002` (S17); the
  buyer SDK accepts `chain: "arcTestnet"` (S18); Gateway x402 `supported`
  kinds expose the Arc Testnet GatewayWallet contract as the EIP-712
  `verifyingContract` (S15, S21, S25).

# Signer / Key-Management Boundary

Preferred architecture (protocol-driven, matching the official buyer flow
(S18)) keeps AgentPay Guard keyless:

- **Where the signer lives:** OUTSIDE Guard core — a separate local
  signer process/script (or the buyer's own agent-wallet client) running the
  official SDK pattern (`GatewayClient({ chain: "arcTestnet", privateKey })`)
  or a minimal viem EOA signer. The signer is an independent executable; Guard
  never imports it, never calls into key storage, never holds key material.
- **Who owns the key:** the operator/test harness controls a test-only EOA
  (testnet funds from the Circle Faucet). Guard core, its process, and its
  repository contain no private keys (static-scan invariant, as today).
- **Exactly what Guard sends to the signer:** a signing request containing
  (a) the `authorizationId`, (b) the exact normalized payment requirement
  (scheme `exact`, network `eip155:5042002`, asset address, `payTo`, amount in
  atomic units, `maxTimeoutSeconds`, EIP-712 domain name/version/verifyingContract),
  (c) the EIP-3009 authorization fields to sign — `from` (signer address),
  `to` (= payTo), `value` (= exact amount), `validAfter`, `validBefore`
  (≥ 7 days + buffer per Gateway (S17)), `nonce` (Guard-generated or
  signer-generated and returned). Guard sends **data to sign**, never a request
  to "just pay".
- **What the signer is forbidden to change:** every signed field. Any deviation
  from the exact requirement produces an authorization that Gateway verification
  rejects (`amount_mismatch`, `address_mismatch`, `invalid_signature`,
  `authorization_expired` — S15), so the signer is structurally unable to alter
  recipient, amount, asset, network, or validity without producing a
  non-settlable payload.
- **What evidence comes back:** the constructed `PaymentPayload` (signed) and,
  after submission, the Gateway settle response / `X402TransferResponse`
  (transfer UUID, status, nonce, batch `txHash`, addresses, amount) (S15),
  which the Guard adapter records as `SettlementEvidence`.

The only practical implementation that would require private keys or custody
INSIDE Guard core would be self-facilitation of EIP-3009 signing with a
Guard-owned key. That is **not** the preferred architecture and is rejected
for this track. The signer remains outside Guard core; if this ever became
impossible, the decision would be NO-GO for the bounded track.

# ExecutionAuthorization Mapping

`ExecutionAuthorization` (v1) vs the x402/Gateway `PaymentRequirements` +
`PaymentPayload` (S9, S15, S17):

| ExecutionAuthorization field | x402/Gateway equivalent | Exact match enforceable? | Gap |
| --- | --- | --- | --- |
| `authorizationId` | No x402 equivalent | App-level only | Guard-internal `auth_<sha256>`; must become the durable execution-record key and be bound to the EIP-3009 nonce. |
| `intentId` | `resource.url` (approx.) | No | Resource identity vs Guard intent identity are different namespaces; needs mapping. |
| `idempotencyKey` | payment-identifier extension `paymentId` (optional, S8) | Only if server advertises extension | Extension optional; canonical audit idempotency (by key) ≠ execution idempotency. |
| `agentId` | No equivalent (`payer` = `authorization.from`) | No | Self-asserted logical agent id vs EOA address; mapping layer needed. |
| `recipient` | `payTo` (seller EVM address) | No | `recipient` is a logical string ("market-data-api.demo"); no EVM address anywhere in the authorization. |
| `asset` | `asset` (token contract address) | No | Literal `"USDC"`; no contract address, no decimals, no network context (Arc native vs ERC-20 interface: 18 vs 6 decimals, S24). |
| `maxAmountUSDC` | `amount` (atomic units) | Partial | String USDC vs atomic units; decimals conversion not modeled. |
| `paymentRail` | `scheme` (`exact`) + Gateway x402 path | Partial | Rail enum is mock values (`mock_x402_service`, `arc_settlement_preview`); no real `gateway_x402` value. |
| `rail` | same as above | Partial | Same gap as `paymentRail`. |
| `programmablePaymentContext` | `extra` (assetTransferMethod, name, version, verifyingContract, paymentFlow) | Partial | Gateway-specific EIP-712 domain fields (GatewayWalletBatched/1/verifyingContract) not present. |
| `policyId` | No equivalent | App-level only | Must be committed to the execution record. |
| `policyVersion` | No equivalent | App-level only | Must be committed to the execution record. |
| `policyFingerprint` | No equivalent | App-level only | Must be committed to the execution record. |
| `issuedAt` | `validAfter` (EIP-3009) | Approximate | Different clocks; Guard TTL is 300 s, Gateway requires ≥7-day signature validity (S17). |
| `expiresAt` | `validBefore` (EIP-3009) | Approximate | Two distinct expiry controls (Guard runtime gate vs signature validity window); runtime expiry enforcement does not exist today (T09). |
| `executionScope` | `paymentFlow` (`authorization`: verify → resource → settle, S9 §6.1) | Partial | Guard literal `["prepare","simulate"]` vs protocol flow ordering; no execute value exists. |
| `executionStatus` | `X402TransferResponse.status` (received/batched/confirmed/completed/failed, S15) | No | Guard literal `"not_executed"` vs Gateway lifecycle states; mapping needed in the execution record. |
| `fundsMoved` | `success` / status `completed` | No | Guard literal `false` vs real settlement outcome; outcome lives in `SettlementEvidence`. |

**Required future payment fields the authorization does NOT directly contain:**
network/chain identifier (CAIP-2 `eip155:5042002`), chain ID (5042002),
contract/asset address, `payTo` address, resource identifier
(`resource.url`), payment-requirement digest, facilitator identifier
(`gateway-api-testnet.circle.com`), fee bound (`maxFee` / 0.005% transfer fee,
S22), EIP-3009 `nonce`, token decimals, EIP-712 domain name/version/
`verifyingContract` (GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`,
S21/S25), `maxTimeoutSeconds`, `scheme`.

**Decision (protocol-driven):** **B — separate deterministic
`PaymentRequirement` binding/digest**, with a new versioned
`ExecutionAuthorization` schema to carry the binding reference. Rationale: the
payment requirement is external protocol data that arrives at evaluation time
(402 header); it must not be absorbed into the policy-evidence envelope
(which remains built purely from the persisted audit record + current policy).
Instead the normalized requirement is canonicalized (key-sorted stable JSON,
reusing `src/lib/stable-json.ts`) and digested with SHA-256; the digest (plus
the concrete fields the authorization lacks) is committed by a new
authorization version, so the adapter can verify "the exact requirement that
was evaluated" before any signature. Option C (existing fields sufficient) is
impossible: network, asset address, `payTo`, amount scale, and nonce are
missing. Option A alone (new schema without a separate binding) would still
need the requirement object carried/committed somewhere; B is the binding that
makes the new schema meaningful.

- **policyVersion impact: YES.** Adding an explicit network allowlist
  (`eip155:5042002`) and fee-bound policy fields changes the policy config
  schema; `policyVersion` would move from `"2"` to `"3"` with a new
  deterministic `policyFingerprint`.
- **authorization version impact: YES.** `version: "v1"` →
  `version: "v2"` (or a v1-compatible attached binding reference), carrying
  the `paymentRequirementDigest` and the missing binding fields listed above.

**Threat-model note significance (T05):** the existing residual-risk note that
`authorizationId` does NOT directly commit every route field (it hashes
intent/audit/agent/recipient/amount/rail/policy/timestamps, with route binding
transitive via the fingerprint gate + `auditId`) **becomes significant** for
the x402/Gateway integration: the fields that matter to the payment (network,
asset address, `payTo`, amount scale, nonce) are exactly the fields the
authorization does not hash. The `PaymentRequirement` digest binding must
therefore be **direct**, not transitive — the adapter verifies the digest of
the requirement it will sign against the digest committed in the
authorization, and the digest must be part of the authorization's identity
inputs.

# Threat-Model Preconditions

All 14 preconditions from `docs/grants/circle-grants-2026/threat-model.md`
("Future Execution Preconditions") are currently **unchecked and
unimplemented** in this repository. The table below maps each to the bounded
testnet slice. "Where implemented" refers to the PROPOSED future design; per
the constraint, nothing is marked implemented because no source proves any
implementation today.

| Existing precondition | Needed for bounded testnet slice? | Where implemented (proposed) | Proposed mechanism | Evidence required |
| --- | --- | --- | --- | --- |
| Runtime authorization expiry enforcement (T09) | Yes | ADAPTER | Execution security gate rejects when `now >= expiresAt` before any signing request; separate from the EIP-3009 `validBefore` window (Gateway requires ≥7 days validity, S17) | Negative test F: expired authorization → no signing/no settlement |
| Exact authorization-to-adapter input binding (T15) | Yes | ADAPTER | Adapter consumes only the validated typed intent + `ExecutionAuthorization` + `PaymentRequirement` digest; never raw request fields | Negative test J: raw request with injected execution fields → ignored/rejected before adapter |
| Recipient / amount / asset / chain / route enforcement (T03/T04/T05) | Yes | ADAPTER + EXTERNAL SIGNER/WALLET | Adapter verifies requirement equals authorization (payTo, amount atomic units, asset address, network); signer signs exactly the verified requirement | Negative tests C/D/E: changed amount/recipient/network → no signing/no settlement |
| Single-use / duplicate-execution protection (T10) | Yes | DURABLE EXECUTION STORE | Consume/check `authorizationId`; one execution record per authorization; nonce uniqueness | Negative test I: reused consumed authorizationId → no second settlement |
| Durable cross-process idempotency (T14) | Partially (execution store yes; canonical audit stays same-process for pilot) | DURABLE EXECUTION STORE (new) / GUARD CORE (canonical audit unchanged, same-process lock remains) | Durable execution record with atomic append (file lock or SQLite); canonical audit log remains in-process per T14 residual, documented | Restart test: execution state survives process restart; audit collision risk unchanged and documented |
| Actual executed-spend accounting (T11) | Yes (bounded) | GUARD CORE | New executed-spend reconciliation over `SettlementEvidence` records (settled amount per agent/authorization), separate from policy-evidence spend controls; daily limits remain policy-evidence-based until production | Reconciliation test: authorized vs executed spend reconciled for the bounded testnet path |
| Authenticated principal / agent identity model (ADD-1) | Bounded only (test harness; not production) | TEST HARNESS | Pilot uses a controlled test signer/agent identity; production-grade identity model remains NOT SATISFIED and documented as a production blocker | Demo/evidence uses the controlled signer; limitation recorded |
| Protected key-management boundary outside Guard core | Yes | EXTERNAL SIGNER/WALLET | Signer process outside Guard core (see Signer / Key-Management Boundary); no private keys in repository | Static scan + keyless tests; negative test showing Guard has no key access path |
| Transaction simulation before signing | Yes | ADAPTER | Protocol-native read-only verification: Gateway `/v1/x402/verify` (scheme/network/token/signature/temporal/address-amount checks; balance+nonce only at settle, S15); official guidance: settle directly in production (S17) | Verify-before-sign test; simulation remains a preview until verified |
| Explicit network allowlist | Yes | GUARD CORE (policy config) + ADAPTER | Policy-level allowlist containing `eip155:5042002` (Arc Testnet); adapter rejects any other network | Negative test K: unsupported network → no settlement |
| Adapter-specific fee bounds | Yes (where applicable) | ADAPTER | For the exact nanopayment path the settled amount is exactly `amount` (no per-payment fee, S16); for any standard Gateway transfer usage, enforce `maxFee` bound per official fee model (S22) | Fee-bound test where applicable; exact-amount test for the nanopayment path |
| Durable execution outcome evidence (T10/T13) | Yes | DURABLE EXECUTION STORE | `SettlementEvidence` records (see Settlement Evidence Model) written durably, distinct from policy audit evidence, never overwriting policy evidence | Durable record + restart test; policy evidence byte-unchanged after execution |
| No raw-request bypass around validated typed intent (T15) | Yes | ADAPTER + GUARD CORE | Normalization of the 402 `PaymentRequirement` goes through `validatePaymentIntent`; downstream logic consumes only the typed intent | Negative test J (same as precondition 2); normalization test |
| Threat-model re-review before enabling broadcast | Yes | OPERATOR | Manual re-review of this document and the threat model against the new execution surface before any broadcast is enabled; broadcast remains disabled in this track until review sign-off | Re-review checklist/artifact recorded before enabling broadcast |

**Minimal Security Controls (future plan — describe only, DO NOT implement):**

1. **Runtime authorization expiry** — adapter rejects `now >= expiresAt` before
   any signing request; enforced in the execution security gate.
2. **Exact binding to authorizationId/recipient/amount/asset/network/route/
   payment requirement** — `PaymentRequirement` digest committed in the
   authorization; adapter compares digest + concrete fields before signing.
3. **ALLOW only** — signer request is emitted only from the
   `replayMismatch === false && policyChanged === false` ALLOW path.
4. **`replayMismatch === false`** — reuses the existing gate; any mismatch
   yields no authorization and no signing.
5. **`policyChanged === false`** — reuses the existing drift gate; drift yields
   no authorization and no signing.
6. **Duplicate settlement protection** — consumed `authorizationId` +
   unique EIP-3009 nonce + Gateway `nonce_already_used`/409 enforcement.
7. **Network allowlist** — policy-level allowlist (`eip155:5042002` only for
   the bounded slice); adapter rejects everything else.
8. **Fee bounds where applicable** — exact-amount nanopayment path; `maxFee`
   enforcement for any standard Gateway transfer path.
9. **No raw-request bypass** — 402 header normalization goes through
   `validatePaymentIntent`; adapter consumes typed intent only.
10. **External signer / key isolation** — signing in a separate process;
    Guard core statically free of key material.
11. **Executed-outcome evidence** — `SettlementEvidence` from official
    `X402TransferResponse`/settle response fields.
12. **Executed-spend reconciliation** — settled amounts reconciled per
    authorization/agent for the bounded testnet path, distinct from policy
    spend controls.
13. **Durable idempotency across process restarts** — execution record and
    nonce registry survive restarts.
14. **Security re-review before broadcast is enabled** — operator re-review of
    the threat model against the execution surface; broadcast stays disabled
    until then.

# Duplicate-Settlement Strategy

**Protocol-native protection: YES, with a durable identifier.** The EIP-3009
`nonce` is a required, unique 32-byte identifier in every signed
authorization; nonce reuse is prevented at the smart-contract level and by
explicit validity windows and signatures (S9 §10.1). Circle Gateway enforces
the nonce at its API layer: settle error `nonce_already_used`, `/v1/batch/submit`
returns `409 Nonce has already been used`, and x402 transfers expose the
`nonce` field and support filtering by it (S15). The optional payment-identifier
extension adds server-side response caching keyed by a client payment ID (S8).
The nonce is therefore a durable, officially defined identifier that the future
integration can bind to an `authorizationId` (Guard generates/records the
nonce; the signer signs it; Gateway rejects reuse).

**However — the current canonical audit idempotency does NOT solve duplicate
execution.** The Guard's in-process canonical audit idempotency (one line per
`idempotencyKey`, `replayed: true`, same `auditId`) is evaluation-level
evidence idempotency. It does not consume authorizations, does not survive
process restarts, and has no relationship to EIP-3009 nonces. It must be
explicitly stated: **canonical audit idempotency is not duplicate-execution
protection.**

**Application-level durable state is therefore still required.** The future
integration introduces its own durable execution record keyed by
`authorizationId` with states `prepared / submitted / confirmed / failed`
(+ `rejected` for gates that refused to sign), recording the bound nonce and
requirement digest. The signing path runs only when the record is in
`prepared` with a fresh nonce; `submitted`/`confirmed` blocks re-signing;
Gateway's nonce enforcement is the final independent backstop. Do not
implement now.

# Settlement Evidence Model

Proposed type (NOT implemented), fields constrained to what the official APIs
actually return (S9 §5.3 `SettlementResponse`; S15 `X402TransferResponse`):

```ts
type SettlementEvidence = {
  evidenceType: "settlement_evidence";
  authorizationId: string;        // Guard authorization consumed
  auditId: string;                // canonical policy audit record
  paymentRequirementDigest: string; // sha256 of the exact requirement bound
  x402TransferId: string;         // Gateway x402 transfer UUID (S15)
  status: "received" | "batched" | "confirmed" | "completed" | "failed"; // official enum (S15)
  success: boolean;               // settle response success (S9/S15)
  errorReason?: string;           // official error enum on failure (S15)
  network: string;                // CAIP-2, e.g. "eip155:5042002" (S15)
  token: "USDC";
  asset: string;                  // token contract address (S15/S20)
  fromAddress: string;            // payer EOA (S15)
  toAddress: string;              // payTo recipient (S15)
  amount: string;                 // atomic units (S15)
  nonce: string;                  // EIP-3009 nonce (S15)
  txHash: string | null;          // batch-level settlement tx hash; null until batched (S15)
  explorerUrl?: string;           // https://testnet.arcscan.app/... derived from txHash
  createdAt: string;              // ISO-8601 from Gateway (S15)
  updatedAt: string;              // ISO-8601 from Gateway (S15)
  recordedAt: string;             // local durable-record timestamp
};
```

- **Explorer-verifiable:** Yes, when `txHash` is present (batch-level
  settlement transaction hash on Arc Testnet, `https://testnet.arcscan.app`
  (S23/S24)). Caveat: the hash is batch-level (shared by all transfers in the
  batch) and null until the batch settles (S15); the per-payment durable
  identifiers are the x402 transfer UUID and the EIP-3009 nonce.
- **Separate from canonical policy audit evidence:** `SettlementEvidence`
  lives in the durable execution store and never overwrites the append-only
  policy audit log; policy evidence remains byte-unchanged (per the
  "never overwrite policy evidence" invariant).

**HTTP 402 resource-server slice — minimum credible demo (preferred
conceptual flow, adapted to the real architecture; NOT implemented):**

1. Agent (buyer client) requests a paid resource from a resource server
   (test API, can be ours).
2. Resource server responds `402 Payment Required` with the
   `PAYMENT-REQUIRED` header containing the Base64 `PaymentRequired` object —
   the payment requirement is in the header, not the body (S10).
3. Guard normalizes the chosen `accepts[0]` requirement into a `PaymentIntent`
   through `validatePaymentIntent` (recipient mapped from the protected
   resource identity; the `payTo`/network/asset/amount are carried as the
   requirement binding).
4. Guard evaluates → **REVIEW/BLOCK: stop** (no signing, no settlement).
5. **ALLOW** → build `ExecutionAuthorization` + `PaymentRequirement` digest;
   validate authorization against the exact requirement (network allowlist,
   amount in atomic units == `maxAmountUSDC`, `payTo` allowlist, runtime
   expiry, `replayMismatch === false`, `policyChanged === false`).
6. External signer (buyer test EOA, outside Guard core) signs the EIP-3009
   authorization (`to` = payTo, `value` = exact amount, `validBefore` ≥ 7 days
   per Gateway (S17), `nonce` bound to `authorizationId`); payload goes in the
   `PAYMENT-SIGNATURE` header.
7. Client retries; resource server verifies/settles via Gateway
   `/v1/x402/settle` (official guidance: settle directly rather than
   verify-then-settle (S17)) and serves the resource with `PAYMENT-RESPONSE`.
8. Gateway returns the x402 transfer UUID/status; the adapter polls
   `GET /v1/x402/transfers/{id}` until `batched`/`confirmed`/`completed` and
   records `SettlementEvidence` (including batch `txHash` for explorer
   verification) in the durable execution store, linked to
   `authorizationId`/`auditId`.
9. Duplicate protection: consumed `authorizationId` + bound nonce block any
   second settlement.

This flow is exactly the one Circle's official buyer/seller quickstarts
implement (S17, S18) with Guard inserted as the preflight policy gate; the
official APIs support it — no architecture bending required.

# Positive Acceptance Criteria

Smallest possible proof (design target for the future slice; NOT performed):

1. 1 paid resource (our test x402 resource server);
2. 1 externally controlled test signer (test EOA, outside Guard);
3. 1 testnet asset (USDC on Arc Testnet, `0x3600000000000000000000000000000000000000`);
4. 1 exact recipient (test `payTo` address);
5. 1 exact network (`eip155:5042002`, Arc Testnet);
6. 1 tiny amount (e.g. 0.01 USDC = 10000 atomic units);
7. 1 successful testnet settlement (Gateway `/v1/x402/settle` → status
   `confirmed`/`completed`);
8. 1 durable `SettlementEvidence` record (x402 transfer UUID, nonce, batch
   `txHash`);
9. 1 explorer-verifiable outcome (batch `txHash` on
   `https://testnet.arcscan.app`) — if officially supported, which it is
   (S15, S23);
10. no duplicate settlement (second attempt with the same `authorizationId`/
    nonce is rejected).

Chain: `PaymentIntent → ALLOW → ExecutionAuthorization → exact requirement
binding → external signing boundary → one settlement → durable outcome
evidence → no duplicate settlement`. This chain is the grant-strengthening
claim ONLY if and when it is actually executed; until then it is PROPOSED.

# Negative Acceptance Criteria

Mandatory tests for any future integration (define now; DO NOT implement):

- **A** REVIEW → no signing / no settlement.
- **B** BLOCK → no signing / no settlement.
- **C** changed amount → no signing / no settlement.
- **D** changed recipient → no signing / no settlement.
- **E** changed network/chain → no signing / no settlement.
- **F** expired authorization → no signing / no settlement.
- **G** replay mismatch → no signing / no settlement.
- **H** policy drift → no signing / no settlement.
- **I** reused consumed `authorizationId` → no second settlement.
- **J** raw request containing injected execution fields → ignored/rejected
  before the adapter (adapter consumes only the validated typed intent).
- **K** unsupported network → no settlement.
- **L** settlement failure → policy evidence unchanged + explicit `failed`
  execution outcome recorded in the durable execution store.

# Minimal Implementation Slice

(ONLY for the GO track; adapt to the actual official architecture discovered —
no preserved incorrect assumptions.)

- **I1 — Payment Requirement Contract (GUARD CORE + ADAPTER):** normalize the
  official x402 `PaymentRequirements` (S9) into a typed, validated object;
  deterministic requirement digest (SHA-256 over key-sorted stable JSON);
  bind the digest into Guard evidence.
- **I2 — Execution Security Gate (ADAPTER):** runtime expiry; exact
  recipient/amount/asset/network binding via the requirement digest; ALLOW /
  replayMismatch / policyChanged checks; network allowlist
  (`eip155:5042002`); gates before any signing request.
- **I3 — Durable Execution Idempotency (DURABLE EXECUTION STORE):**
  authorization consumption state (`prepared / submitted / confirmed /
  failed`); duplicate settlement rejection; durable testnet execution record;
  nonce registry surviving restarts.
- **I4 — External Signer Adapter (EXTERNAL SIGNER/WALLET):** key stays outside
  Guard core; signs EIP-3009 authorization only after all gates pass; signs
  exactly the verified requirement; returns the signed `PaymentPayload`.
- **I5 — Settlement Evidence (DURABLE EXECUTION STORE):** capture real
  official settlement result (`X402TransferResponse`/settle response, S15);
  link to authorization/audit; never overwrite policy evidence.
- **I6 — Positive + Negative Proof (TEST HARNESS):** exactly one tiny testnet
  payment; REVIEW/BLOCK/substitution/expiry/duplicate tests (Negative
  Acceptance Criteria A–L); screenshot/demo evidence; explorer link for the
  batch `txHash`.

## Implementation status

Updated 2026-08-16. This records what is actually built in this repository.
No Gateway integration, no Arc settlement, and no x402 payment are implemented.

- **I1 — Payment Requirement Contract: IMPLEMENTED.** Artifacts:
  `src/domain/x402/payment-requirement.ts` (exports
  `X402PaymentRequirement`, `X402ExactExtra`, `validateX402PaymentRequirement`,
  `fingerprintX402PaymentRequirement`, `x402NetworkChainId`,
  `X402PaymentRequirementValidationError`),
  `src/domain/x402/payment-requirement-evidence.ts` (exports
  `PaymentRequirementEvidence`, `AuthorizedPaymentRequirementEvidence`,
  `buildPaymentRequirementEvidence`, `buildAuthorizedPaymentRequirementEvidence`),
  `tests/x402-payment-requirement.test.ts` (90 tests, 33 logical bodies via
  `test.each`), and the contract record
  `docs/grants/circle-grants-2026/x402-payment-requirement-contract.md`.
  Full suite after I1: 21 test files / 360 tests, all passing.
- **I2 — Execution Security Gate: IMPLEMENTED** (local pure gate; no
  signer/network/settlement). Active `policyVersion` is now `"3"` with a new
  `x402Execution` allowlist section in `data/policies.default.json`. Artifacts:
  `src/domain/x402/execution-security-gate.ts` (fail-closed gate),
  `src/domain/x402/execution-authorization-v2.ts` (deterministic v2
  authorization artifact bound to the v1 parent + requirement digest),
  `tests/x402-execution-security-gate.test.ts`, and the record
  `docs/grants/circle-grants-2026/x402-execution-security-gate.md`. Binding
  semantics: direct requirement-digest commitment (recomputed vs
  `paymentRequirementEvidence.requirementDigest`); runtime expiry gate
  (`now < expiresAt` strictly, `now === expiresAt` rejects, unparseable
  expiresAt fails closed); Arc Testnet network/asset/EIP-712-domain allowlist
  (`eip155:5042002`, USDC
  `0x3600000000000000000000000000000000000000`, `GatewayWalletBatched` v1 /
  `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`); trusted
  `X402RecipientBinding { recipient, payTo }` gate; exact 6-decimal
  decimal→atomic amount conversion (no float, no rounding, >6 meaningful
  decimals not representable). Rejection reason codes are the deterministic
  security contract (not free-form strings; 17 rejection codes +
  `X402_EXECUTION_GATE_ALLOWED`). No live integration claim: I2 is
  local-only, no signer/nonce/settlement. I2 test file
  `tests/x402-execution-security-gate.test.ts` (85 tests). Full suite after
  I2: 22 test files / 445 tests, all passing.
- **I3 — Durable Execution Idempotency: NOT IMPLEMENTED.**
- **I4 — External Signer Adapter: NOT IMPLEMENTED.**
- **I5 — Settlement Evidence: NOT IMPLEMENTED.**
- **I6 — Positive + Negative Proof: NOT IMPLEMENTED.**

# Explicit Non-Goals

- No custody, no key storage inside AgentPay Guard core, no private keys in
  the repository.
- No live mainnet settlement (Arc is testnet-only today anyway, S23).
- No AML/KYC claims; no compliance product claims.
- No official Arc/Circle partnership claim; no "verified product capability"
  claim for Gateway/x402/Arc — integration remains PROPOSED until built.
- No invented grant claims: no grant amount, deadline, eligibility, or
  milestone commitments (the official Circle Grants page states none of
  these as of 2026-08-16).
- Phase 9 (payment execution) is NOT started; this document does not start it.
- No changes to the canonical audit log semantics, policy evidence, or the
  existing `ExecutionAuthorization` v1 envelope beyond the versioned addition
  described.
- No production-grade authenticated identity model, no cross-process canonical
  audit locking, no tamper-evident audit — these remain documented residuals
  (ADD-1, T13/T14).

# GO / NO-GO Decision

**GO WITH BLOCKERS.**

Verified against the required preconditions for GO/GO-WITH-BLOCKERS:

1. **Officially supported technical path exists** — YES: Gateway x402 →
   Arc Testnet (`eip155:5042002`, domain 26, nanopayments Yes) is documented
   end-to-end by Circle (S13, S15, S17, S18).
2. **Guard can remain keyless** — YES: Gateway API is permissionless (S14,
   S15); signing is done by an external EOA.
3. **Signing lives outside Guard core** — YES (preferred architecture; see
   Signer / Key-Management Boundary).
4. **Exact payment requirement binding is possible** — YES via the
   `PaymentRequirement` digest (option B).
5. **Outcome evidence obtainable** — YES: `X402TransferResponse` (UUID,
   status, nonce, batch `txHash`) + Arc explorer.
6. **Duplicate-settlement protection is designable** — YES: EIP-3009 nonce +
   Gateway `nonce_already_used`/409 + durable execution record.
7. **Threat-model preconditions satisfiable in a bounded track** — YES: all 14
   map to ADAPTER / EXTERNAL SIGNER / DURABLE EXECUTION STORE / GUARD CORE /
   TEST HARNESS / OPERATOR; none require custody inside Guard. (Note:
   production-grade authenticated identity and cross-process canonical audit
   remain out of scope for the bounded testnet slice and are documented.)
8. **Implementation would materially change the grant story** — YES: from
   proposal-only integration (executionScope `["prepare","simulate"]`,
   `not_executed`) to one real, controlled testnet settlement with durable,
   explorer-verifiable evidence.

Blocker framing: GO WITH BLOCKERS, not GO, because every one of the 14
preconditions is currently unchecked and unimplemented, and the durable
execution store, requirement binding, external-signer adapter, and settlement
evidence are concrete implementation work that does not exist yet. None of the
blockers requires changing AgentPay Guard into a custody or payment platform.

**Scope estimate: MEDIUM** (complexity, not hours). Reasons: bounded to one
network, one scheme (`exact`), one tiny testnet payment; requires a new domain
module (payment-requirement contract + digest), a durable execution store, an
adapter pair (security gate + external signer), settlement evidence, new API
surface, and new tests — but no custody, no multi-rail support, no production
durability, no new payment primitives inside Guard core.

Likely changed areas: `src/domain/` (new `payment-requirement` /
`execution-security-gate` / `settlement-evidence` / `execution-store`
modules; versioned `ExecutionAuthorization`), `src/integrations/` (new
`gateway-x402` adapter + external-signer adapter), `src/app/api/` (new routes
for requirement normalization and execution status), `tests/` (new suites for
I1–I6 and criteria A–L), `docs/` (this decision record updated when built).

# Reasons

- The thesis is not speculative: Circle's own nanopayments quickstarts
  implement exactly the HTTP 402 → EIP-3009 → Gateway settle flow on Arc
  Testnet (S17, S18); Gateway officially lists Arc Testnet with nanopayments
  support (S13).
- The Guard's existing evidence model maps cleanly: canonical audit idempotency
  (evaluation) + new durable execution idempotency (settlement) are distinct
  and complementary; the threat model's 14 preconditions give a ready-made
  acceptance checklist.
- The keyless boundary is preserved by construction: Guard never signs; the
  signer is external and structurally cannot deviate from the exact
  requirement (Gateway verification rejects any mismatch — `amount_mismatch`,
  `address_mismatch`, `invalid_signature`, S15).
- Grant alignment is current and official: Circle Developer Grants is
  explicitly for "teams building on Arc and the Circle Developer Platform",
  values "clear technical ownership", "meaningful integrations", and
  "evidence of usage, pilots" (S27), and lists agentic economic activity first
  among focused use cases; Gateway/Nanopayments are named Circle products.
- Blockers are implementation, not feasibility: no official source found
  invalidates the path; no custody is required; the residual gaps (identity
  model, cross-process audit) are documented production items that do not gate
  a bounded testnet slice.
- Claim hygiene: nothing here is a verified product capability. The
  integration remains NOT IMPLEMENTED until actually built; research findings
  are VERIFIED EXTERNAL TECHNICAL FACT only.

# Open External Questions

- Does the official Circle Grants program count a testnet-only Arc integration
  as satisfying the "meaningful integrations"/"traction" criteria? The official
  page (S27) does not state a chain/mainnet requirement; this remains NOT YET
  VALIDATED.
- Grant deadline and amount: not stated on the official Circle Grants page as
  of 2026-08-16 (S27); the Questbook portal
  (`https://circle.questbook.app/`) is the authoritative application channel.
- Does the public x402.org facilitator support Arc Testnet? Only Circle
  Gateway is verified as a facilitator for Arc Testnet (S13, S17); the x402
  protocol-level support for any `eip155` chain (S7) does not imply a live
  facilitator path.
- Arc Testnet faucet rate limits and USDC amounts at
  `https://faucet.circle.com` for Arc Testnet (S19) — unverified amounts.
- Batch timing on Gateway testnet: how quickly `X402TransferResponse.txHash`
  appears (batch-level hash, null until batched — S15) and whether
  `testnet.arcscan.app` indexes it promptly — unverified by observation (no
  testnet payment was made).
- Whether Gateway `/v1/x402/verify`'s read-only checks (balance/nonce only at
  settle, S15) are sufficient as the "transaction simulation before signing"
  step in a bounded slice, or whether an additional simulation is warranted.
- The exact 7-day-plus-buffer `validBefore` bound and whether testnet
  enforcement matches production (S17 states the requirement; no testnet
  observation was made).
- Arc Testnet RPC availability/rate limits (`https://rpc.testnet.arc.io`,
  S24) for any future explorer/chain-data checks.
- Whether the current deployed demo (https://138-124-108-146.nip.io) parity
  matters for grant review — out of scope for this decision, tracked in the
  evidence package.

Last verified: 2026-08-16
