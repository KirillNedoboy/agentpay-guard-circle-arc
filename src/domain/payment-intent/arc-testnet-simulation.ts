import type { ArcTestnetSimulation, PaymentIntent } from "./types";

export function buildArcTestnetSimulation(intent: PaymentIntent): ArcTestnetSimulation {
  return {
    network: "Arc Testnet",
    adapter: "future_settlement_adapter",
    simulation: "local_deterministic_preview",
    intentReference: intent.idempotencyKey,
    broadcast: false,
    status: "not_executed",
    explanation: "Local deterministic adapter preview only. No RPC call, transaction signing, broadcast, or USDC movement occurred."
  };
}
