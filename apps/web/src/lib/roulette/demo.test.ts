import { describe, expect, it } from "vitest";

import {
  MAXIMUM_WHEEL_SLOTS,
  buildRouletteWheelPrizes,
  compareRouletteSlots,
  demoRouletteRotation,
  formatCoins,
  mergeDemoRouletteInventory,
  normalizeDemoRouletteInventory,
  normalizeRoulettePrizeProducts,
  rouletteSlotKeys,
  rouletteSlotPalette,
  rouletteWheelPrize,
} from "./demo";

/** A wheel of `total` slices, priced so the ladder climbs. */
function wheelOf(total: number) {
  return rouletteSlotKeys(total).map((prizeKey, index) => ({
    prizeKey,
    productId: `0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f${String(index).padStart(3, "0")}`,
    name: `Item ${index + 1}`,
    quantity: 1,
    imageUrl: null,
    valueCents: (index + 1) * 50,
    saleValueCents: (index + 1) * 25,
    drawChanceBps: 1000,
  }));
}

describe("demo roulette", () => {
  it("aceita de uma a dez fatias, e nada além disso", () => {
    expect(rouletteSlotKeys(1)).toEqual(["premio_1"]);
    expect(rouletteSlotKeys(10)).toHaveLength(MAXIMUM_WHEEL_SLOTS);
    expect(rouletteSlotKeys(10).at(-1)).toBe("premio_10");
    // Pedir mais que o teto não cria fatia que o banco vai recusar.
    expect(rouletteSlotKeys(25)).toHaveLength(MAXIMUM_WHEEL_SLOTS);
    expect(rouletteSlotKeys(0)).toEqual([]);
  });

  it("ordena as fatias por número, não por texto", () => {
    // premio_10 vem antes de premio_2 em ordem alfabética.
    const keys = ["premio_10", "premio_2", "premio_1"].sort(compareRouletteSlots);
    expect(keys).toEqual(["premio_1", "premio_2", "premio_10"]);
  });

  it("dá cor diferente a fatias vizinhas mesmo com dez", () => {
    const palette = Array.from({ length: 10 }, (_, index) => rouletteSlotPalette(index, 10));
    // Nenhuma fatia fica sem cor, e nenhuma repete a do vizinho.
    for (const [index, slot] of palette.entries()) {
      expect(slot.accent).toMatch(/^hsl\(/);
      expect(slot.surface).toMatch(/^hsl\(/);
      if (index > 0) expect(slot.accent).not.toBe(palette[index - 1].accent);
    }
    expect(new Set(palette.map((slot) => slot.accent)).size).toBe(10);
  });

  it("normaliza apenas itens válidos e positivos", () => {
    expect(normalizeDemoRouletteInventory([
      inventoryRow({ prize_key: "premio_4", quantity: 2 }),
      inventoryRow({ prize_key: "invalido", quantity: 9 }),
      inventoryRow({ prize_key: "premio_1", quantity: 0 }),
      inventoryRow({ prize_key: "premio_2", quantity: 1 }),
      // Sem produto não há o que o jogador possua: a linha não descreve nada.
      inventoryRow({ prize_key: "premio_3", product_id: "", quantity: 4 }),
    ]).map((item) => [item.prizeKey, item.quantity])).toEqual([
      ["premio_2", 1],
      ["premio_4", 2],
    ]);
  });

  it("guarda o item congelado, não o que a fatia aponta hoje", () => {
    const [item] = normalizeDemoRouletteInventory([
      inventoryRow({
        prize_key: "premio_1",
        product_id: PRODUCT_A,
        product_name: "  AWP Dragon Lore  ",
        product_image_url: "https://cdn.example/awp.png",
        unit_value_cents: 5000,
        unit_sale_value_cents: 2500,
        quantity: 1,
      }),
    ]);
    expect(item).toEqual({
      prizeKey: "premio_1",
      productId: PRODUCT_A,
      name: "AWP Dragon Lore",
      imageUrl: "https://cdn.example/awp.png",
      valueCents: 5000,
      saleValueCents: 2500,
      quantity: 1,
    });
  });

  it("não funde dois itens diferentes ganhos na mesma fatia", () => {
    // O admin repontou premio_1 depois que o jogador já tinha ganho o item caro.
    // Somar as duas linhas esconderia uma atrás do nome e do preço da outra.
    const inventory = normalizeDemoRouletteInventory([
      inventoryRow({
        prize_key: "premio_1",
        product_id: PRODUCT_A,
        product_name: "AWP",
        unit_value_cents: 5000,
        unit_sale_value_cents: 2500,
        quantity: 2,
      }),
      inventoryRow({
        prize_key: "premio_1",
        product_id: PRODUCT_B,
        product_name: "Chaveiro",
        unit_value_cents: 150,
        unit_sale_value_cents: 75,
        quantity: 1,
      }),
    ]);
    expect(inventory).toHaveLength(2);
    expect(inventory.map((item) => [item.name, item.valueCents, item.quantity])).toEqual([
      ["AWP", 5000, 2],
      ["Chaveiro", 150, 1],
    ]);
  });

  it("atualiza a quantidade retornada pelo servidor sem duplicar linhas", () => {
    const line = {
      prizeKey: "premio_2",
      productId: PRODUCT_A,
      name: "AWP",
      imageUrl: null,
      valueCents: 500,
      saleValueCents: 250,
      quantity: 2,
    };
    expect(mergeDemoRouletteInventory([{ ...line, quantity: 1 }], line)).toEqual([line]);
  });

  it("vender um item não apaga o outro da mesma fatia", () => {
    const caro = {
      prizeKey: "premio_1" as const,
      productId: PRODUCT_A,
      name: "AWP",
      imageUrl: null,
      valueCents: 5000,
      saleValueCents: 2500,
      quantity: 2,
    };
    const barato = { ...caro, productId: PRODUCT_B, name: "Chaveiro", valueCents: 150,
      saleValueCents: 75, quantity: 1 };

    const afterSale = mergeDemoRouletteInventory([caro, barato], { ...barato, quantity: 0 });
    expect(afterSale).toEqual([caro]);
  });

  it("descarta chave malformada e slot sem produto, e ordena por número", () => {
    expect(normalizeRoulettePrizeProducts([
      {
        slot_prize_key: "premio_2",
        slot_product_id: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        slot_product_name: "  1x Dragonfly  ",
        slot_product_image_url: "http://inseguro.example/imagem.png",
        slot_prize_quantity: 1,
        slot_value_cents: 200,
        slot_sale_value_cents: 100,
        slot_draw_chance_bps: 1500,
      },
      {
        // Chave malformada: nem parece slot, então não entra na roda.
        slot_prize_key: "premio_zero",
        slot_product_id: "1d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        slot_product_name: "Fora da roleta",
        slot_product_image_url: null,
        slot_prize_quantity: 1,
        slot_value_cents: 100,
        slot_sale_value_cents: 50,
        slot_draw_chance_bps: 1000,
      },
      {
        // Décima fatia é válida agora, e sai depois da segunda, não antes.
        slot_prize_key: "premio_10",
        slot_product_id: "3d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        slot_product_name: "Décimo",
        slot_product_image_url: null,
        slot_prize_quantity: 1,
        slot_value_cents: 900,
        slot_sale_value_cents: 450,
        slot_draw_chance_bps: 100,
      },
      {
        slot_prize_key: "premio_3",
        slot_product_id: "2d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        slot_product_name: "   ",
        slot_product_image_url: null,
        slot_prize_quantity: 1,
        slot_value_cents: 100,
        slot_sale_value_cents: 50,
        slot_draw_chance_bps: 1000,
      },
    ])).toEqual([
      {
        prizeKey: "premio_2",
        productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        name: "1x Dragonfly",
        quantity: 1,
        imageUrl: null,
        valueCents: 200,
        saleValueCents: 100,
        drawChanceBps: 1500,
      },
      {
        prizeKey: "premio_10",
        productId: "3d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        name: "Décimo",
        quantity: 1,
        imageUrl: null,
        valueCents: 900,
        saleValueCents: 450,
        drawChanceBps: 100,
      },
    ]);
  });

  it("desenha exatamente as fatias que o servidor mandou", () => {
    // A roda não tem mais tamanho fixo: uma fatia configurada é uma fatia
    // desenhada, e nada é inventado para preencher.
    const prizes = buildRouletteWheelPrizes([
      {
        prizeKey: "premio_2",
        productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        name: "Super Watering Can",
        quantity: 10,
        imageUrl: "https://exemplo.supabase.co/regador.png",
        valueCents: 500,
        saleValueCents: 250,
        drawChanceBps: 900,
      },
    ]);

    expect(prizes).toHaveLength(1);
    // O nome carrega a quantidade: uma fatia de dez e uma de um são prêmios
    // diferentes, e só o rótulo diz qual é qual.
    expect(rouletteWheelPrize(prizes, "premio_2")).toMatchObject({
      displayName: "10x Super Watering Can",
      wheelLabel: "10x Super Wat…",
      quantity: 10,
      valueCents: 500,
    });
  });

  it("uma fatia de uma unidade não ganha prefixo", () => {
    const prizes = buildRouletteWheelPrizes([
      {
        prizeKey: "premio_1",
        productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
        name: "Star Fruit",
        quantity: 1,
        imageUrl: null,
        valueCents: 200,
        saleValueCents: 100,
        drawChanceBps: 900,
      },
    ]);
    expect(prizes[0].displayName).toBe("Star Fruit");
  });

  it("encurta o rótulo conforme a fatia aperta", () => {
    const wide = buildRouletteWheelPrizes(
      wheelOf(5).map((slot) => ({ ...slot, name: "Nome bem comprido demais" })),
    );
    const tight = buildRouletteWheelPrizes(
      wheelOf(10).map((slot) => ({ ...slot, name: "Nome bem comprido demais" })),
    );

    expect(wide[0].wheelLabel.length).toBeGreaterThan(tight[0].wheelLabel.length);
    expect(tight[0].wheelLabel.endsWith("…")).toBe(true);
  });

  it("não quebra num prêmio que a roda ainda não conhece", () => {
    // Acontece na janela entre o admin adicionar uma fatia e a página recarregar.
    const prizes = buildRouletteWheelPrizes(wheelOf(3));

    expect(rouletteWheelPrize(prizes, "premio_9")).toMatchObject({
      displayName: "Prêmio 9",
      productId: null,
      valueCents: 0,
    });
  });

  it("formata moedas em pt-BR a partir dos centavos", () => {
    expect(formatCoins(0)).toBe("0,00");
    expect(formatCoins(3)).toBe("0,03");
    expect(formatCoins(100)).toBe("1,00");
    expect(formatCoins(1_234)).toBe("12,34");
  });

  it("alinha o ponteiro pela roda desenhada, em qualquer quantidade de fatias", () => {
    // Alinhar em passos de 72° enquanto o SVG desenha dez fatias de 36° faz a
    // roda parar num prêmio e o card anunciar outro.
    for (const total of [1, 2, 3, 5, 7, 10]) {
      const prizes = buildRouletteWheelPrizes(wheelOf(total));
      const segmentAngle = 360 / total;

      for (const [index, prize] of prizes.entries()) {
        const nextRotation = demoRouletteRotation(0, prize.key, prizes);
        const segmentCenter = index * segmentAngle + segmentAngle / 2;
        expect(nextRotation).toBeGreaterThanOrEqual(1_800);
        expect((nextRotation + segmentCenter) % 360).toBeCloseTo(0);
      }
    }
  });

  it("não gira para o infinito quando a roda está vazia", () => {
    expect(Number.isFinite(demoRouletteRotation(0, "premio_1", []))).toBe(true);
  });
});

const PRODUCT_A = "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c";
const PRODUCT_B = "1e8c6a3d-3a8d-4c3e-8b2a-7a2e1e8c6a3d";

function inventoryRow(
  overrides: Partial<Parameters<typeof normalizeDemoRouletteInventory>[0][number]>,
) {
  return {
    prize_key: "premio_1",
    product_id: PRODUCT_A,
    product_name: "Prêmio",
    product_image_url: null,
    unit_value_cents: 100,
    unit_sale_value_cents: 50,
    quantity: 1,
    ...overrides,
  };
}
