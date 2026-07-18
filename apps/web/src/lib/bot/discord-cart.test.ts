import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const productIds = [
  "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
  "5f8199d0-67f7-45ec-b597-8d5149568707",
];

let createNativeDiscordCartResponse: typeof import("./discord-cart").createNativeDiscordCartResponse;
let parseNativeDiscordCartInteraction: typeof import("./discord-cart").parseNativeDiscordCartInteraction;

beforeAll(async () => {
  ({
    createNativeDiscordCartResponse,
    parseNativeDiscordCartInteraction,
  } = await import("./discord-cart"));
});

describe("carrinho nativo do Discord", () => {
  it("aceita de um a três produtos únicos no seletor", () => {
    expect(
      parseNativeDiscordCartInteraction({
        type: 3,
        data: { custom_id: "select_products", values: productIds },
      }),
    ).toEqual({ kind: "open", productIds });

    expect(
      parseNativeDiscordCartInteraction({
        type: 3,
        data: { custom_id: "select_products", values: [...productIds, productIds[0]] },
      }),
    ).toBeNull();
  });

  it("abre um campo de quantidade para cada produto selecionado", async () => {
    const products = [
      { id: productIds[0], name: "Super Watering", minimumPriceCents: 100 },
      { id: productIds[1], name: "Super Sprinkler", minimumPriceCents: 200 },
      { id: productIds[2], name: "Dragon's Breath", minimumPriceCents: 300 },
    ];
    const response = await createNativeDiscordCartResponse(productIds, {
      findPurchasableProducts: vi.fn(async () => products),
      countAvailableStocks: vi.fn(async () =>
        new Map(productIds.map((productId, index) => [productId, index + 2])),
      ),
    });

    expect(response).toMatchObject({
      type: 9,
      data: {
        title: "Quantidades (3/3)",
        components: [
          { components: [{ custom_id: "quantity_0", label: "Super Watering", value: "1" }] },
          { components: [{ custom_id: "quantity_1", label: "Super Sprinkler", value: "1" }] },
          { components: [{ custom_id: "quantity_2", label: "Dragon's Breath", value: "1" }] },
        ],
      },
    });
    if (!("data" in response) || !("custom_id" in response.data)) {
      throw new Error("O modal do carrinho não foi criado.");
    }
    expect(String(response.data.custom_id)).toHaveLength(72);
    expect(
      parseNativeDiscordCartInteraction({
        type: 5,
        data: {
          custom_id: response.data.custom_id,
          components: response.data.components,
        },
      }),
    ).toEqual({ kind: "submit", response: { type: 5, data: { flags: 64 } } });
  });

  it("impede abrir o formulário quando um item ficou sem estoque", async () => {
    const response = await createNativeDiscordCartResponse(productIds.slice(0, 2), {
      findPurchasableProducts: vi.fn(async () => [
        { id: productIds[0], name: "Super Watering", minimumPriceCents: 100 },
        { id: productIds[1], name: "Super Sprinkler", minimumPriceCents: 200 },
      ]),
      countAvailableStocks: vi.fn(async () =>
        new Map([
          [productIds[0], 2],
          [productIds[1], 0],
        ]),
      ),
    });

    expect(response).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("Super Sprinkler") },
    });
  });
});
