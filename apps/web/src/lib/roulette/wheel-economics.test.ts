import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  slotChanceBps,
  slotBundleValueCents,
  slotChanceShares,
  wheelEconomics,
  wheelVerdict,
} from "./wheel-economics";

const RATES = { markupBps: 7000, feeBps: 500 };

/** A escada que está em produção. */
const LADDER = [
  { prizeKey: "premio_1", productId: "a", productName: "0,15", valueCents: 15, quantity: 1, drawWeight: 48000 },
  { prizeKey: "premio_2", productId: "b", productName: "0,50", valueCents: 50, quantity: 1, drawWeight: 28000 },
  { prizeKey: "premio_3", productId: "c", productName: "1,00", valueCents: 100, quantity: 1, drawWeight: 15000 },
  { prizeKey: "premio_4", productId: "d", productName: "2,50", valueCents: 250, quantity: 1, drawWeight: 7000 },
  { prizeKey: "premio_5", productId: "e", productName: "10,00", valueCents: 1000, quantity: 1, drawWeight: 1534 },
];

describe("economia da roda", () => {
  it("reproduz o RTP que a roda de produção foi calibrada para ter", () => {
    const economics = wheelEconomics(LADDER, RATES);

    // 69,3632% é o alvo que a migração de rebalanceamento resolve.
    expect(economics.returnBps).toBe(6936);
    expect(economics.totalWeight).toBe(99_534);
  });

  it("sabe onde o giro deixa de dar lucro", () => {
    // Uma moeda entra valendo R$ 0,95 depois da taxa, e o prêmio custa o preço
    // de tabela dividido por 1,70. Empata em 0,95 × 1,70 = 161,5%.
    expect(wheelEconomics(LADDER, RATES).breakEvenBps).toBe(16_150);
    // Markup maior aguenta pagar mais.
    expect(wheelEconomics(LADDER, { markupBps: 15000, feeBps: 500 }).breakEvenBps).toBe(23_750);
  });

  it("calcula quanto sobra por giro", () => {
    const economics = wheelEconomics(LADDER, RATES);

    // R$ 0,95 de receita menos R$ 0,694/1,70 de custo.
    expect(economics.expectedValueCents).toBeCloseTo(69.36, 1);
    expect(economics.expectedCostCents).toBeCloseTo(40.8, 1);
    expect(economics.marginCents).toBeCloseTo(54.2, 1);
  });

  it("não divide por zero quando a roda está sem peso", () => {
    const economics = wheelEconomics(
      LADDER.map((slot) => ({ ...slot, drawWeight: 0 })),
      RATES,
    );

    expect(economics.returnBps).toBe(0);
    expect(economics.totalWeight).toBe(0);
    expect(Number.isFinite(economics.marginCents)).toBe(true);
  });

  it("reparte a chance pelo peso", () => {
    const total = wheelEconomics(LADDER, RATES).totalWeight;

    expect(slotChanceBps(LADDER[0], total)).toBe(4822);
    expect(slotChanceBps(LADDER[4], total)).toBe(154);
    expect(slotChanceBps(LADDER[0], 0)).toBe(0);
  });
});

describe("recomendação de RTP", () => {
  const verdict = (slots: typeof LADDER, rates = RATES) =>
    wheelVerdict(wheelEconomics(slots, rates), rates);

  it("acusa prejuízo quando o prêmio custa mais que a moeda", () => {
    // Todo mundo ganhando o prêmio de R$ 10,00: 1000% de retorno.
    const ruinous = LADDER.map((slot) => ({ ...slot, valueCents: 1000, quantity: 1, drawWeight: 1 }));

    expect(verdict(ruinous).tone).toBe("danger");
    expect(verdict(ruinous).title).toContain("Prejuízo");
  });

  it("avisa quando a roleta rende menos que vender o item direto", () => {
    // 110% de retorno: ainda longe do prejuízo em 161,5%, mas sobra R$ 0,30 por
    // giro — abaixo dos 41,2% que o markup de 70% já daria numa venda normal.
    const thin = LADDER.map((slot) =>
      slot.prizeKey === "premio_5" ? { ...slot, drawWeight: 6_100 } : slot,
    );

    const result = verdict(thin);
    expect(result.tone).toBe("warning");
    expect(result.detail).toContain("venda normal");
  });

  it("avisa quando devolve pouco demais para o jogador voltar", () => {
    const stingy = LADDER.map((slot) =>
      slot.prizeKey === "premio_1" ? { ...slot, drawWeight: 900_000 } : slot,
    );

    const result = verdict(stingy);
    expect(result.tone).toBe("warning");
    expect(result.title).toContain("Pouco generoso");
  });

  it("aprova a faixa em que sobra mais que uma venda e o jogador não desiste", () => {
    // A roda de produção: 69,4% devolvido, R$ 0,54 de sobra.
    expect(verdict(LADDER).tone).toBe("success");
    expect(verdict(LADDER).title).toContain("Equilibrado");
  });

  it("recusa uma roda sem peso nenhum", () => {
    const dead = LADDER.map((slot) => ({ ...slot, drawWeight: 0 }));

    expect(verdict(dead).tone).toBe("danger");
    expect(verdict(dead).title).toContain("peso");
  });
});

