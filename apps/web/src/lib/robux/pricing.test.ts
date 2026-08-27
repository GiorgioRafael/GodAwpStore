import { describe, expect, it } from "vitest";

import {
  calculateRobuxPriceCents,
  MAXIMUM_ROBUX_QUANTITY,
  MINIMUM_ROBUX_QUANTITY,
} from "./pricing";

describe("Robux pricing", () => {
  it("charges R$ 42,00 for 1.000 Robux", () => {
    expect(calculateRobuxPriceCents(1_000)).toBe(4_200);
  });

  it("uses the configured minimum quantity", () => {
    expect(MINIMUM_ROBUX_QUANTITY).toBe(100);
    expect(calculateRobuxPriceCents(MINIMUM_ROBUX_QUANTITY)).toBe(420);
    expect(calculateRobuxPriceCents(99)).toBeNull();
  });

  it("rejects invalid and oversized quantities", () => {
    expect(calculateRobuxPriceCents(0)).toBeNull();
    expect(calculateRobuxPriceCents(2.5)).toBeNull();
    expect(calculateRobuxPriceCents(MAXIMUM_ROBUX_QUANTITY)).toBe(2_100_000);
    expect(calculateRobuxPriceCents(MAXIMUM_ROBUX_QUANTITY + 1)).toBeNull();
  });
});
