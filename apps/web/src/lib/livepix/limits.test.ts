import { describe, expect, it } from "vitest";

import {
  calculateOrderTotalCents,
  LIVEPIX_MINIMUM_BRL_CENTS,
  MAXIMUM_ORDER_QUANTITY,
  minimumLivePixQuantity,
} from "./limits";

describe("LivePix BRL limits", () => {
  it("calcula a quantidade minima para produtos vendidos em centavos", () => {
    expect(LIVEPIX_MINIMUM_BRL_CENTS).toBe(100);
    expect(minimumLivePixQuantity(2)).toBe(50);
    expect(minimumLivePixQuantity(5)).toBe(20);
    expect(minimumLivePixQuantity(40)).toBe(3);
    expect(minimumLivePixQuantity(100)).toBe(1);
  });

  it("calcula o total sem aceitar quantidade invalida ou overflow", () => {
    expect(calculateOrderTotalCents(2, 50)).toBe(100);
    expect(calculateOrderTotalCents(40, 3)).toBe(120);
    expect(calculateOrderTotalCents(2, 0)).toBeNull();
    expect(calculateOrderTotalCents(2, MAXIMUM_ORDER_QUANTITY + 1)).toBeNull();
    expect(calculateOrderTotalCents(Number.MAX_SAFE_INTEGER, 2)).toBeNull();
  });
});