describe("fatia com quantidade", () => {
  const um = {
    prizeKey: "premio_1",
    productId: "a",
    productName: "Semente",
    valueCents: 100,
    quantity: 1,
    drawWeight: 1,
  };

  it("o pacote é o que a fatia vale", () => {
    expect(slotBundleValueCents(um)).toBe(100);
    expect(slotBundleValueCents({ ...um, quantity: 10 })).toBe(1000);
    // Quantidade ausente ou zerada não pode zerar o prêmio.
    expect(slotBundleValueCents({ ...um, quantity: 0 })).toBe(100);
  });

  it("dez unidades devolvem dez vezes mais ao jogador", () => {
    const uma = wheelEconomics([um], { markupBps: 7000, feeBps: 500 });
    const dez = wheelEconomics([{ ...um, quantity: 10 }], { markupBps: 7000, feeBps: 500 });

    expect(uma.expectedValueCents).toBe(100);
    expect(dez.expectedValueCents).toBe(1000);
    expect(dez.returnBps).toBe(uma.returnBps * 10);
    // E o que sobra por giro cai junto: o custo do prêmio é dez vezes maior.
    expect(dez.marginCents).toBeLessThan(uma.marginCents);
  });

  it("uma fatia barata em pacote pode pagar mais que uma cara sozinha", () => {
    // É por isso que o destaque dourado e o RTP têm que comparar o pacote: dez
    // sementes de 1,00 valem mais que um item de 5,00.
    const pacote = { ...um, quantity: 10 };
    const caro = { ...um, prizeKey: "premio_2", productId: "b", valueCents: 500 };
    expect(slotBundleValueCents(pacote)).toBeGreaterThan(slotBundleValueCents(caro));
  });

  it("o prejuízo aparece quando o pacote cruza o break-even", () => {
    const seguro = wheelEconomics([um], { markupBps: 7000, feeBps: 500 });
    expect(seguro.returnBps).toBeLessThan(seguro.breakEvenBps);

    const perigoso = wheelEconomics([{ ...um, quantity: 3 }], { markupBps: 7000, feeBps: 500 });
    expect(perigoso.returnBps).toBeGreaterThan(perigoso.breakEvenBps);
    expect(wheelVerdict(perigoso, { markupBps: 7000 }).tone).toBe("danger");
  });
});

describe("chances somando 100%", () => {
  const slots = (weights: number[]) =>
    weights.map((drawWeight, index) => ({
      prizeKey: `premio_${index + 1}`,
      productId: String(index),
      quantity: 1,
      productName: String(index),
      valueCents: 100,
      drawWeight,
    }));

  it("fecha em 100% mesmo com pesos que não dividem redondo", () => {
    // Três pesos iguais dão 33,333% cada; arredondar sozinho daria 99,99%.
    for (const weights of [
      [1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [7, 11, 13],
      [48000, 28000, 15000, 7000, 1534],
      Array.from({ length: 10 }, (_, index) => index + 1),
    ]) {
      const shares = slotChanceShares(slots(weights));
      expect(shares.reduce((sum, value) => sum + value, 0)).toBe(10000);
      expect(shares).toHaveLength(weights.length);
    }
  });

  it("dá o resto a quem mais perdeu no arredondamento", () => {
    // 1/3 cada: dois recebem o ponto-base extra, e nenhum fica com 3332.
    expect(slotChanceShares(slots([1, 1, 1]))).toEqual([3334, 3333, 3333]);
  });

  it("fica em zero quando não há peso nenhum", () => {
    expect(slotChanceShares(slots([0, 0]))).toEqual([0, 0]);
    expect(slotChanceShares([])).toEqual([]);
  });

  it("não dá chance a uma fatia com peso zero ao lado de outras", () => {
    const shares = slotChanceShares(slots([0, 1]));
    expect(shares[0]).toBe(0);
    expect(shares[1]).toBe(10000);
  });
});
