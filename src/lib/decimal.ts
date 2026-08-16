type DecimalParts = {
  whole: string;
  fraction: string;
};

const decimalPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function parseParts(value: string): DecimalParts | null {
  const trimmed = value.trim();
  const match = decimalPattern.exec(trimmed);
  if (!match) {
    return null;
  }
  return {
    whole: match[1],
    fraction: match[2] ?? ""
  };
}

function toScaledBigInt(parts: DecimalParts, scale: number): bigint {
  return BigInt(`${parts.whole}${parts.fraction.padEnd(scale, "0")}`);
}

export function compareDecimalStrings(left: string, right: string): number | null {
  const leftParts = parseParts(left);
  const rightParts = parseParts(right);

  if (!leftParts || !rightParts) {
    return null;
  }

  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftValue = toScaledBigInt(leftParts, scale);
  const rightValue = toScaledBigInt(rightParts, scale);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
}

export function isPositiveDecimal(value: string): boolean {
  const comparedToZero = compareDecimalStrings(value, "0");
  return comparedToZero !== null && comparedToZero > 0;
}

export function addDecimalStrings(values: string[]): string | null {
  const parsed = values.map(parseParts);
  if (parsed.some((value) => value === null)) {
    return null;
  }

  const parts = parsed as DecimalParts[];
  const scale = parts.reduce((max, part) => Math.max(max, part.fraction.length), 0);
  const total = parts.reduce((sum, part) => sum + toScaledBigInt(part, scale), 0n);
  const raw = total.toString().padStart(scale + 1, "0");

  if (scale === 0) {
    return raw;
  }

  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function subtractDecimalStrings(left: string, right: string): string | null {
  const leftParts = parseParts(left);
  const rightParts = parseParts(right);

  if (!leftParts || !rightParts) {
    return null;
  }

  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const difference = toScaledBigInt(leftParts, scale) - toScaledBigInt(rightParts, scale);
  if (difference < 0n) {
    return null;
  }

  const raw = difference.toString().padStart(scale + 1, "0");
  if (scale === 0) {
    return raw;
  }

  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function divideDecimalStringByTwo(value: string): string | null {
  const parts = parseParts(value);
  if (!parts) {
    return null;
  }

  const scale = parts.fraction.length + 1;
  const scaled = toScaledBigInt(parts, scale);
  const half = scaled / 2n;
  const raw = half.toString().padStart(scale + 1, "0");
  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/**
 * Named error thrown by `decimalToAtomicUnits` when a decimal string cannot
 * be represented exactly at the requested atomic-unit precision. The caller
 * (e.g. the x402 execution security gate) maps this to a stable rejection
 * code; a value is NEVER silently rounded.
 */
export class DecimalNotRepresentableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalNotRepresentableError";
  }
}

/**
 * Pure BigInt conversion of a canonical decimal string into atomic units at a
 * fixed token precision — no Number(), no parseFloat(), no floating point.
 *
 * Examples at 6 decimals: "0.08" -> "80000", "0.01" -> "10000", "1" ->
 * "1000000", "0.000001" -> "1", "0.080" -> "80000".
 *
 * Fail-closed semantics (documented choice): anything that cannot be
 * represented exactly throws `DecimalNotRepresentableError` — a fraction with
 * more than `decimals` significant digits (e.g. "0.0000001" at 6 decimals),
 * a non-canonical or negative decimal string, or a non-integer/negative
 * `decimals`. The caller decides how to surface the failure; this helper
 * never rounds, never truncates, and never fabricates a value.
 */
export function decimalToAtomicUnits(value: string, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new DecimalNotRepresentableError(
      `decimals must be a non-negative safe integer; got ${String(decimals)}.`
    );
  }

  const parts = parseParts(value);
  if (!parts) {
    throw new DecimalNotRepresentableError(
      `value must be a canonical decimal string; got "${value}".`
    );
  }
  if (parts.fraction.length > decimals) {
    throw new DecimalNotRepresentableError(
      `value "${value}" has ${parts.fraction.length} fractional digits, which exceeds the ${decimals}-digit atomic-unit precision; refusing to round.`
    );
  }

  return toScaledBigInt(parts, decimals).toString();
}
