import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import type { ReplayEvidence } from "@/domain/audit/replay-evidence";
import type { PolicyConfig } from "@/domain/policy/policy-config";
import { fingerprintPolicy } from "@/domain/policy/policy-fingerprint";
import { DecimalNotRepresentableError, decimalToAtomicUnits } from "@/lib/decimal";
import { fingerprintX402PaymentRequirement, type X402PaymentRequirement } from "./payment-requirement";
import type { PaymentRequirementEvidence } from "./payment-requirement-evidence";
import { buildX402ExecutionAuthorizationV2, type X402ExecutionAuthorizationV2 } from "./execution-authorization-v2";

/**
 * I2 — the pure, fail-closed execution security gate (pre-Phase-9 Circle
 * integration track).
 *
 * The gate decides whether an ALREADY-ISSUED Guard `ExecutionAuthorization`
 * v1 may become ELIGIBLE FOR A FUTURE EXTERNAL SIGNER REQUEST for ONE exact
 * x402 `PaymentRequirement`. It is a LOCAL PURE SECURITY BOUNDARY: no
 * signing, no EIP-3009 signatures, no private keys, no wallet, no Gateway
 * calls, no /verify or /settle, no Arc RPC, no transactions, no execution
 * store, no authorization consumption, no nonce, no SettlementEvidence, no
 * funds movement (I3–I6 / Phase 9 are out of scope).
 *
 * GATE PURITY: this module has no fetch, no filesystem, no process.env, no
 * network, no RPC, no wallet, no SDK, no Gateway API, no Date.now, no
 * Math.random. Inputs in, deterministic decision out; only `now` varies and
 * it is explicitly supplied.
 *
 * Fail-closed result wording: the gate means ONLY that the exact requirement
 * satisfies the LOCAL prerequisites for a future external signer request. It
 * is never "paymentApproved", "readyToPay", "readyToSettle", or
 * "transactionApproved". No signature, no payment.
 */

/**
 * Trusted recipient binding: the Guard logical recipient ID from the v1
 * authorization plus the expected EVM seller address (`payTo`).
 *
 * TRUST MODEL (documented): `X402RecipientBinding` is TRUSTED input. It MUST
 * come from trusted adapter/operator configuration in the future (I4 /
 * test harness), NEVER from the untrusted raw 402 request. The raw
 * requirement's `payTo` is attacker-influenceable; the gate only checks that
 * the requirement's payTo SEMANTICALLY equals this trusted binding. I2 tests
 * use deterministic test-only addresses (e.g. 0x1111...1111), never a real
 * seller. No real payTo is stored in the global policy.
 */
export type X402RecipientBinding = {
  /** Guard logical recipient ID, must equal `authorization.recipient` exactly. */
  recipient: string;
  /** Expected EVM seller address (trusted adapter/operator config only). */
  payTo: string;
};

/**
 * All gate inputs are explicit — `now` is REQUIRED and must never be
 * `Date.now()` inside the gate (deterministic expiry testing and purity).
 * The `paymentRequirement` MUST already be I1-validated
 * (`validateX402PaymentRequirement`); the gate enforces the policy allowlist,
 * not x402 syntax.
 */
export type X402ExecutionGateInput = {
  authorization: ExecutionAuthorization;
  replayEvidence: ReplayEvidence;
  paymentRequirement: X402PaymentRequirement;
  paymentRequirementEvidence: PaymentRequirementEvidence;
  recipientBinding: X402RecipientBinding;
  policy: PolicyConfig;
  now: Date;
};

