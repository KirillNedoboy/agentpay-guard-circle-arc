import type { AuditRecord } from "@/domain/audit/types";
import type { PaymentIntent, PolicyDecision } from "@/domain/payment-intent/types";
import { compareDecimalStrings, divideDecimalStringByTwo, isPositiveDecimal } from "@/lib/decimal";
import type { PolicyConfig } from "./policy-config";
import { buildSpendControls, type SpendControls } from "./spend-controls";

function clampRisk(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export function evaluatePolicy(
  intent: PaymentIntent,
  policy: PolicyConfig,
  recentAuditRecords: AuditRecord[],
  providedSpendControls?: SpendControls
): PolicyDecision {
  const spendControls = providedSpendControls ?? buildSpendControls({ intent, policy, recentAuditRecords });
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

    if (
      spendControls.projectedDailySpend === null ||
      compareDecimalStrings(spendControls.projectedDailySpend, policy.limits.dailyLimitPerAgent) === 1
    ) {
      matchedRules.push("daily_limit_exceeded");
      reasonCodes.push("SESSION_BUDGET_EXCEEDED");
      reasonParts.push("Agent daily spend limit would be exceeded.");
      hasBlock = true;
      riskScore += 80;
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

  if (spendControls.velocityAttempts >= policy.velocity.maxAttemptsPerWindow) {
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
