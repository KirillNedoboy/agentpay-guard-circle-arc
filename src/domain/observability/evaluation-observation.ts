import type { Decision } from "@/domain/payment-intent/types";

export type EvaluationObservation = {
  eventType: "agentpay_evaluation_observed";
  timestamp: string;
  auditId: string;
  decision: Decision;
  replayed: boolean;
  replayMismatch: boolean | null;
  policyChanged: boolean | null;
  authorizationIssued: boolean;
  policyEvaluationDurationMs: number;
};
