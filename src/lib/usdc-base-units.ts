const usdcAmountPattern = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;

export function toUsdcBaseUnits(amount: string): string | null {
  const match = usdcAmountPattern.exec(amount);
  if (!match) {
    return null;
  }

  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
}
