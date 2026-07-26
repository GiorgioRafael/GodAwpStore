import { describe, expect, it } from "vitest";

import {
  DEMO_ROULETTE_PRIZES,
  demoRouletteRotation,
  mergeDemoRouletteInventory,
  normalizeDemoRouletteInventory,
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
