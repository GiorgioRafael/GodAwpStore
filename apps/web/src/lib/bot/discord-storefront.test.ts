import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import type { BotCatalogGame } from "./types";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";

vi.mock("server-only", () => ({}));

let listDiscordTextChannels: typeof import("./discord-storefront").listDiscordTextChannels;
let createDiscordTextChannel: typeof import("./discord-storefront").createDiscordTextChannel;
let publishDiscordStorefront: typeof import("./discord-storefront").publishDiscordStorefront;
let deleteDiscordStorefrontMessages: typeof import("./discord-storefront").deleteDiscordStorefrontMessages;
let readStorefrontConfiguration: typeof import("./discord-storefront").readStorefrontConfiguration;
let readStorefrontConfigurations: typeof import("./discord-storefront").readStorefrontConfigurations;
let withStorefrontConfiguration: typeof import("./discord-storefront").withStorefrontConfiguration;

const guildId = "123456789012345678";
const channelId = "223456789012345678";
const messageId = "323456789012345678";

beforeAll(async () => {
  ({
    listDiscordTextChannels,
    createDiscordTextChannel,
    publishDiscordStorefront,
    deleteDiscordStorefrontMessages,
    readStorefrontConfiguration,
    readStorefrontConfigurations,
    withStorefrontConfiguration,
  } = await import("./discord-storefront"));
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord storefront", () => {
  it("remove apenas as mensagens da vitrine e nunca envia DELETE para o canal", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await deleteDiscordStorefrontMessages(storefrontConfiguration(), fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetcher).not.toHaveBeenCalledWith(
      `https://discord.com/api/v10/channels/${channelId}`,
      expect.anything(),
    );
  });

  it("cria um canal de texto com nome seguro para a nova loja", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: channelId, name: "mundo-2", type: 0, position: 0 }),
    );

    await expect(createDiscordTextChannel(guildId, "Mundo 2 ✨", fetcher)).resolves.toEqual(
      expect.objectContaining({ id: channelId, name: "mundo-2", type: 0 }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "mundo-2", type: 0 }),
      }),
    );
  });

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
    expect(JSON.stringify(payload.components)).toContain("select_products");
    expect(JSON.stringify(payload.components)).toContain('"max_values":3');
    expect(JSON.stringify(payload.components)).toContain(
      "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9:Ghost Pepper",
    );
    expect(JSON.stringify(payload.components)).not.toContain(
      "https://example.com/products/ghost-pepper.png",
    );
    expect(JSON.stringify(payload.components)).toContain(
      '"emoji":{"id":"423456789012345678","name":"gw_9a845b407c4e_a1b2c3d4","animated":false}',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.configuration).toMatchObject({
      game_id: null,
      game_name: "Catálogo completo",
      channel_id: channelId,
      channel_name: "compras",
      message_ids: [messageId],
    });
  });

  it("publica o banner configurado como primeiro componente da vitrine", async () => {
    const bannerUrl =
      "https://thstoreadm.vercel.app/brands/thstore-storefront-banner.png";
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    vi.stubEnv("DISCORD_STOREFRONT_BANNER_URL", bannerUrl);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: messageId, channel_id: channelId }));

    await publishDiscordStorefront({
      channel: { id: channelId, name: "compras" },
      catalog: catalog(),
      previous: null,
      fetcher,
    });

    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      components: Array<{
        components: Array<{
          type: number;
          items?: Array<{ media?: { url?: string } }>;
        }>;
      }>;
    };
    expect(payload.components[0]?.components[0]).toMatchObject({
      type: 12,
      items: [{ media: { url: bannerUrl } }],
    });
    expect(JSON.stringify(payload.components)).toContain("select_products");
  });

  it("prioriza o banner salvo no painel sobre o banner padrão do ambiente", async () => {
    const defaultBannerUrl =
      "https://gwstore.vercel.app/brands/gwstore-storefront-banner.png";
    const customBannerUrl =
      "https://project.supabase.co/storage/v1/object/public/catalog-media/storefronts/custom.png";
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    vi.stubEnv("DISCORD_STOREFRONT_BANNER_URL", defaultBannerUrl);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: messageId, channel_id: channelId }));

    await publishDiscordStorefront({
      channel: { id: channelId, name: "compras" },
      catalog: catalog(),
      customization: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        storefront: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront,
          bannerUrl: customBannerUrl,
        },
      },
      previous: null,
      fetcher,
    });

    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      components: Array<{
        components: Array<{
          type: number;
          items?: Array<{ media?: { url?: string } }>;
        }>;
      }>;
    };
    expect(payload.components[0]?.components[0]).toMatchObject({
      type: 12,
      items: [{ media: { url: customBannerUrl } }],
    });
    expect(JSON.stringify(payload.components)).not.toContain(defaultBannerUrl);
  });

  it("prioriza o banner da loja sobre o fallback global na publicação inicial", async () => {
    const storeBannerUrl =
      "https://project.supabase.co/storage/v1/object/public/catalog-media/storefronts/world-2.png";
    const customBannerUrl =
      "https://project.supabase.co/storage/v1/object/public/catalog-media/storefronts/global.png";
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: messageId, channel_id: channelId }));
    const storeCatalog = catalog();
    storeCatalog[0] = {
      ...storeCatalog[0]!,
      storefrontBannerUrl: storeBannerUrl,
    };

    await publishDiscordStorefront({
      channel: { id: channelId, name: "compras" },
      catalog: storeCatalog,
      customization: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        storefront: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront,
          bannerUrl: customBannerUrl,
        },
      },
      previous: null,
      fetcher,
    });

    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(payload.components[0]?.components[0]).toMatchObject({
      type: 12,
      items: [{ media: { url: storeBannerUrl } }],
    });
    expect(JSON.stringify(payload.components)).not.toContain(customBannerUrl);
  });

  it("aplica os textos personalizados sem liberar menções", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: messageId, channel_id: channelId }));

    await publishDiscordStorefront({
      channel: { id: channelId, name: "compras" },
      catalog: catalog(),
      customization: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        storefront: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront,
          title: "🔥 LOJA PERSONALIZADA @everyone",
        },
      },
      previous: null,
      fetcher,
    });

    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      allowed_mentions: { parse: string[] };
      components: unknown[];
    };
    expect(JSON.stringify(payload.components)).toContain("LOJA PERSONALIZADA @everyone");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
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
      storefronts: [storefront],
    });
    expect(readStorefrontConfiguration(merged)).toEqual({
      ...storefront,
      catalog_store_id: null,
      catalog_store_name: storefront.game_name,
    });
  });

  it("migra a vitrine antiga e mantém uma configuração separada por jogo", () => {
    const legacy = {
      channel_id: channelId,
      channel_name: "compras",
      message_ids: [messageId],
      published_at: "2026-07-16T12:00:00.000Z",
    };
    expect(readStorefrontConfigurations({ storefront: legacy })).toEqual([
      {
        ...legacy,
        game_id: null,
        game_name: "Catálogo completo",
        catalog_store_id: null,
        catalog_store_name: "Catálogo completo",
      },
    ]);

    const firstGame = storefrontConfiguration();
    const migrated = withStorefrontConfiguration({ storefront: legacy }, firstGame);
    const secondGame = {
      ...firstGame,
      game_id: "c5b82d6f-a324-47fa-a861-a046559e3a11",
      game_name: "Outro jogo",
      channel_id: "823456789012345678",
      channel_name: "outro-jogo",
    };
    const withTwoGames = withStorefrontConfiguration(migrated, secondGame);

    expect(readStorefrontConfigurations(withTwoGames)).toEqual([
      {
        ...firstGame,
        catalog_store_id: null,
        catalog_store_name: firstGame.game_name,
      },
      {
        ...secondGame,
        catalog_store_id: null,
        catalog_store_name: secondGame.game_name,
      },
    ]);
    expect(withTwoGames).not.toHaveProperty("storefront");
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
              imageUrl: "https://example.com/products/ghost-pepper.png",
              discordEmoji: {
                id: "423456789012345678",
                name: "gw_9a845b407c4e_a1b2c3d4",
                animated: false,
              },
              priceCents: 10,
              availableStock: 318,
              sortOrder: 0,
            },
            {
              id: "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
              name: "Super Watering",
              description: null,
              priceCents: 100,
              availableStock: 10,
              sortOrder: 1,
            },
            {
              id: "5f8199d0-67f7-45ec-b597-8d5149568707",
              name: "Super Sprinkler",
              description: null,
              priceCents: 200,
              availableStock: 10,
              sortOrder: 2,
            },
          ],
        },
      ],
    },
  ];
}

function storefrontConfiguration() {
  return {
    game_id: "a5b82d6f-a324-47fa-a861-a046559e3a11",
    game_name: "Grow a Garden 2",
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
