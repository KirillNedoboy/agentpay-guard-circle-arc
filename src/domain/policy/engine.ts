import type { AuditRecord } from "@/domain/audit/types";
import type { PaymentIntent, PolicyDecision } from "@/domain/payment-intent/types";
import { addDecimalStrings, compareDecimalStrings, divideDecimalStringByTwo, isPositiveDecimal } from "@/lib/decimal";
import type { PolicyConfig } from "./policy-config";

function clampRisk(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function isToday(timestamp: string): boolean {
  return timestamp.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

export function evaluatePolicy(
  intent: PaymentIntent,
  policy: PolicyConfig,
  recentAuditRecords: AuditRecord[]
): PolicyDecision {
  const matchedRules: string[] = [];
  const reasonCodes: string[] = ["RAIL_PREVIEW_ONLY"];
  const reasonParts: string[] = [];
  let riskScore = 10;
  let hasBlock = false;
  let hasReview = false;

  const amountIsValid = isPositiveDecimal(intent.amount);
  if (!amountIsValid) {
    matchedRules.push("amount_invalid");
    reasonCodes.push("AMOUNT_INVALID");
    reasonParts.push("Amount must be a positive decimal string.");
    hasBlock = true;
    riskScore += 80;
  }

  if (!policy.currency.supported.includes(intent.currency)) {
    matchedRules.push("currency_unsupported");
    reasonCodes.push("CURRENCY_UNSUPPORTED");
    reasonParts.push("Currency is not supported by the active policy.");
    hasBlock = true;
    riskScore += 80;
  }

  if (policy.deniedRecipients.includes(intent.recipient)) {
    matchedRules.push("recipient_denied");
    reasonCodes.push("RECIPIENT_BLOCKED");
    reasonParts.push("Recipient is denied by policy.");
    hasBlock = true;
    riskScore += 90;
  } else if (policy.allowlistedRecipients.includes(intent.recipient)) {
    matchedRules.push("recipient_allowlisted");
    reasonCodes.push("RECIPIENT_TRUSTED");
  } else if (policy.reviewRecipients.includes(intent.recipient)) {
    matchedRules.push("recipient_requires_review");
    reasonCodes.push("RECIPIENT_REVIEW_REQUIRED");
    reasonParts.push("Recipient requires operator review.");
    hasReview = true;
    riskScore += policy.riskWeights.reviewRecipient;
  } else {
    matchedRules.push("recipient_unknown");
    reasonCodes.push("RECIPIENT_UNKNOWN_REQUIRES_REVIEW");
    reasonParts.push("Recipient is not allowlisted.");
    hasReview = true;
    riskScore += policy.riskWeights.unknownRecipient;
  }

  if (policy.allowedScenarios.includes(intent.scenario)) {
    matchedRules.push("scenario_allowed");
    reasonCodes.push("PURPOSE_ALLOWED");
  } else {
    matchedRules.push("scenario_unknown");
    reasonCodes.push("PURPOSE_NOT_ALLOWED");
    reasonParts.push("Scenario is not in the allowed scenario list.");
    hasReview = true;
    riskScore += policy.riskWeights.unknownScenario;
  }

  if (amountIsValid) {
    const maxComparison = compareDecimalStrings(intent.amount, policy.limits.maxAmountPerPayment);
    if (maxComparison === null || maxComparison > 0) {
      matchedRules.push("amount_above_hard_max");
      reasonCodes.push("AMOUNT_EXCEEDS_SINGLE_PAYMENT_LIMIT");
      reasonParts.push("Amount is above the hard max per payment.");
      hasBlock = true;
      riskScore += 85;
    } else {
      matchedRules.push("amount_below_per_payment_limit");
      reasonCodes.push("AMOUNT_WITHIN_LIMIT");
      if (compareDecimalStrings(intent.amount, policy.limits.reviewThreshold) === 1) {
        matchedRules.push("amount_above_review_threshold");
        reasonCodes.push("AMOUNT_EXCEEDS_REVIEW_THRESHOLD");
        reasonParts.push("Amount exceeds the review threshold.");
        hasReview = true;
        riskScore += policy.riskWeights.amountAboveReviewThreshold;
      }
      const halfLimit = divideDecimalStringByTwo(policy.limits.maxAmountPerPayment);
      if (halfLimit && compareDecimalStrings(intent.amount, halfLimit) === 1) {
        matchedRules.push("amount_above_half_limit");
        riskScore += policy.riskWeights.amountAboveHalfLimit;
      }
    }

    const todaysAllowedAmounts = recentAuditRecords
      .filter((record) => record.agentId === intent.agentId && record.decision === "ALLOW" && isToday(record.timestamp))
      .map((record) => record.amount);
    const dailyTotal = addDecimalStrings([...todaysAllowedAmounts, intent.amount]);
    if (dailyTotal === null || compareDecimalStrings(dailyTotal, policy.limits.dailyLimitPerAgent) === 1) {
      matchedRules.push("daily_limit_exceeded");
      reasonCodes.push("SESSION_BUDGET_EXCEEDED");
      reasonParts.push("Agent daily spend limit would be exceeded.");
      hasBlock = true;
      riskScore += 80;
    }
  }

  const routeContext = intent.routeContext;
  if (routeContext?.transferMode === "cctp") {
    if (routeContext.sourceChain === routeContext.destinationChain) {
      matchedRules.push("cctp_source_equals_destination");
      reasonCodes.push("CCTP_SOURCE_EQUALS_DESTINATION");
      reasonParts.push("CCTP source and destination chains must differ.");
      hasBlock = true;
    } else {
      const cctpRouteSupported = policy.crossChain.allowedCctpPairs.some(
        (pair) => pair.sourceChain === routeContext.sourceChain && pair.destinationChain === routeContext.destinationChain
      );
      if (!cctpRouteSupported) {
        matchedRules.push("cctp_route_unsupported");
        reasonCodes.push("CCTP_ROUTE_UNSUPPORTED");
        reasonParts.push("CCTP route is not allowed by the active local policy.");
        hasBlock = true;
      }
    }

    if (routeContext.attestationStatus === "verified") {
      matchedRules.push("cctp_attestation_unverifiable_in_preview");
      reasonCodes.push("CCTP_ATTESTATION_UNVERIFIABLE_IN_PREVIEW");
      reasonParts.push("AgentPay Guard cannot verify a claimed CCTP attestation in preview.");
      hasReview = true;
    }

    if (
      amountIsValid &&
      routeContext.finalityMode === "fast-transfer" &&
      compareDecimalStrings(intent.amount, policy.crossChain.fastTransferReviewThreshold) === 1
    ) {
      matchedRules.push("cctp_fast_transfer_review_required");
      reasonCodes.push("CCTP_FAST_TRANSFER_REVIEW_REQUIRED");
      reasonParts.push("Fast Transfer amount exceeds the local CCTP review threshold.");
      hasReview = true;
    }

    if (
      amountIsValid &&
      routeContext.walletControlModel === "developer-controlled" &&
      compareDecimalStrings(intent.amount, policy.crossChain.developerControlledReviewThreshold) === 1
    ) {
      matchedRules.push("cctp_developer_controlled_review_required");
      reasonCodes.push("CCTP_DEVELOPER_CONTROLLED_REVIEW_REQUIRED");
      reasonParts.push("Developer-controlled wallet amount exceeds the local CCTP review threshold.");
      hasReview = true;
    }

    if (amountIsValid) {
      const totalProposedSpend = addDecimalStrings([intent.amount, routeContext.estimatedFee ?? "0"]);
      if (totalProposedSpend && compareDecimalStrings(totalProposedSpend, policy.crossChain.maxTotalUsdcSpend) === 1) {
        matchedRules.push("total_usdc_budget_exceeded");
        reasonCodes.push("TOTAL_USDC_BUDGET_EXCEEDED");
        reasonParts.push("Total proposed USDC spend exceeds the local CCTP budget.");
        hasBlock = true;
      }
    }
  }

  const normalizedIntent = intent.intent.toLowerCase();
  const suspiciousMatches = policy.suspiciousKeywords.filter((keyword) => normalizedIntent.includes(keyword.toLowerCase()));
  if (suspiciousMatches.length > 0) {
    matchedRules.push("suspicious_keyword_detected");
    reasonCodes.push("SUSPICIOUS_INTENT_KEYWORD");
    reasonParts.push("Suspicious intent keywords were detected.");
    hasReview = true;
    riskScore += policy.riskWeights.suspiciousKeyword * suspiciousMatches.length;
  }

  const windowStart = Date.now() - policy.velocity.windowSeconds * 1000;
  const attemptsInWindow = recentAuditRecords.filter(
    (record) => record.agentId === intent.agentId && Date.parse(record.timestamp) >= windowStart
  ).length;
  if (attemptsInWindow >= policy.velocity.maxAttemptsPerWindow) {
    matchedRules.push("velocity_limit_exceeded");
    reasonCodes.push("VELOCITY_LIMIT_EXCEEDED");
    reasonParts.push("Agent velocity limit was exceeded.");
    hasReview = true;
    riskScore += policy.riskWeights.velocityExceeded;
  }

  riskScore = clampRisk(riskScore);
  const thresholdBlocked = riskScore >= policy.decisionThresholds.blockAt && (hasBlock || suspiciousMatches.length > 0);
  const decision = hasBlock || thresholdBlocked ? "BLOCK" : hasReview || riskScore >= policy.decisionThresholds.reviewAt ? "REVIEW" : "ALLOW";

  if (decision === "ALLOW") {
    return {
      decision,
      riskScore,
      reason: "Recipient is allowlisted, amount is below limits, and scenario is allowed.",
      matchedRules,
      reasonCodes,
      policyId: policy.policyId
    };
  }

  return {
    decision,
    riskScore,
    reason: reasonParts.join(" ") || "Policy requires review before payment can proceed.",
    matchedRules,
    reasonCodes,
    policyId: policy.policyId
  };
}
