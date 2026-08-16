import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import type { PolicyConfig } from "@/domain/policy/policy-config";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";
import { stableSha256 } from "@/lib/stable-json";
import type { X402PaymentRequirement } from "./payment-requirement";
import { x402NetworkChainId } from "./payment-requirement";
import type { PaymentRequirementEvidence } from "./payment-requirement-evidence";

/**
 * X402-bound Execution Authorization v2 (I2 artifact).
 *
 * Built ONLY from a fully passing execution security gate. It is the
 * gate-artifact-level commitment that closes the T05 x402 binding gap: the
 * deterministic `authorizationId` DIRECTLY commits the parent v1
 * authorization, the payment requirement digest, the audit record, the
 * logical recipient, the trusted payTo, the network, the asset address, the
 * atomic amount, the policy attribution, and the parent's expiry — no
 * randomness, no wall clock, no nonce, no signature, no transaction.
 *
 * v2 is NOT an executable capability. It asserts only:
 * `eligibility: "eligible_for_external_signer_request"` — the exact
 * requirement satisfied the LOCAL prerequisites for a FUTURE external signer
 * request. It never means "payment approved", "ready to pay", "ready to
 * settle", or "transaction approved". No signature, no payment.
 *
 * CRITICAL non-goals (I3–I5, Phase 9): no nonce, no signature, no payer
 * private key, no transaction, no Gateway transfer ID, no txHash, no
 * settlement state, no funds movement. `executionStatus: "not_executed"` and
 * `fundsMoved: false` are literal constants.
 *
 * `issuedAt`/`expiresAt` COPY the parent v1 values (Guard authorization TTL,
 * current local 300 s). They are deliberately NOT derived from the gate's
 * `now` input — the gate decides eligibility, the evidence keeps the parent
 * timestamps.
 */
export type X402ExecutionAuthorizationV2 = {
  authorizationType: "execution_authorization";
  version: "v2";
  authorizationId: string;
  parentAuthorizationId: string;
  auditId: string;
  intentId: string;
  idempotencyKey: string;
  agentId: string;
  recipient: string;
  decision: "ALLOW";
  policyId: string;
  policyVersion: string;
  policyFingerprint: string;
  paymentRequirementDigest: string;
  x402: {
    protocolVersion: 2;
    scheme: "exact";
    network: string;
    chainId: string;
    assetSymbol: "USDC";
    assetAddress: string;
    assetDecimals: 6;
    payTo: string;
    amountAtomic: string;
    maxTimeoutSeconds: number;
    eip712: {
      name: string;
      version: string;
      verifyingContract: string;
    };
    assetTransferMethod: "eip3009";
    paymentFlow: "authorization";
  };
  issuedAt: string;
  expiresAt: string;
  executionScope: ["prepare", "simulate"];
  eligibility: "eligible_for_external_signer_request";
  executionStatus: "not_executed";
  fundsMoved: false;
};

/**
 * Pure builder inputs. `trustedPayTo` is the adapter/operator-configured
 * expected seller address (X402RecipientBinding.payTo) — NEVER the raw 402
 * request's payTo by itself.
 */
export type X402ExecutionAuthorizationV2Input = {
  authorization: ExecutionAuthorization;
  paymentRequirement: X402PaymentRequirement;
  paymentRequirementEvidence: PaymentRequirementEvidence;
  trustedPayTo: string;
  policy: PolicyConfig;
};

/**
 * Deterministic v2 authorizationId: `auth_<64 lowercase hex>` (repo
 * convention) over the stable-JSON SHA-256 of the directly committed fields.
 * Reuses the repo's stable-JSON/SHA-256 conventions (src/lib/stable-json.ts),
 * so key insertion order is irrelevant and identical inputs always yield the
 * identical id. `now` plays no part — same exact inputs (including the same
 * parent expiry) produce the same id; a different requirement digest
 * produces a different id.
 */
function buildV2AuthorizationId(input: X402ExecutionAuthorizationV2Input): string {
  const {
    authorization,
    paymentRequirement,
    paymentRequirementEvidence,
    trustedPayTo,
    policy
  } = input;
  const committed = {
    parentAuthorizationId: authorization.authorizationId,
    paymentRequirementDigest: paymentRequirementEvidence.requirementDigest,
    auditId: authorization.auditId,
    recipient: authorization.recipient,
    payTo: trustedPayTo,
    network: paymentRequirement.network,
    asset: paymentRequirement.asset,
    amountAtomic: paymentRequirement.amount,
    policyVersion: policy.policyVersion,
    policyFingerprint: fingerprintPolicy(policy),
    expiresAt: authorization.expiresAt
  };
  return `auth_${stableSha256(committed)}`;
}

/**
 * Builds the X402-bound v2 authorization from a FULLY gate-passed input.
 *
 * SECURITY CONTRACT: this builder performs NO checks of its own. It MUST only
 * be called after `evaluateX402ExecutionGate` returned
 * `eligibleForSignerRequest: true` — the gate is the security boundary. The
 * builder is pure and deterministic: same inputs in, same authorization out.
 * It never mutates the supplied v1 authorization, requirement, or policy.
 */
export function buildX402ExecutionAuthorizationV2(
  input: X402ExecutionAuthorizationV2Input
): X402ExecutionAuthorizationV2 {
  const { authorization, paymentRequirement, paymentRequirementEvidence, policy } = input;

  return {
    authorizationType: "execution_authorization",
    version: "v2",
    authorizationId: buildV2AuthorizationId(input),
    parentAuthorizationId: authorization.authorizationId,
    auditId: authorization.auditId,
    intentId: authorization.intentId,
    idempotencyKey: authorization.idempotencyKey,
    agentId: authorization.agentId,
    recipient: authorization.recipient,
    decision: "ALLOW",
    policyId: authorization.policyId,
    policyVersion: policy.policyVersion,
    policyFingerprint: fingerprintPolicy(policy),
    paymentRequirementDigest: paymentRequirementEvidence.requirementDigest,
    x402: {
      protocolVersion: 2,
      scheme: paymentRequirement.scheme,
      network: paymentRequirement.network,
      chainId: x402NetworkChainId(paymentRequirement.network),
      assetSymbol: "USDC",
      assetAddress: paymentRequirement.asset,
      assetDecimals: 6,
      payTo: paymentRequirement.payTo,
      amountAtomic: paymentRequirement.amount,
      maxTimeoutSeconds: paymentRequirement.maxTimeoutSeconds,
      eip712: {
        name: paymentRequirement.extra.name,
        version: paymentRequirement.extra.version,
        verifyingContract: paymentRequirement.extra.verifyingContract
      },
      assetTransferMethod: "eip3009",
      paymentFlow: "authorization"
    },
    issuedAt: authorization.issuedAt,
    expiresAt: authorization.expiresAt,
    executionScope: ["prepare", "simulate"],
    eligibility: "eligible_for_external_signer_request",
    executionStatus: "not_executed",
    fundsMoved: false
  };
}