/**
 * Stable, deterministic rejection reason codes — the security contract, not
 * free-form error strings. Documented fixed evaluation order:
 *
 *  1. X402_GATE_AUTHORIZATION_DECISION_NOT_ALLOWED   — authorization.decision !== "ALLOW"
 *  2. X402_GATE_REPLAY_MISMATCH                      — replayEvidence.replayMismatch === true
 *  3. X402_GATE_REPLAY_STATE_UNKNOWN                 — replayEvidence.replayMismatch === null
 *  4. X402_GATE_POLICY_CHANGED                       — replayEvidence.policyChanged === true
 *  5. X402_GATE_POLICY_STATE_UNKNOWN                 — replayEvidence.policyChanged === null
 *  6. X402_GATE_POLICY_ATTRIBUTION_MISMATCH          — authorization policyVersion/fingerprint != current policy
 *  7. X402_GATE_AUTHORIZATION_EXPIRED                — now >= expiresAt (or invalid `now`; fail closed)
 *  8. X402_GATE_AUTHORIZATION_TIMESTAMP_MALFORMED    — expiresAt unparseable (fail closed)
 *  9. X402_GATE_REQUIREMENT_DIGEST_MISMATCH          — recomputed digest != evidence digest
 * 10. X402_GATE_NETWORK_NOT_ALLOWED                  — no allowlist entry for network+scheme
 * 11. X402_GATE_ASSET_NOT_ALLOWED                    — asset != matched entry asset (entry-dependent)
 * 12. X402_GATE_EIP712_DOMAIN_NOT_ALLOWED            — effective EIP-712 domain/transfer method/flow != entry (entry-dependent)
 * 13. X402_GATE_TIMEOUT_EXCEEDED                     — maxTimeoutSeconds > entry bound (entry-dependent)
 * 14. X402_GATE_RECIPIENT_BINDING_MISMATCH           — recipientBinding.recipient != authorization.recipient
 * 15. X402_GATE_PAYTO_MISMATCH                       — requirement.payTo != trusted recipientBinding.payTo
 * 16. X402_GATE_AMOUNT_NOT_REPRESENTABLE             — maxAmountUSDC not representable at entry decimals (entry-dependent)
 * 17. X402_GATE_AMOUNT_MISMATCH                      — converted amount != requirement.amount (entry-dependent)
 *
 * Entry-dependent checks (11–13, 16–17) apply only when a network allowlist
 * entry matched. All applicable codes are collected in this fixed order;
 * the array is deterministic and deduplicated per check (each check fires at
 * most one code).
 */
export type X402ExecutionGateRejectionCode =
  | "X402_GATE_AUTHORIZATION_DECISION_NOT_ALLOWED"
  | "X402_GATE_REPLAY_MISMATCH"
  | "X402_GATE_REPLAY_STATE_UNKNOWN"
  | "X402_GATE_POLICY_CHANGED"
  | "X402_GATE_POLICY_STATE_UNKNOWN"
  | "X402_GATE_POLICY_ATTRIBUTION_MISMATCH"
  | "X402_GATE_AUTHORIZATION_EXPIRED"
  | "X402_GATE_AUTHORIZATION_TIMESTAMP_MALFORMED"
  | "X402_GATE_REQUIREMENT_DIGEST_MISMATCH"
  | "X402_GATE_NETWORK_NOT_ALLOWED"
  | "X402_GATE_ASSET_NOT_ALLOWED"
  | "X402_GATE_EIP712_DOMAIN_NOT_ALLOWED"
  | "X402_GATE_TIMEOUT_EXCEEDED"
  | "X402_GATE_RECIPIENT_BINDING_MISMATCH"
  | "X402_GATE_PAYTO_MISMATCH"
  | "X402_GATE_AMOUNT_NOT_REPRESENTABLE"
  | "X402_GATE_AMOUNT_MISMATCH";

export const X402_EXECUTION_GATE_ALLOWED_REASON_CODE = "X402_EXECUTION_GATE_ALLOWED" as const;

/**
 * Discriminated-union gate result.
 *
 * On success, `authorization` is the X402-bound v2 execution authorization —
 * eligibility evidence only. On any failure the result is fail-closed:
 * `authorization: null`, `executionStatus: "not_executed"`, `fundsMoved:
 * false`, with all applicable deterministic rejection codes.
 */
export type X402ExecutionGateResult =
  | {
      eligibleForSignerRequest: true;
      reasonCodes: ["X402_EXECUTION_GATE_ALLOWED"];
      authorization: X402ExecutionAuthorizationV2;
    }
  | {
      eligibleForSignerRequest: false;
      reasonCodes: X402ExecutionGateRejectionCode[];
      authorization: null;
      executionStatus: "not_executed";
      fundsMoved: false;
    };

