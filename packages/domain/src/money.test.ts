import { describe, expect, it } from "vitest";

import {
  calculateCommission,
  calculateEffectiveCommissionBps,
  calculateSalePriceFromMarkup,
  formatBrl,
  formatDatePtBr,
  formatDateTimePtBr,
  parseBrlToCents,
} from "./index";

describe("valores em BRL", () => {
  it.each([
    ["0", 0],
    ["1,10", 110],
    ["R$ 10,99", 1_099],
    ["R$\u00a01.234,56", 123_456],
    ["1.234", 123_400],
    ["12,5", 1_250],
    ["+2,00", 200],
  ])("converte %s para %i centavos sem ponto flutuante", (source, expected) => {
    expect(parseBrlToCents(source)).toBe(expected);
  });

  it("aceita valor negativo apenas quando solicitado", () => {
    expect(() => parseBrlToCents("-1,00")).toThrow(/não pode ser negativo/i);
    expect(parseBrlToCents("-1,00", { allowNegative: true })).toBe(-100);
  });

  it.each(["", "R$", "1.10", "1,234", "01,00", "1.23,00", "abc"])(
    "rejeita o formato ambíguo ou inválido %s",
    (source) => {
      expect(() => parseBrlToCents(source)).toThrow();
    },
  );

  it("rejeita valores além do limite seguro", () => {
    expect(() => parseBrlToCents("999999999999999999999,99")).toThrow(/limite seguro/i);
  });

  it("formata centavos em pt-BR/BRL", () => {
    expect(formatBrl(123_456)).toMatch(/^R\$\s?1\.234,56$/);
    expect(formatBrl(-100)).toMatch(/-R\$\s?1,00|R\$\s?-1,00/);
    expect(() => formatBrl(1.5)).toThrow(/inteiro seguro/i);
  });
});
describe("comissão e margem", () => {
  it("calcula o exemplo de 30% sobre o lucro bruto", () => {
    expect(
      calculateCommission({
        minimumPriceCents: 1_000,
        salePriceCents: 2_000,
        commissionBps: 3_000,
      }),
    ).toEqual({
      minimumPriceCents: 1_000,
      salePriceCents: 2_000,
      grossProfitCents: 1_000,
      commissionBps: 3_000,
      commissionCents: 300,
      sellerProfitCents: 700,
    });
  });

  it("arredonda meio centavo para cima e conserva o lucro", () => {
    const result = calculateCommission({
      minimumPriceCents: 100,
      salePriceCents: 101,
      commissionBps: 5_000,
    });
    expect(result.commissionCents).toBe(1);
    expect(result.commissionCents + result.sellerProfitCents).toBe(result.grossProfitCents);
  });

  it("rejeita preço abaixo do mínimo", () => {
    expect(() =>
      calculateCommission({
        minimumPriceCents: 1_000,
        salePriceCents: 999,
        commissionBps: 3_000,
      }),
    ).toThrow(/abaixo do preço mínimo/i);
  });

  it("prioriza a exceção da whitelist inclusive quando ela é zero", () => {
    expect(calculateEffectiveCommissionBps(3_000, null)).toBe(3_000);
    expect(calculateEffectiveCommissionBps(3_000, undefined)).toBe(3_000);
    expect(calculateEffectiveCommissionBps(3_000, 0)).toBe(0);
    expect(calculateEffectiveCommissionBps(3_000, 2_000)).toBe(2_000);
  });

  it("calcula preço a partir da porcentagem de margem", () => {
    expect(calculateSalePriceFromMarkup(1_000, 20)).toBe(1_200);
    expect(calculateSalePriceFromMarkup(101, 50)).toBe(152);
    expect(() => calculateSalePriceFromMarkup(1_000, -1)).toThrow(/não negativo/i);
  });
});

describe("datas PT-BR", () => {
  it("exibe UTC no fuso de São Paulo", () => {
    const value = "2026-01-15T15:30:00.000Z";
    expect(formatDatePtBr(value)).toBe("15/01/2026");
    expect(formatDateTimePtBr(value)).toContain("12:30");
  });

  it("rejeita datas inválidas", () => {
    expect(() => formatDatePtBr("data inválida")).toThrow(/data inválida/i);
  });
});
