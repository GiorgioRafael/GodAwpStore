import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  finalProfit,
  hasPlayerActivity,
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
    spinnerCount: 0,
    coinsSpentCents: 0,
    awardedValueCents: 0,
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
  it("mede o retorno pelo que foi pago por moeda gasta", () => {
    // 20 giros pagos (R$ 20,00 em moedas) que pagaram R$ 14,00 em prêmios.
    const result = realisedReturnBps(
      metrics({ coinsSpentCents: 2_000, awardedValueCents: 1_400 }),
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

  it("trata a loja como intocada enquanto só a equipe girou", () => {
    // Os giros de admin não chegam a estes campos, então a página não deve
    // mostrar uma parede de zeros como se fosse resultado de verdade.
    expect(hasPlayerActivity(metrics())).toBe(false);
    expect(hasPlayerActivity(metrics({ spinCount: 1 }))).toBe(true);
    // Um depósito sem giro nenhum já é movimento de jogador.
    expect(hasPlayerActivity(metrics({ depositCount: 1 }))).toBe(true);
  });
});

describe("lucro final", () => {
  it("desconta resgates na fila, inventário e as moedas ainda por girar", () => {
    // R$ 10,00 em carteira, a 70% de retorno, viram R$ 7,00 de prêmio, que
    // custam R$ 7,00/1,70 = R$ 4,12 para a loja.
    const result = finalProfit(
      metrics({
        netProfitCents: 10_000,
        pendingCostCents: 1_500,
        heldCostCents: 2_500,
        coinLiabilityCents: 1_000,
        markupBps: 7000,
      }),
      7000,
    );

    expect(result.coinPrizeCostCents).toBe(412);
    expect(result.outstandingCostCents).toBe(4_412);
    expect(result.profitCents).toBe(5_588);
  });

  it("com a carteira vazia, é o mesmo do pior caso", () => {
    const base = metrics({
      netProfitCents: 10_000,
      pendingCostCents: 1_500,
      heldCostCents: 2_500,
      coinLiabilityCents: 0,
    });

    expect(finalProfit(base, 7000).profitCents).toBe(worstCaseProfitCents(base));
  });

  it("aceita ficar negativo, que é o aviso de ter prometido demais", () => {
    const result = finalProfit(
      metrics({ netProfitCents: 100, heldCostCents: 900, coinLiabilityCents: 500 }),
      7000,
    );

    expect(result.profitCents).toBeLessThan(0);
  });
});
