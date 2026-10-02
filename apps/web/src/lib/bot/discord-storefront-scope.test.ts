import { beforeAll, describe, expect, it, vi } from "vitest";

import type { BotCatalogGame } from "./types";

vi.mock("server-only", () => ({}));

let filterCatalogForDiscordChannel: typeof import("./discord-storefront-scope").filterCatalogForDiscordChannel;

beforeAll(async () => {
  ({ filterCatalogForDiscordChannel } = await import("./discord-storefront-scope"));
});

const catalog: BotCatalogGame[] = [
  {
    id: "a5b82d6f-a324-47fa-a861-a046559e3a11",
    name: "Jogo A",
    catalogStoreId: "c5b82d6f-a324-47fa-a861-a046559e3a11",
    catalogStoreName: "Mundo 1",
    isDefaultStore: true,
    substores: [],
  },
  {
    id: "a5b82d6f-a324-47fa-a861-a046559e3a11",
    name: "Jogo A",
    catalogStoreId: "d5b82d6f-a324-47fa-a861-a046559e3a11",
    catalogStoreName: "Mundo 2",
    isDefaultStore: false,
    substores: [],
  },
];

describe("escopo da vitrine pelo canal", () => {
  it("impede que botões antigos de um canal aposentado ofereçam o catálogo completo", () => {
    expect(filterCatalogForDiscordChannel(catalog, {
      storefronts: [],
      retired_storefronts: [{ channel_id: "223456789012345678", retired_reason: "operational_channel" }],
    }, "223456789012345678")).toEqual([]);
  });

  it("permite um canal aposentado depois de reconfigurado com uma vitrine válida", () => {
    expect(filterCatalogForDiscordChannel(catalog, {
      storefronts: [],
      retired_storefronts: [{ channel_id: "223456789012345678" }],
      integrated_storefront: {
        channel_id: "223456789012345678", channel_name: "compras",
        message_id: "323456789012345678", published_at: "2026-10-01T12:00:00.000Z",
      },
    }, "223456789012345678")).toEqual(catalog);
  });

  it("mostra somente a loja configurada para o canal da vitrine", () => {
    const result = filterCatalogForDiscordChannel(
      catalog,
      {
        storefronts: [
          {
            game_id: catalog[1].id,
            game_name: catalog[1].name,
            catalog_store_id: catalog[1].catalogStoreId,
            catalog_store_name: catalog[1].catalogStoreName,
            channel_id: "223456789012345678",
            channel_name: "jogo-b",
            message_ids: ["323456789012345678"],
            published_at: "2026-07-27T12:00:00.000Z",
          },
        ],
      },
      "223456789012345678",
    );

    expect(result).toEqual([catalog[1]]);
  });

  it("mantém o catálogo completo fora de um canal publicado", () => {
    expect(
      filterCatalogForDiscordChannel(
        catalog,
        { storefronts: [] },
        "223456789012345678",
      ),
    ).toEqual(catalog);
  });
});
