import { describe, expect, it } from "vitest";

import {
  DEMO_ROULETTE_PRIZES,
  buildRouletteWheelPrizes,
  demoRouletteRotation,
  formatCoins,
  mergeDemoRouletteInventory,
  normalizeDemoRouletteInventory,
  normalizeRoulettePrizeProducts,
  rouletteWheelPrize,
} from "./demo";

describe("demo roulette", () => {
  it("mantém exatamente cinco prêmios provisórios", () => {
    expect(DEMO_ROULETTE_PRIZES.map((prize) => prize.key)).toEqual([
      "premio_1",
      "premio_2",
      "premio_3",
      "premio_4",
      "premio_5",
    ]);
  });

  it("normaliza apenas itens válidos e positivos", () => {
    expect(normalizeDemoRouletteInventory([
      { prize_key: "premio_4", quantity: 2 },
      { prize_key: "invalido", quantity: 9 },
      { prize_key: "premio_1", quantity: 0 },
      { prize_key: "premio_2", quantity: 1 },
    ])).toEqual([
      { prizeKey: "premio_2", quantity: 1 },
      { prizeKey: "premio_4", quantity: 2 },
    ]);
  });

  it("atualiza a quantidade retornada pelo servidor sem duplicar linhas", () => {
    expect(mergeDemoRouletteInventory(
      [{ prizeKey: "premio_2", quantity: 1 }],
      "premio_2",
      2,
    )).toEqual([{ prizeKey: "premio_2", quantity: 2 }]);
  });

  it("descarta slots sem produto válido do catálogo", () => {
    expect(normalizeRoulettePrizeProducts([
      {
        slot_prize_key: "premio_2",
        slot_product_id: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        slot_product_name: "  1x Dragonfly  ",
        slot_product_image_url: "http://inseguro.example/imagem.png",
        slot_value_cents: 200,
        slot_sale_value_cents: 100,
        slot_draw_chance_bps: 1500,
      },
      {
        slot_prize_key: "premio_9",
        slot_product_id: "1d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        slot_product_name: "Fora da roleta",
        slot_product_image_url: null,
        slot_value_cents: 100,
        slot_sale_value_cents: 50,
        slot_draw_chance_bps: 1000,
      },
      {
        slot_prize_key: "premio_3",
        slot_product_id: "2d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        slot_product_name: "   ",
        slot_product_image_url: null,
        slot_value_cents: 100,
        slot_sale_value_cents: 50,
        slot_draw_chance_bps: 1000,
      },
    ])).toEqual([
      {
        prizeKey: "premio_2",
        productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        name: "1x Dragonfly",
        imageUrl: null,
        valueCents: 200,
        saleValueCents: 100,
        drawChanceBps: 1500,
      },
    ]);
  });

  it("mantém as cinco fatias mesmo quando o catálogo cobre parte dos slots", () => {
    const prizes = buildRouletteWheelPrizes([
      {
        prizeKey: "premio_2",
        productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        name: "10x Super Watering Can",
        imageUrl: "https://exemplo.supabase.co/regador.png",
        valueCents: 500,
        saleValueCents: 250,
        drawChanceBps: 900,
      },
    ]);

    expect(prizes).toHaveLength(5);
    expect(rouletteWheelPrize(prizes, "premio_2")).toMatchObject({
      displayName: "10x Super Watering Can",
      wheelLabel: "10x Super Wat…",
      imageUrl: "https://exemplo.supabase.co/regador.png",
      valueCents: 500,
      saleValueCents: 250,
    });
    expect(rouletteWheelPrize(prizes, "premio_5")).toMatchObject({
      displayName: "Prêmio 5",
      productId: null,
      imageUrl: null,
      valueCents: 0,
      saleValueCents: 0,
    });
  });

  it("formata moedas em pt-BR a partir dos centavos", () => {
    expect(formatCoins(0)).toBe("0,00");
    expect(formatCoins(3)).toBe("0,03");
    expect(formatCoins(100)).toBe("1,00");
    expect(formatCoins(1_234)).toBe("12,34");
  });

  it("faz ao menos cinco voltas e alinha o centro do prêmio ao ponteiro", () => {
    for (const prize of DEMO_ROULETTE_PRIZES) {
      const nextRotation = demoRouletteRotation(0, prize.key);
      const index = DEMO_ROULETTE_PRIZES.findIndex((candidate) => candidate.key === prize.key);
      const segmentCenter = index * 72 + 36;
      expect(nextRotation).toBeGreaterThanOrEqual(1_800);
      expect((nextRotation + segmentCenter) % 360).toBeCloseTo(0);
    }
  });
});
