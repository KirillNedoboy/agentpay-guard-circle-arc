import { stableSha256 } from "@/lib/stable-json";
import type { PaymentIntent } from "./types";

export function fingerprintIntent(intent: PaymentIntent): string {
  return `sha256:${stableSha256({
    agentId: intent.agentId,
    intent: intent.intent,
    amount: intent.amount,
    currency: intent.currency,
    recipient: intent.recipient,
    scenario: intent.scenario,
    paymentRail: intent.paymentRail,
    idempotencyKey: intent.idempotencyKey,
    ...(intent.operation ? { operation: intent.operation } : {}),
    ...(intent.spender ? { spender: intent.spender } : {}),
    ...(intent.amountBaseUnits ? { amountBaseUnits: intent.amountBaseUnits } : {}),
    ...(intent.routeContext ? { routeContext: intent.routeContext } : {})
  })}`;
}
