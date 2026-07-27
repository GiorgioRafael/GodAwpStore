import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  prizeOutcomeShares,
  realisedReturnBps,
  worstCaseProfitCents,
  type RouletteMetrics,
} from "./metrics";

function metrics(overrides: Partial<RouletteMetrics> = {}): RouletteMetrics {
  return {
    depositCount: 0,
    depositGrossCents: 0,
    depositPayerCount: 0,
    providerFeeCents: 0,
    coinLiabilityCents: 0,
    spinCount: 0,
    paidSpinCount: 0,
    adminSpinCount: 0,
    coinsSpentCents: 0,
    awardedValueCents: 0,
    adminAwardedValueCents: 0,
    soldUnitCount: 0,
    soldCreditedCents: 0,
    redeemedUnitCount: 0,
    redeemedValueCents: 0,
    deliveredUnitCount: 0,
    deliveredValueCents: 0,
    pendingRedemptionCount: 0,
    heldUnitCount: 0,
    heldValueCents: 0,
    deliveredCostCents: 0,
    pendingCostCents: 0,
    heldCostCents: 0,
    netProfitCents: 0,
    markupBps: 7000,
    feeBps: 500,
    saleRateBps: 5000,
    ...overrides,
  };
}

describe("métricas da roleta", () => {
  it("tira os giros de admin do retorno ao jogador", () => {
    // 20 giros pagos (R$ 20,00 em moedas) pagaram R$ 14,00 em prêmios; os giros
    // de admin sortearam mais R$ 30,00 sem gastar moeda nenhuma. Contar esse
    // valor inflaria o retorno para 220% contra um divisor que não cresceu.
    const result = realisedReturnBps(
      metrics({
        coinsSpentCents: 2_000,
        awardedValueCents: 4_400,
        adminAwardedValueCents: 3_000,
      }),
    );

    expect(result).toBe(7_000);
  });

  it("não calcula retorno enquanto ninguém pagou por um giro", () => {
    expect(realisedReturnBps(metrics({ awardedValueCents: 3_850 }))).toBeNull();
  });

  it("reparte as unidades entre vendidas, resgatadas e guardadas", () => {
    const shares = prizeOutcomeShares(
      metrics({ soldUnitCount: 15, redeemedUnitCount: 4, heldUnitCount: 8 }),
    );

    expect(shares).not.toBeNull();
    expect(shares?.total).toBe(27);
    expect(shares!.soldBps + shares!.redeemedBps + shares!.heldBps).toBeCloseTo(10_000, -1);
    expect(shares?.soldBps).toBe(5_556);
  });

  it("devolve nulo quando ainda não há prêmio nenhum", () => {
    expect(prizeOutcomeShares(metrics())).toBeNull();
  });

  it("desconta do lucro o custo de tudo que ainda não foi entregue", () => {
    // O lucro do banco de dados já tirou o custo do que saiu; o pior caso é
    // todo mundo resgatar o resto em vez de revender.
    const result = worstCaseProfitCents(
      metrics({ netProfitCents: 10_000, pendingCostCents: 1_500, heldCostCents: 2_500 }),
    );

    expect(result).toBe(6_000);
  });

  it("aceita que o pior caso fique negativo", () => {
    const result = worstCaseProfitCents(
      metrics({ netProfitCents: 500, pendingCostCents: 900, heldCostCents: 400 }),
    );

    expect(result).toBe(-800);
  });
});
