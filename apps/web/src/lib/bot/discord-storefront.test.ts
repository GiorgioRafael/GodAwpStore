import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import type { BotCatalogGame } from "./types";

vi.mock("server-only", () => ({}));

let listDiscordTextChannels: typeof import("./discord-storefront").listDiscordTextChannels;
let publishDiscordStorefront: typeof import("./discord-storefront").publishDiscordStorefront;
let readStorefrontConfiguration: typeof import("./discord-storefront").readStorefrontConfiguration;
let withStorefrontConfiguration: typeof import("./discord-storefront").withStorefrontConfiguration;

const guildId = "123456789012345678";
const channelId = "223456789012345678";
const messageId = "323456789012345678";

beforeAll(async () => {
  ({
    listDiscordTextChannels,
    publishDiscordStorefront,
    readStorefrontConfiguration,
    withStorefrontConfiguration,
  } = await import("./discord-storefront"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord storefront", () => {
  it("lista somente canais de texto e identifica a categoria", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([
        { id: "423456789012345678", name: "LOJA", type: 4, position: 0 },
        {
          id: channelId,
          name: "compras",
          type: 0,
          position: 2,
          parent_id: "423456789012345678",
        },
        { id: "523456789012345678", name: "avisos", type: 5, position: 1 },
        { id: "623456789012345678", name: "voz", type: 2, position: 0 },
      ]),
    );

    await expect(listDiscordTextChannels(guildId, fetcher)).resolves.toEqual([
      expect.objectContaining({ id: "523456789012345678", name: "avisos", categoryName: null }),
      expect.objectContaining({ id: channelId, name: "compras", categoryName: "LOJA" }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      expect.objectContaining({ headers: { Authorization: "Bot bot-token-for-test" } }),
    );
  });

  it("publica o catálogo sem tentar fixar a mensagem", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: messageId, channel_id: channelId }));

    const result = await publishDiscordStorefront({
      channel: { id: channelId, name: "compras" },
      catalog: catalog(),
      previous: null,
      fetcher,
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      allowed_mentions: { parse: string[] };
      components: unknown[];
    };
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(payload.components)).toContain("select_product");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.configuration).toMatchObject({
      channel_id: channelId,
      channel_name: "compras",
      message_ids: [messageId],
    });
  });

  it("edita a mensagem rastreada sem criar uma vitrine duplicada", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: messageId, channel_id: channelId }));

    await publishDiscordStorefront({
      channel: { id: channelId, name: "compras" },
      catalog: catalog(),
      previous: storefrontConfiguration(),
      fetcher,
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("recria a mensagem removida sem exigir permissão para fixar", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const replacementId = "723456789012345678";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: replacementId, channel_id: channelId }));

    const result = await publishDiscordStorefront({
      channel: { id: channelId, name: "compras" },
      catalog: catalog(),
      previous: storefrontConfiguration(),
      fetcher,
    });

    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["PATCH", "POST"]);
    expect(result.configuration.message_ids).toEqual([replacementId]);
  });

  it("preserva as outras configurações do servidor ao salvar a vitrine", () => {
    const storefront = storefrontConfiguration();
    const merged = withStorefrontConfiguration({ tickets: { category_id: channelId } }, storefront);
    expect(merged).toEqual({
      tickets: { category_id: channelId },
      storefront,
    });
    expect(readStorefrontConfiguration(merged)).toEqual(storefront);
  });
});

function catalog(): BotCatalogGame[] {
  return [
    {
      id: "game",
      name: "Grow a Garden 2",
      substores: [
        {
          id: "seeds",
          name: "Seeds",
          title: "Seeds",
          description: "Sementes",
          colorHex: "#D4AF37",
          imageUrl: null,
          products: [
            {
              id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
              name: "Ghost Pepper",
              description: null,
              priceCents: 10,
              availableStock: 318,
            },
          ],
        },
      ],
    },
  ];
}

function storefrontConfiguration() {
  return {
    channel_id: channelId,
    channel_name: "compras",
    message_ids: [messageId],
    published_at: "2026-07-16T12:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
