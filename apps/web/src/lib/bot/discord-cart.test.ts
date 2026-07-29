import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  encodeDiscordCartSelection,
  type DiscordCartSelection,
} from "./discord-cart-selection";

vi.mock("server-only", () => ({}));

const productIds = [
  "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
  "5f8199d0-67f7-45ec-b597-8d5149568707",
  "4e7188cb-1ee8-40e3-a696-19034f77c61d",
  "6b7fbad5-f7ed-4781-b5ef-05bf4c615871",
];
const productNames = [
  "Super Watering",
  "Super Sprinkler",
  "Dragon's Breath",
  "Star Fruit",
  "Sun Bloom",
];
const selections: DiscordCartSelection[] = productIds.map((productId, index) => ({
  productId,
  productName: productNames[index] ?? "Produto",
}));
const selectionValues = selections.map((selection) =>
  encodeDiscordCartSelection(selection.productId, selection.productName ?? "Produto"),
);

let createNativeDiscordCartResponse: typeof import("./discord-cart").createNativeDiscordCartResponse;
let createNativeDiscordCartReviewResponse: typeof import("./discord-cart").createNativeDiscordCartReviewResponse;
let parseNativeDiscordCartInteraction: typeof import("./discord-cart").parseNativeDiscordCartInteraction;
let readNativeDiscordCartModalItems: typeof import("./discord-cart").readNativeDiscordCartModalItems;

beforeAll(async () => {
  ({
    createNativeDiscordCartResponse,
    createNativeDiscordCartReviewResponse,
    parseNativeDiscordCartInteraction,
    readNativeDiscordCartModalItems,
  } = await import("./discord-cart"));
});

