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
];
const productNames = ["Super Watering", "Super Sprinkler", "Dragon's Breath"];
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

beforeAll(async () => {
  ({
    createNativeDiscordCartResponse,
    createNativeDiscordCartReviewResponse,
    parseNativeDiscordCartInteraction,
  } = await import("./discord-cart"));
});

describe("carrinho nativo do Discord", () => {
  it("fecha a lista após cada escolha e oferece adicionar outro ou continuar", () => {
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
        content: expect.stringContaining("Carrinho: 1/3"),
        components: [
          { components: [{ type: 2, label: "Super Watering", disabled: true }] },
          {
            components: [
              {
                type: 3,
                custom_id: "gwc:add",
                max_values: 1,
                placeholder: "➕ Adicionar outro produto (1/3)",
                options: [
                  { emoji: { id: "423456789012345671", name: "gw_product_1" } },
                  { emoji: { id: "423456789012345672", name: "gw_product_2" } },
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
      data: { custom_id: "gwc:add", values: [selectionValues[1]] },
      message: firstReview.data,
    });
    expect(second).toMatchObject({
      kind: "review",
      responseType: 7,
      selections: [selections[0], selections[1]],
      options: [{ value: selectionValues[2] }],
    });
    if (!second || second.kind !== "review") throw new Error("Segundo produto não adicionado.");

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
    ).toEqual({ kind: "open", selections: selections.slice(0, 2) });

    const third = parseNativeDiscordCartInteraction({
      type: 3,
      data: { custom_id: "gwc:add", values: [selectionValues[2]] },
      message: secondReview.data,
    });
    expect(third).toMatchObject({
      kind: "review",
      responseType: 7,
      selections,
      options: [],
    });
    if (!third || third.kind !== "review") throw new Error("Terceiro produto não adicionado.");
    expect(
      createNativeDiscordCartReviewResponse(
        third.selections,
        third.options,
        third.responseType,
      ),
    ).toMatchObject({
      type: 7,
      data: {
        content: expect.stringContaining("Carrinho: 3/3"),
        components: [
          { components: [{ label: "Super Watering" }, { label: "Super Sprinkler" }, { label: "Dragon's Breath" }] },
          { components: [{ custom_id: "gwc:continue", label: "Continuar com 3 produtos" }] },
        ],
      },
    });
  });

  it("abre um campo de quantidade para cada produto depois da confirmação", () => {
    const response = createNativeDiscordCartResponse(selections);

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
