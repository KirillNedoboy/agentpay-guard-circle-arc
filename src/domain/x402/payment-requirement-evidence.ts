import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import {
  fingerprintX402PaymentRequirement,
  type X402PaymentRequirement
} from "./payment-requirement";

/**
 * Deterministic, non-secret reviewer evidence for a validated x402 payment
 * requirement. Pure evidence: no signature, no private key, no transaction
 * hash, no settlement status, no wall-clock timestamp, no network action,
 * and no authorization decision. The `requirementDigest` commits the full
 * normalized requirement (including `extra`) via the stable-JSON SHA-256
 * digest, so reviewers and downstream gates can verify that the exact
 * requirement they see is the exact requirement that was bound.
 *
 * Field list intentionally mirrors the authoritative, non-secret
 * `PaymentRequirements` fields (scheme, network, amount, asset, payTo,
 * maxTimeoutSeconds — S9 §5.1.2); `extra` is committed by the digest rather
 * than duplicated.
 */
export type PaymentRequirementEvidence = {
  evidenceType: "x402_payment_requirement";
  version: "v1";
  protocol: "x402";
  x402Version: 2;
  requirementDigest: string;
  scheme: "exact";
  network: string;
  amountAtomic: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
};

/**
 * Pure builder: derives the digest deterministically from the validated
 * requirement and exposes authoritative non-secret evidence. Performs no
 * network action and makes no authorization decision.
 */
export function buildPaymentRequirementEvidence(
  requirement: X402PaymentRequirement
): PaymentRequirementEvidence {
  return {
    evidenceType: "x402_payment_requirement",
    version: "v1",
    protocol: "x402",
    x402Version: 2,
    requirementDigest: fingerprintX402PaymentRequirement(requirement),
    scheme: requirement.scheme,
    network: requirement.network,
    amountAtomic: requirement.amount,
    asset: requirement.asset,
    payTo: requirement.payTo,
    maxTimeoutSeconds: requirement.maxTimeoutSeconds
  };
}

/**
 * ASSOCIATION evidence only: links a Guard `ExecutionAuthorization` (v1,
 * unchanged) to the digest of a validated x402 payment requirement.
 *
 * This is NOT "execution approved", NOT "payment ready", and NOT
 * "settlement authorized". `executionStatus: "not_executed"` and
 * `fundsMoved: false` are literal constants; the record asserts only that
 * an authorization and a payment requirement exist and are associated. It
 * performs no network action, makes no assertion that amount/payTo/network
 * are safe to execute (that is I2's execution security gate), and never
 * mutates the supplied authorization.
 */
export type AuthorizedPaymentRequirementEvidence = {
  evidenceType: "authorized_x402_payment_requirement";
  version: "v1";
  auditId: string;
  authorizationId: string;
  requirementDigest: string;
  executionStatus: "not_executed";
  fundsMoved: false;
};

/**
 * Pure builder: auditId and authorizationId come verbatim from the supplied
 * `ExecutionAuthorization`; requirementDigest comes verbatim from the
 * validated payment requirement evidence. No mutation of the supplied
 * authorization object. Association only — see
 * `AuthorizedPaymentRequirementEvidence` for what this does NOT claim.
 */
export function buildAuthorizedPaymentRequirementEvidence(
  authorization: ExecutionAuthorization,
  paymentRequirementEvidence: PaymentRequirementEvidence
): AuthorizedPaymentRequirementEvidence {
  return {
    evidenceType: "authorized_x402_payment_requirement",
    version: "v1",
    auditId: authorization.auditId,
    authorizationId: authorization.authorizationId,
    requirementDigest: paymentRequirementEvidence.requirementDigest,
    executionStatus: "not_executed",
    fundsMoved: false
  };
}
