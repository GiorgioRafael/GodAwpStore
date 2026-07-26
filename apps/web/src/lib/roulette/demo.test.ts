import { describe, expect, it } from "vitest";

import {
  DEMO_ROULETTE_PRIZES,
  buildRouletteWheelPrizes,
  demoRouletteRotation,
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
        prize_key: "premio_2",
        product_id: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        product_name: "  1x Dragonfly  ",
        product_image_url: "http://inseguro.example/imagem.png",
      },
      {
        prize_key: "premio_9",
        product_id: "1d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        product_name: "Fora da roleta",
        product_image_url: null,
      },
      {
        prize_key: "premio_3",
        product_id: "2d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        product_name: "   ",
        product_image_url: null,
      },
    ])).toEqual([
      {
        prizeKey: "premio_2",
        productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        name: "1x Dragonfly",
        imageUrl: null,
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
      },
    ]);

    expect(prizes).toHaveLength(5);
    expect(rouletteWheelPrize(prizes, "premio_2")).toMatchObject({
      displayName: "10x Super Watering Can",
      wheelLabel: "10x Super Wat…",
      imageUrl: "https://exemplo.supabase.co/regador.png",
    });
    expect(rouletteWheelPrize(prizes, "premio_5")).toMatchObject({
      displayName: "Prêmio 5",
      productId: null,
      imageUrl: null,
    });
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
