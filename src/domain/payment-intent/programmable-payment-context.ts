import { addDecimalStrings } from "@/lib/decimal";
import type { PaymentIntent, ProgrammablePaymentContext } from "./types";

export function buildProgrammablePaymentContext(intent: PaymentIntent): ProgrammablePaymentContext | undefined {
  const routeContext = intent.routeContext;
  if (!intent.operation && !intent.spender && !intent.amountBaseUnits && !routeContext) {
    return undefined;
  }

  const context: ProgrammablePaymentContext = {};

  if (intent.operation) {
    context.operation = intent.operation;
  }
  if (intent.spender) {
    context.spender = intent.spender;
  }
  if (intent.amountBaseUnits) {
    context.amountBaseUnits = intent.amountBaseUnits;
  }
  if (routeContext) {
    context.transferMode = routeContext.transferMode;
    context.sourceChain = routeContext.sourceChain;
    context.destinationChain = routeContext.destinationChain;
    if (routeContext.finalityMode) {
      context.finalityMode = routeContext.finalityMode;
    }
    if (routeContext.attestationStatus) {
      context.attestationStatus = routeContext.attestationStatus;
    }
    if (routeContext.walletControlModel) {
      context.walletControlModel = routeContext.walletControlModel;
    }
    if (routeContext.estimatedFee !== undefined) {
      context.estimatedFee = routeContext.estimatedFee;
      const totalProposedSpend = addDecimalStrings([intent.amount, routeContext.estimatedFee]);
      if (totalProposedSpend) {
        context.totalProposedSpendUSDC = totalProposedSpend;
      }
    }
    if (routeContext.feeAsset) {
      context.feeAsset = routeContext.feeAsset;
    }
    if (routeContext.gasPaymentMode) {
      context.gasPaymentMode = routeContext.gasPaymentMode;
    }
  }

  return context;
}