/**
 * Case-insensitive EVM address semantic equality (EVM addresses are
 * hex-encoded, case is not semantically significant). Used for asset,
 * verifyingContract, and payTo comparisons. The ORIGINAL exact value is
 * preserved in the requirement, evidence, and v2 authorization — only the
 * COMPARISON is case-insensitive.
 */
function evmAddressesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Pure, deterministic execution security gate. Never throws on policy or
 * evidence mismatch (fails closed instead); the only input that varies is the
 * explicitly supplied `now`.
 */
export function evaluateX402ExecutionGate(input: X402ExecutionGateInput): X402ExecutionGateResult {
  const { authorization, replayEvidence, paymentRequirement, paymentRequirementEvidence, recipientBinding, policy, now } = input;

  const rejections: X402ExecutionGateRejectionCode[] = [];

  // 1. ALLOW-only defense-in-depth (the v1 type is a literal, but the gate
  //    re-checks at runtime — no path from REVIEW/BLOCK).
  if (authorization.decision !== "ALLOW") {
    rejections.push("X402_GATE_AUTHORIZATION_DECISION_NOT_ALLOWED");
  }

  // 2. Replay evidence: mismatch or unknown state fails closed.
  if (replayEvidence.replayMismatch === true) {
    rejections.push("X402_GATE_REPLAY_MISMATCH");
  } else if (replayEvidence.replayMismatch === null) {
    rejections.push("X402_GATE_REPLAY_STATE_UNKNOWN");
  }

  // 3. Policy drift: changed or unknown state fails closed.
  if (replayEvidence.policyChanged === true) {
    rejections.push("X402_GATE_POLICY_CHANGED");
  } else if (replayEvidence.policyChanged === null) {
    rejections.push("X402_GATE_POLICY_STATE_UNKNOWN");
  }

  // 4. Current attribution: the authorization must be attributable to the
  //    CURRENTLY loaded policy, both by version and by recomputed fingerprint.
  const currentPolicyFingerprint = fingerprintPolicy(policy);
  if (authorization.policyVersion !== policy.policyVersion || authorization.policyFingerprint !== currentPolicyFingerprint) {
    rejections.push("X402_GATE_POLICY_ATTRIBUTION_MISMATCH");
  }

  // 5. Runtime expiry (Guard authorization TTL control — DIFFERENT from
  //    EIP-3009 validBefore; no EIP-3009 validity window is generated here).
  //    now >= expiresAt rejects; now === expiresAt rejects; unparseable
  //    expiresAt fails closed with a dedicated malformed-timestamp code.
  //    An invalid `now` (NaN time) also fails closed under the expiry code:
  //    eligibility can never be proven against an unreadable clock.
  if (Number.isNaN(now.getTime())) {
    rejections.push("X402_GATE_AUTHORIZATION_EXPIRED");
  } else {
    const expiresAtMs = Date.parse(authorization.expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      rejections.push("X402_GATE_AUTHORIZATION_TIMESTAMP_MALFORMED");
    } else if (now.getTime() >= expiresAtMs) {
      rejections.push("X402_GATE_AUTHORIZATION_EXPIRED");
    }
  }

  // 6. Requirement digest: recompute with the I1 helper (never a second
  //    algorithm) and require equality with the evidence digest. The
  //    evidence is never trusted blindly.
  if (fingerprintX402PaymentRequirement(paymentRequirement) !== paymentRequirementEvidence.requirementDigest) {
    rejections.push("X402_GATE_REQUIREMENT_DIGEST_MISMATCH");
  }

  // 7. Network allowlist: look up the policy entry by network AND scheme. A
  //    syntactically valid but non-allowlisted EVM network (e.g.
  //    eip155:84532) is rejected HERE, not at I1 syntax validation.
  const entry = policy.x402Execution.allowedRequirements.find(
    (candidate) => candidate.network === paymentRequirement.network && candidate.scheme === paymentRequirement.scheme
  );

  if (!entry) {
    rejections.push("X402_GATE_NETWORK_NOT_ALLOWED");
  } else {
    // 8. Asset binding: semantic EVM-address equality with the matched entry.
    if (!evmAddressesEqual(entry.asset, paymentRequirement.asset)) {
      rejections.push("X402_GATE_ASSET_NOT_ALLOWED");
    }

    // 9. Gateway EIP-712 domain binding: the requirement's EFFECTIVE domain
    //    must match the matched entry. I1 permits optional
    //    assetTransferMethod/paymentFlow with official defaults
    //    ("eip3009"/"authorization"); the gate treats omission as those
    //    defaults via an internal/effective comparison and NEVER mutates the
    //    original requirement object.
    const effectiveAssetTransferMethod = paymentRequirement.extra.assetTransferMethod ?? "eip3009";
    const effectivePaymentFlow = paymentRequirement.extra.paymentFlow ?? "authorization";
    if (
      paymentRequirement.extra.name !== entry.eip712.name ||
      paymentRequirement.extra.version !== entry.eip712.version ||
      !evmAddressesEqual(entry.eip712.verifyingContract, paymentRequirement.extra.verifyingContract) ||
      effectiveAssetTransferMethod !== entry.assetTransferMethod ||
      effectivePaymentFlow !== entry.paymentFlow
    ) {
      rejections.push("X402_GATE_EIP712_DOMAIN_NOT_ALLOWED");
    }

    // 10. Timeout policy bound: the requirement's maxTimeoutSeconds must not
    //     exceed the matched entry's configured maximum. NOT the Guard
    //     authorization TTL.
    if (paymentRequirement.maxTimeoutSeconds > entry.maxTimeoutSeconds) {
      rejections.push("X402_GATE_TIMEOUT_EXCEEDED");
    }
  }

  // 11. Logical recipient → payTo binding (not entry-dependent): the trusted
  //     binding's recipient must equal the v1 authorization recipient exactly,
  //     and the requirement's payTo must semantically equal the trusted
  //     binding's payTo. The requirement's own payTo is NEVER the trusted
  //     binding source.
  if (recipientBinding.recipient !== authorization.recipient) {
    rejections.push("X402_GATE_RECIPIENT_BINDING_MISMATCH");
  }
  if (!evmAddressesEqual(recipientBinding.payTo, paymentRequirement.payTo)) {
    rejections.push("X402_GATE_PAYTO_MISMATCH");
  }

  // 12. Exact amount binding (entry-dependent): convert the v1
  //     authorization.maxAmountUSDC (decimal USDC string) to atomic units
  //     with the matched entry's assetDecimals using pure decimal-string
  //     BigInt math — never Number()/parseFloat(). More fractional digits
  //     than the entry decimals → NOT_REPRESENTABLE (never rounded); the
  //     converted value must equal requirement.amount exactly.
  if (entry) {
    let amountAtomic: string | null = null;
    try {
      amountAtomic = decimalToAtomicUnits(authorization.maxAmountUSDC, entry.assetDecimals);
    } catch (error) {
      if (error instanceof DecimalNotRepresentableError) {
        rejections.push("X402_GATE_AMOUNT_NOT_REPRESENTABLE");
      } else {
        throw error;
      }
    }
    if (amountAtomic !== null && amountAtomic !== paymentRequirement.amount) {
      rejections.push("X402_GATE_AMOUNT_MISMATCH");
    }
  }

  if (rejections.length > 0) {
    return {
      eligibleForSignerRequest: false,
      reasonCodes: rejections,
      authorization: null,
      executionStatus: "not_executed",
      fundsMoved: false
    };
  }

  return {
    eligibleForSignerRequest: true,
    reasonCodes: [X402_EXECUTION_GATE_ALLOWED_REASON_CODE],
    authorization: buildX402ExecutionAuthorizationV2({
      authorization,
      paymentRequirement,
      paymentRequirementEvidence,
      trustedPayTo: recipientBinding.payTo,
      policy
    })
  };
}
