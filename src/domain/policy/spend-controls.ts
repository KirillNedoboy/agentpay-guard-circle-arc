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
  dailyRemainingBefore: string;
  projectedDailySpend: string;
  velocityWindowSeconds: number;
  velocityAttemptCount: number;
  velocityMaxAttempts: number;
};

function isSameUtcDay(timestamp: string, now: Date): boolean {
  return timestamp.slice(0, 10) === now.toISOString().slice(0, 10);
}

function decimalOrThrow(value: string | null, label: string): string {
  if (value === null) {
    throw new Error(`Unable to calculate ${label} from decimal policy evidence.`);
  }
  return value;
}

export function calculateSpendControls(
  intent: PaymentIntent,
  policy: PolicyConfig,
  recentAuditRecords: AuditRecord[],
  now = new Date()
): SpendControls {
  const allowedAmountsToday = recentAuditRecords
    .filter((record) => record.agentId === intent.agentId && record.decision === "ALLOW" && isSameUtcDay(record.timestamp, now))
    .map((record) => record.amount);
  const dailyAllowedSpend = decimalOrThrow(addDecimalStrings(allowedAmountsToday.length > 0 ? allowedAmountsToday : ["0"]), "daily spend");
  const projectedDailySpend = decimalOrThrow(addDecimalStrings([dailyAllowedSpend, intent.amount]), "projected daily spend");
  const dailyRemainingBefore = subtractDecimalStrings(policy.limits.dailyLimitPerAgent, dailyAllowedSpend) ?? "0";
  const windowStart = now.getTime() - policy.velocity.windowSeconds * 1000;
  const velocityAttemptCount = recentAuditRecords.filter(
    (record) => record.agentId === intent.agentId && Date.parse(record.timestamp) >= windowStart
  ).length;

  return {
    currency: intent.currency,
    requestedAmount: intent.amount,
    maxAmountPerPayment: policy.limits.maxAmountPerPayment,
    reviewThreshold: policy.limits.reviewThreshold,
    dailyLimit: policy.limits.dailyLimitPerAgent,
    dailyAllowedSpend,
    dailyRemainingBefore,
    projectedDailySpend,
    velocityWindowSeconds: policy.velocity.windowSeconds,
    velocityAttemptCount,
    velocityMaxAttempts: policy.velocity.maxAttemptsPerWindow
  };
}
