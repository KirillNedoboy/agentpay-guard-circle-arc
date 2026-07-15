import type { PaymentIntent } from "./types";

type RequiredPaymentIntentField =
  | "agentId"
  | "intent"
  | "amount"
  | "currency"
  | "recipient"
  | "scenario"
  | "paymentRail"
  | "idempotencyKey";

const fields: RequiredPaymentIntentField[] = [
  "agentId",
  "intent",
  "amount",
  "currency",
  "recipient",
  "scenario",
  "paymentRail",
  "idempotencyKey"
];

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validatePaymentIntent(input: unknown): PaymentIntent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Payment intent must be an object.");
  }

  const record = input as Record<string, unknown>;
  const intent = {} as PaymentIntent;

  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ValidationError(`${field} must be a non-empty string.`);
    }
    intent[field] = value.trim();
  }

  return intent;
}
