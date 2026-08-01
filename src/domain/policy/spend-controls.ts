import type { AuditRecord } from "@/domain/audit/types";
import type { PaymentIntent } from "@/domain/payment-intent/types";
import { addDecimalStrings, subtractDecimalStrings } from "@/lib/decimal";
import type { PolicyConfig } from "./policy-config";

export type SpendControls = {
  currency: string;
  requestedAmount: string;
  maxAmountPerPayment: string;
  reviewThreshold: string;
  dailyLimit: string;
  dailyAllowedSpend: string;
  dailyRemainingBeforeRequest: string | null;
  projectedDailySpend: string | null;
  velocityWindowSeconds: number;
  velocityAttempts: number;
  velocityMaxAttempts: number;
};

function isSameUtcDay(timestamp: string, now: Date): boolean {
  return timestamp.slice(0, 10) === now.toISOString().slice(0, 10);
}

export function buildSpendControls(input: {
  intent: PaymentIntent;
  policy: PolicyConfig;
  recentAuditRecords: AuditRecord[];
  now?: Date;
}): SpendControls {
  const now = input.now ?? new Date();
  const dailyAllowedAmounts = input.recentAuditRecords
    .filter((record) => record.agentId === input.intent.agentId && record.decision === "ALLOW" && isSameUtcDay(record.timestamp, now))
    .map((record) => record.amount);
  const dailyAllowedSpend = addDecimalStrings(dailyAllowedAmounts) ?? "0";
  const windowStart = now.getTime() - input.policy.velocity.windowSeconds * 1000;
  const velocityAttempts = input.recentAuditRecords.filter(
    (record) => record.agentId === input.intent.agentId && Date.parse(record.timestamp) >= windowStart
  ).length;

  return {
    currency: input.intent.currency,
    requestedAmount: input.intent.amount,
    maxAmountPerPayment: input.policy.limits.maxAmountPerPayment,
    reviewThreshold: input.policy.limits.reviewThreshold,
    dailyLimit: input.policy.limits.dailyLimitPerAgent,
    dailyAllowedSpend,
    dailyRemainingBeforeRequest: subtractDecimalStrings(input.policy.limits.dailyLimitPerAgent, dailyAllowedSpend),
    projectedDailySpend: addDecimalStrings([dailyAllowedSpend, input.intent.amount]),
    velocityWindowSeconds: input.policy.velocity.windowSeconds,
    velocityAttempts,
    velocityMaxAttempts: input.policy.velocity.maxAttemptsPerWindow
  };
}