describe("carrinho nativo do Discord", () => {
  it("permite adicionar de uma vez todos os produtos restantes do carrinho", () => {
    const initial = parseNativeDiscordCartInteraction({
      type: 3,
      data: { custom_id: "select_products", values: [selectionValues[0]] },
      message: {
        components: [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: "select_products",
                options: selectionValues.map((value, index) => ({
                  label: productNames[index],
                  value,
                  description: `Produto ${index + 1}`,
                  emoji: {
                    id: `42345678901234567${index}`,
                    name: `gw_product_${index}`,
                    animated: false,
                  },
                })),
              },
            ],
          },
        ],
      },
    });
    expect(initial).toEqual({
      kind: "review",
      responseType: 4,
      selections: [selections[0]],
      options: [
        {
          label: productNames[1],
          value: selectionValues[1],
          description: "Produto 2",
          emoji: { id: "423456789012345671", name: "gw_product_1", animated: false },
        },
        {
          label: productNames[2],
          value: selectionValues[2],
          description: "Produto 3",
          emoji: { id: "423456789012345672", name: "gw_product_2", animated: false },
        },
        {
          label: productNames[3],
          value: selectionValues[3],
          description: "Produto 4",
          emoji: { id: "423456789012345673", name: "gw_product_3", animated: false },
        },
        {
          label: productNames[4],
          value: selectionValues[4],
          description: "Produto 5",
          emoji: { id: "423456789012345674", name: "gw_product_4", animated: false },
        },
      ],
    });
    if (!initial || initial.kind !== "review") throw new Error("Revisão inicial não criada.");

    const firstReview = createNativeDiscordCartReviewResponse(
      initial.selections,
      initial.options,
      initial.responseType,
    );
    expect(firstReview).toMatchObject({
      type: 4,
      data: {
        flags: 64,
        content: expect.stringContaining("Carrinho: 1/5"),
        components: [
          { components: [{ type: 2, label: "Super Watering", disabled: true }] },
          {
            components: [
              {
                type: 3,
                custom_id: "gwc:add",
                max_values: 4,
                placeholder: "Adicionar até 4 produtos (1/5)",
                options: [
                  { emoji: { id: "423456789012345671", name: "gw_product_1" } },
                  { emoji: { id: "423456789012345672", name: "gw_product_2" } },
                  { emoji: { id: "423456789012345673", name: "gw_product_3" } },
                  { emoji: { id: "423456789012345674", name: "gw_product_4" } },
                ],
              },
            ],
          },
          { components: [{ type: 2, custom_id: "gwc:continue" }] },
        ],
      },
    });

    const second = parseNativeDiscordCartInteraction({
      type: 3,
      data: {
        custom_id: "gwc:add",
        values: selectionValues.slice(1),
      },
      message: firstReview.data,
    });
    expect(second).toMatchObject({
      kind: "review",
      responseType: 7,
      selections,
      options: [],
    });
    if (!second || second.kind !== "review") {
      throw new Error("Produtos adicionais não foram adicionados.");
    }

    const secondReview = createNativeDiscordCartReviewResponse(
      second.selections,
      second.options,
      second.responseType,
    );
    expect(
      parseNativeDiscordCartInteraction({
        type: 3,
        data: { custom_id: "gwc:continue" },
        message: secondReview.data,
      }),
    ).toEqual({ kind: "open", selections });
    expect(secondReview).toMatchObject({
      type: 7,
      data: {
        content: expect.stringContaining("Carrinho: 5/5"),
        components: [
          {
            components: [
              { label: "Super Watering" },
              { label: "Super Sprinkler" },
              { label: "Dragon's Breath" },
              { label: "Star Fruit" },
              { label: "Sun Bloom" },
            ],
          },
          { components: [{ custom_id: "gwc:continue", label: "Continuar com 5 produtos" }] },
        ],
      },
    });
  });

  it("aceita cinco produtos diretamente no seletor inicial", () => {
    const interaction = parseNativeDiscordCartInteraction({
      type: 3,
      data: { custom_id: "select_products", values: selectionValues },
      message: {
        components: [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: "select_products",
                options: selectionValues.map((value, index) => ({
                  label: productNames[index],
                  value,
                })),
              },
            ],
          },
        ],
      },
    });

    expect(interaction).toEqual({
      kind: "review",
      responseType: 4,
      selections,
      options: [],
    });
  });

  it("rejeita produto adicional que não existe nas opções exibidas", () => {
    const review = createNativeDiscordCartReviewResponse(
      [selections[0]],
      [{ label: productNames[1], value: selectionValues[1] }],
      4,
    );

    expect(
      parseNativeDiscordCartInteraction({
        type: 3,
        data: { custom_id: "gwc:add", values: [selectionValues[2]] },
        message: review.data,
      }),
    ).toBeNull();
  });

  it("abre os cinco campos de quantidade com IDs compactos por produto", () => {
    const response = createNativeDiscordCartResponse(selections);

    expect(response).toMatchObject({
      type: 9,
      data: {
        custom_id: "gwc:submit",
        title: "Quantidades (5/5)",
        components: [
          {
            components: [
              {
                custom_id: expect.stringMatching(/^gwc:q:[A-Za-z0-9_-]{22}$/),
                label: "Super Watering",
                value: "1",
              },
            ],
          },
          {
            components: [
              {
                custom_id: expect.stringMatching(/^gwc:q:[A-Za-z0-9_-]{22}$/),
                label: "Super Sprinkler",
                value: "1",
              },
            ],
          },
          {
            components: [
              {
                custom_id: expect.stringMatching(/^gwc:q:[A-Za-z0-9_-]{22}$/),
                label: "Dragon's Breath",
                value: "1",
              },
            ],
          },
          {
            components: [
              {
                custom_id: expect.stringMatching(/^gwc:q:[A-Za-z0-9_-]{22}$/),
                label: "Star Fruit",
                value: "1",
              },
            ],
          },
          {
            components: [
              {
                custom_id: expect.stringMatching(/^gwc:q:[A-Za-z0-9_-]{22}$/),
                label: "Sun Bloom",
                value: "1",
              },
            ],
          },
        ],
      },
    });
    if (!("data" in response) || !("custom_id" in response.data)) {
      throw new Error("O modal do carrinho não foi criado.");
    }
    expect(response.data.custom_id).toBe("gwc:submit");
    expect(
      parseNativeDiscordCartInteraction({
        type: 5,
        data: {
          custom_id: response.data.custom_id,
          components: response.data.components,
        },
      }),
    ).toEqual({ kind: "submit", response: { type: 5, data: { flags: 64 } } });
    expect(
      readNativeDiscordCartModalItems({
        data: {
          custom_id: response.data.custom_id,
          components: response.data.components,
        },
      }),
    ).toEqual(
      productIds.map((productId) => ({ productId, quantity: 1 })),
    );
  });

  it("abre o carrinho com quantidades válidas depois do desconto", () => {
    const response = createNativeDiscordCartResponse(selections, {
      kind: "ready",
      items: selections.map((selection, index) => ({
        productId: selection.productId,
        productName: selection.productName ?? "Produto",
        quantity: index === 0 ? 2 : 1,
        availableStock: 10,
      })),
      totalPriceCents: 198,
    });

    expect(response).toMatchObject({
      type: 9,
      data: {
        components: [
          {
            components: [
              expect.objectContaining({
                label: "Super Watering (mín. 2)",
                value: "2",
                placeholder: "2 sugerido • máximo 10000",
              }),
            ],
          },
          { components: [{ value: "1" }] },
          { components: [{ value: "1" }] },
          { components: [{ value: "1" }] },
          { components: [{ value: "1" }] },
        ],
      },
    });
  });

  it("mantém compatibilidade com vitrines antigas sem consultar o banco", () => {
    const interaction = parseNativeDiscordCartInteraction({
      type: 3,
      data: { custom_id: "select_products", values: productIds.slice(0, 2) },
    });
    expect(interaction).toEqual({
      kind: "review",
      responseType: 4,
      selections: [
        { productId: productIds[0], productName: null },
        { productId: productIds[1], productName: null },
      ],
      options: [],
    });
    if (!interaction || interaction.kind !== "review") {
      throw new Error("A seleção legada não foi reconhecida.");
    }

    const review = createNativeDiscordCartReviewResponse(
      interaction.selections,
      interaction.options,
      interaction.responseType,
    );
    expect(review).toMatchObject({
      type: 4,
      data: {
        components: [
          { components: [{ label: "Produto 1" }, { label: "Produto 2" }] },
          { components: [{ custom_id: "gwc:continue" }] },
        ],
      },
    });
  });
});
