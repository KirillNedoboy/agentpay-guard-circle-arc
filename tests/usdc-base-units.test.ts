import { describe, expect, test } from "vitest";
import { toUsdcBaseUnits } from "@/lib/usdc-base-units";

describe("toUsdcBaseUnits", () => {
  test.each([
    ["0", "0"],
    ["1", "1000000"],
    ["25.50", "25500000"],
    ["0.000001", "1"],
    ["10.123456", "10123456"]
  ])("converts %s USDC to %s base units", (amount, expectedBaseUnits) => {
    expect(toUsdcBaseUnits(amount)).toBe(expectedBaseUnits);
  });

  test.each(["", "1.2.3", "-1", "01", "1e3", "0.0000001", "10.1234567"])(
    "rejects unsupported USDC amount %s",
    (amount) => {
      expect(toUsdcBaseUnits(amount)).toBeNull();
    }
  );
});
