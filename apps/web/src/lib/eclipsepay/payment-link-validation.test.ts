import { describe, expect, it } from "vitest";
import { parseBrlCents } from "./payment-link-validation";

describe("valores do link Pix", () => {
  it.each([
    ["0,80", 80], ["1", 100], ["1,2", 120], ["10.05", 1005], ["1000,00", 100_000],
  ])("converte %s para centavos exatos", (input, expected) => {
    expect(parseBrlCents(input)).toBe(expected);
  });
  it.each([null, "", "0,79", "1000,01", "1.234,56", "1e2", "10,999", "R$ 10,00", "-1"])
    ("recusa valor fora das regras: %s", (input) => {
      expect(parseBrlCents(input)).toBeNull();
    });
});
