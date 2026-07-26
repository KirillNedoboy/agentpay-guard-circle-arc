import { compareDecimalStrings } from "@/lib/decimal";
import type {
  CctpAttestationStatus,
  CctpFinalityMode,
  GasPaymentMode,
  PaymentIntent,
  PaymentOperation,
  RouteContext,
  TransferMode,
  WalletControlModel
} from "./types";

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

const routeContextFields = new Set<keyof RouteContext>([
  "transferMode",
  "sourceChain",
  "destinationChain",
  "finalityMode",
  "attestationStatus",
  "walletControlModel",
  "estimatedFee",
  "feeAsset",
  "gasPaymentMode"
]);

const transferModes = ["single-chain", "cctp", "gateway"] as const satisfies readonly TransferMode[];
const finalityModes = ["standard", "fast-transfer"] as const satisfies readonly CctpFinalityMode[];
const attestationStatuses = ["not_requested", "pending", "verified"] as const satisfies readonly CctpAttestationStatus[];
const walletControlModels = ["user-controlled", "developer-controlled"] as const satisfies readonly WalletControlModel[];
const paymentOperations = ["transfer", "approve", "transferFrom"] as const satisfies readonly PaymentOperation[];
const gasPaymentModes = ["native-gas", "usdc-paymaster-preview"] as const satisfies readonly GasPaymentMode[];

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readNonEmptyString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  return value;
}

function readEnum<T extends string>(value: unknown, field: string, allowedValues: readonly T[]): T {
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new ValidationError(`${field} has an unsupported value.`);
  }
  return value as T;
}

function validateRouteContext(value: unknown): RouteContext {
  if (!isPlainObject(value)) {
    throw new ValidationError("routeContext must be a plain object.");
  }

  for (const field of Object.keys(value)) {
    if (!routeContextFields.has(field as keyof RouteContext)) {
      throw new ValidationError(`routeContext contains an unsupported field: ${field}.`);
    }
  }

  const routeContext: RouteContext = {
    transferMode: readEnum(value.transferMode, "transferMode", transferModes),
    sourceChain: readNonEmptyString(value, "sourceChain"),
    destinationChain: readNonEmptyString(value, "destinationChain")
  };

  if (value.finalityMode !== undefined) {
    routeContext.finalityMode = readEnum(value.finalityMode, "finalityMode", finalityModes);
  }
  if (value.attestationStatus !== undefined) {
    routeContext.attestationStatus = readEnum(value.attestationStatus, "attestationStatus", attestationStatuses);
  }
  if (value.walletControlModel !== undefined) {
    routeContext.walletControlModel = readEnum(value.walletControlModel, "walletControlModel", walletControlModels);
  }
  if (value.estimatedFee !== undefined) {
    if (typeof value.estimatedFee !== "string" || compareDecimalStrings(value.estimatedFee, "0") === null || compareDecimalStrings(value.estimatedFee, "0") === -1) {
      throw new ValidationError("estimatedFee must be a non-negative decimal string.");
    }
    routeContext.estimatedFee = value.estimatedFee;
  }
  if (value.feeAsset !== undefined) {
    if (value.feeAsset !== "USDC") {
      throw new ValidationError("feeAsset must be USDC.");
    }
    routeContext.feeAsset = value.feeAsset;
  }
  if (value.gasPaymentMode !== undefined) {
    routeContext.gasPaymentMode = readEnum(value.gasPaymentMode, "gasPaymentMode", gasPaymentModes);
  }

  return routeContext;
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

  if (record.operation !== undefined) {
    intent.operation = readEnum(record.operation, "operation", paymentOperations);
  }
  if (record.spender !== undefined) {
    intent.spender = readNonEmptyString(record, "spender");
  }
  if (record.amountBaseUnits !== undefined) {
    if (typeof record.amountBaseUnits !== "string" || !/^(0|[1-9]\d*)$/.test(record.amountBaseUnits)) {
      throw new ValidationError("amountBaseUnits must be a non-negative integer string.");
    }
    intent.amountBaseUnits = record.amountBaseUnits;
  }
  if (record.routeContext !== undefined) {
    intent.routeContext = validateRouteContext(record.routeContext);
  }

  return intent;
}
