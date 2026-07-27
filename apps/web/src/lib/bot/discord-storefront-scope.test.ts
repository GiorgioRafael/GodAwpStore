import { beforeAll, describe, expect, it, vi } from "vitest";

import type { BotCatalogGame } from "./types";

vi.mock("server-only", () => ({}));

let filterCatalogForDiscordChannel: typeof import("./discord-storefront-scope").filterCatalogForDiscordChannel;

beforeAll(async () => {
  ({ filterCatalogForDiscordChannel } = await import("./discord-storefront-scope"));
});

const catalog: BotCatalogGame[] = [
  { id: "a5b82d6f-a324-47fa-a861-a046559e3a11", name: "Jogo A", substores: [] },
  { id: "b5b82d6f-a324-47fa-a861-a046559e3a11", name: "Jogo B", substores: [] },
];

describe("escopo da vitrine pelo canal", () => {
  it("mostra somente o jogo configurado para o canal da vitrine", () => {
    const result = filterCatalogForDiscordChannel(
      catalog,
      {
        storefronts: [
          {
            game_id: catalog[1].id,
            game_name: catalog[1].name,
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
