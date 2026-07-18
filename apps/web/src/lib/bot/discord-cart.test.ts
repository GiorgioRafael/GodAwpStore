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
        data: { custom_id: "select_products", values: selectionValues },
      }),
    ).toEqual({ kind: "open", selections });

    expect(
      parseNativeDiscordCartInteraction({
        type: 3,
        data: {
          custom_id: "select_products",
          values: [...selectionValues, selectionValues[0]],
        },
      }),
    ).toBeNull();
  });

  it("abre imediatamente um campo de quantidade para cada produto selecionado", () => {
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
      kind: "open",
      selections: [
        { productId: productIds[0], productName: null },
        { productId: productIds[1], productName: null },
      ],
    });
    if (!interaction || interaction.kind !== "open") {
      throw new Error("A seleção legada não foi reconhecida.");
    }

    expect(createNativeDiscordCartResponse(interaction.selections)).toMatchObject({
      type: 9,
      data: {
        components: [
          { components: [{ label: "Produto 1" }] },
          { components: [{ label: "Produto 2" }] },
        ],
      },
    });
  });
});
