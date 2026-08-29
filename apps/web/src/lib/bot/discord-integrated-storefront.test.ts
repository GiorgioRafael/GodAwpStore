import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let parseNativeDiscordIntegratedStorefrontInteraction: typeof import("./discord-integrated-storefront").parseNativeDiscordIntegratedStorefrontInteraction;

beforeAll(async () => {
  ({ parseNativeDiscordIntegratedStorefrontInteraction } = await import(
    "./discord-integrated-storefront"
  ));
});

describe("vitrine única do Discord", () => {
  it("aceita somente uma loja válida selecionada no componente publicado", () => {
    expect(
      parseNativeDiscordIntegratedStorefrontInteraction({
        type: 3,
        data: {
          custom_id: "choose_storefront",
          values: ["c5b82d6f-a324-47fa-a861-a046559e3a11"],
        },
      }),
    ).toEqual({ catalogStoreId: "c5b82d6f-a324-47fa-a861-a046559e3a11" });
  });

  it("recusa valores adulterados, múltiplas lojas e outros componentes", () => {
    expect(
      parseNativeDiscordIntegratedStorefrontInteraction({
        type: 3,
        data: { custom_id: "choose_storefront", values: ["não-é-uuid"] },
      }),
    ).toBeNull();
    expect(
      parseNativeDiscordIntegratedStorefrontInteraction({
        type: 3,
        data: {
          custom_id: "choose_storefront",
          values: [
            "c5b82d6f-a324-47fa-a861-a046559e3a11",
            "d5b82d6f-a324-47fa-a861-a046559e3a11",
          ],
        },
      }),
    ).toBeNull();
    expect(
      parseNativeDiscordIntegratedStorefrontInteraction({
        type: 3,
        data: {
          custom_id: "select_products",
          values: ["c5b82d6f-a324-47fa-a861-a046559e3a11"],
        },
      }),
    ).toBeNull();
  });
});
