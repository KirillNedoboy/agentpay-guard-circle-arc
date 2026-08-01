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
