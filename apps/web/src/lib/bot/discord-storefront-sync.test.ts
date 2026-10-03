import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  deleteDiscordStorefrontMessages: vi.fn(),
  listDiscordTextChannels: vi.fn(),
  isGWStore: true,
  catalogStoresForIntegratedStorefront: vi.fn(),
  listCatalog: vi.fn(),
  publishDiscordIntegratedStorefront: vi.fn(),
  publishDiscordStorefront: vi.fn(),
  readDiscordIntegratedStorefrontConfiguration: vi.fn(),
  readStorefrontConfigurations: vi.fn(),
  withDiscordIntegratedStorefrontConfiguration: vi.fn(),
  withStorefrontConfigurations: vi.fn(),
  loadBotMessageCustomization: vi.fn(),
  synchronizeDiscordProductEmojis: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.isGWStore; } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("./commerce-service", () => ({
  BotCommerceService: class {
    listCatalog = mocks.listCatalog;
  },
}));
vi.mock("./supabase-repository", () => ({
  SupabaseBotCommerceRepository: class {},
}));
vi.mock("./discord-storefront", () => ({
  deleteDiscordStorefrontMessages: mocks.deleteDiscordStorefrontMessages,
  listDiscordTextChannels: mocks.listDiscordTextChannels,
  catalogStoresForIntegratedStorefront: mocks.catalogStoresForIntegratedStorefront,
  publishDiscordIntegratedStorefront: mocks.publishDiscordIntegratedStorefront,
  publishDiscordStorefront: mocks.publishDiscordStorefront,
  readDiscordIntegratedStorefrontConfiguration: mocks.readDiscordIntegratedStorefrontConfiguration,
  readStorefrontConfigurations: mocks.readStorefrontConfigurations,
  withDiscordIntegratedStorefrontConfiguration: mocks.withDiscordIntegratedStorefrontConfiguration,
  withStorefrontConfigurations: mocks.withStorefrontConfigurations,
}));
vi.mock("./message-customization-server", () => ({
  loadBotMessageCustomization: mocks.loadBotMessageCustomization,
}));
vi.mock("./discord-product-emojis", () => ({
  synchronizeDiscordProductEmojis: mocks.synchronizeDiscordProductEmojis,
}));

import { synchronizePublishedDiscordStorefronts } from "./discord-storefront-sync";

const storefront = {
  game_id: "a5b82d6f-a324-47fa-a861-a046559e3a11",
  game_name: "Grow a Garden 2",
  channel_id: "223456789012345678",
  channel_name: "compras",
  message_ids: ["323456789012345678"],
  published_at: "2026-07-17T09:00:00.000Z",
};
const customization = { version: 1, storefront: { title: "Loja personalizada" } };
const defaultStoreId = "c5b82d6f-a324-47fa-a861-a046559e3a11";

describe("sincronização automática da vitrine Discord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isGWStore = true;
    mocks.listDiscordTextChannels.mockResolvedValue([
      { id: storefront.channel_id, name: storefront.channel_name },
      { id: "423456789012345678", name: "outro-jogo" },
    ]);
    mocks.listCatalog.mockResolvedValue([
      {
        id: storefront.game_id,
        name: storefront.game_name,
        catalogStoreId: defaultStoreId,
        catalogStoreName: storefront.game_name,
        isDefaultStore: true,
        substores: [],
      },
    ]);
    mocks.readStorefrontConfigurations.mockReturnValue([storefront]);
    mocks.readDiscordIntegratedStorefrontConfiguration.mockReturnValue(null);
    mocks.withStorefrontConfigurations.mockReturnValue({ storefronts: [storefront] });
    mocks.loadBotMessageCustomization.mockResolvedValue(customization);
    mocks.publishDiscordStorefront.mockResolvedValue({ configuration: storefront });
    mocks.synchronizeDiscordProductEmojis.mockResolvedValue({ failed: 0 });
    mocks.deleteDiscordStorefrontMessages.mockResolvedValue(undefined);
  });

  it("não restaura uma vitrine desativada enquanto a sincronização estava em andamento", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    client.updateQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 0, failed: 1, productEmojiFailures: 0,
    });
    expect(client.updateQuery.eq).toHaveBeenCalledWith("updated_at", "2026-10-03T12:00:00.000Z");
  });

  it.each(["missing", "ticket-123", "🔒┊chat-admin"])("arquiva a referência %s sem publicar nem apagar mensagens", async (name) => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.listDiscordTextChannels.mockResolvedValue(
      name === "missing" ? [] : [{ id: storefront.channel_id, name }],
    );
    mocks.withStorefrontConfigurations.mockReturnValue({ storefronts: [] });
    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 0, failed: 0, productEmojiFailures: 0,
    });
    expect(mocks.publishDiscordStorefront).not.toHaveBeenCalled();
    expect(mocks.deleteDiscordStorefrontMessages).not.toHaveBeenCalled();
    expect(client.update).toHaveBeenCalledWith({
      configuration: {
        storefronts: [],
        retired_storefronts: [expect.objectContaining({
          channel_id: storefront.channel_id,
          retired_reason: name === "missing" ? "channel_unavailable" : "operational_channel",
        })],
      },
    });
  });

  it("preserva as referências se a consulta de canais falha", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.listDiscordTextChannels.mockRejectedValueOnce(new Error("Discord indisponível"));
    await expect(synchronizePublishedDiscordStorefronts()).resolves.toMatchObject({ published: 0, failed: 1 });
    expect(client.update).not.toHaveBeenCalled();
    expect(mocks.publishDiscordStorefront).not.toHaveBeenCalled();
  });

  it("preserva a vitrine única válida ao arquivar vitrines antigas do mesmo servidor", async () => {
    const integrated = {
      channel_id: "423456789012345678", channel_name: "todas-as-lojas",
      message_id: "523456789012345678", published_at: "2026-10-01T12:00:00.000Z",
    };
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.listDiscordTextChannels.mockResolvedValue([{ id: integrated.channel_id, name: integrated.channel_name }]);
    mocks.readDiscordIntegratedStorefrontConfiguration.mockReturnValue(integrated);
    mocks.publishDiscordIntegratedStorefront.mockResolvedValue({ configuration: integrated });
    mocks.withStorefrontConfigurations.mockReturnValue({ storefronts: [] });
    mocks.withDiscordIntegratedStorefrontConfiguration.mockReturnValue({
      storefronts: [], integrated_storefront: integrated,
    });

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toMatchObject({ published: 1, failed: 0 });
    expect(mocks.publishDiscordStorefront).not.toHaveBeenCalled();
    expect(client.update).toHaveBeenCalledWith({ configuration: {
      storefronts: [], integrated_storefront: integrated,
      retired_storefronts: [expect.objectContaining({ channel_id: storefront.channel_id })],
    } });
  });

  it("mantém a sincronização da THStore sem aplicar a limpeza específica da GW", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.isGWStore = false;
    await expect(synchronizePublishedDiscordStorefronts()).resolves.toMatchObject({ published: 1, failed: 0 });
    expect(mocks.listDiscordTextChannels).not.toHaveBeenCalled();
  });

  it("edita a vitrine já publicada e persiste os IDs rastreados", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 1,
      failed: 0,
      productEmojiFailures: 0,
    });
    expect(mocks.synchronizeDiscordProductEmojis).not.toHaveBeenCalled();
    expect(mocks.publishDiscordStorefront).toHaveBeenCalledWith({
      channel: { id: storefront.channel_id, name: storefront.channel_name },
      catalog: [
        {
          id: storefront.game_id,
          name: storefront.game_name,
          catalogStoreId: defaultStoreId,
          catalogStoreName: storefront.game_name,
          isDefaultStore: true,
          substores: [],
        },
      ],
      customization,
      previous: storefront,
      game: expect.objectContaining({
        id: storefront.game_id,
        name: storefront.game_name,
      }),
      store: { id: defaultStoreId, name: storefront.game_name },
    });
    expect(client.update).toHaveBeenCalledWith({
      configuration: { storefronts: [storefront] },
    });
  });

  it("só sincroniza ícones de produto quando a instalação opcional foi ativada", async () => {
    vi.stubEnv("DISCORD_PRODUCT_EMOJI_SYNC_ENABLED", "true");
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 1,
      failed: 0,
      productEmojiFailures: 0,
    });
    expect(mocks.synchronizeDiscordProductEmojis).toHaveBeenCalledWith(client);
  });

  it("sincroniza duas vitrines do mesmo servidor e salva sem corrida de atualização", async () => {
    const second = {
      ...storefront,
      game_id: "b5b82d6f-a324-47fa-a861-a046559e3a11",
      game_name: "Outro jogo",
      channel_id: "423456789012345678",
      channel_name: "outro-jogo",
      message_ids: ["523456789012345678"],
    };
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.readStorefrontConfigurations.mockReturnValue([storefront, second]);
    mocks.listCatalog.mockResolvedValue([
      {
        id: storefront.game_id,
        name: storefront.game_name,
        catalogStoreId: defaultStoreId,
        catalogStoreName: storefront.game_name,
        isDefaultStore: true,
        substores: [],
      },
      {
        id: second.game_id,
        name: second.game_name,
        catalogStoreId: "d5b82d6f-a324-47fa-a861-a046559e3a11",
        catalogStoreName: second.game_name,
        isDefaultStore: true,
        substores: [],
      },
    ]);
    mocks.publishDiscordStorefront
      .mockResolvedValueOnce({ configuration: storefront })
      .mockResolvedValueOnce({ configuration: second });
    mocks.withStorefrontConfigurations.mockReturnValue({
      storefronts: [storefront, second],
    });

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 2,
      failed: 0,
      productEmojiFailures: 0,
    });
    expect(mocks.publishDiscordStorefront).toHaveBeenCalledTimes(2);
    expect(client.update).toHaveBeenCalledTimes(1);
    expect(mocks.withStorefrontConfigurations).toHaveBeenCalledWith(
      expect.anything(),
      [storefront, second],
    );
  });

  it("informa falha sem impedir as outras vitrines", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.publishDiscordStorefront.mockRejectedValueOnce(new Error("Discord indisponível"));

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 0,
      failed: 1,
      productEmojiFailures: 0,
    });
    expect(client.update).not.toHaveBeenCalled();
  });

  it("remove a vitrine rastreada quando a loja foi excluÃ­da", async () => {
    const scopedStorefront = {
      ...storefront,
      catalog_store_id: "e5b82d6f-a324-47fa-a861-a046559e3a11",
      catalog_store_name: "Mundo removido",
    };
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.readStorefrontConfigurations.mockReturnValue([scopedStorefront]);
    mocks.listCatalog.mockResolvedValue([]);
    mocks.withStorefrontConfigurations.mockReturnValue({ storefronts: [] });

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 0,
      failed: 0,
      productEmojiFailures: 0,
    });
    expect(mocks.deleteDiscordStorefrontMessages).toHaveBeenCalledWith(scopedStorefront);
    expect(mocks.publishDiscordStorefront).not.toHaveBeenCalled();
    expect(mocks.withStorefrontConfigurations).toHaveBeenCalledWith(
      expect.anything(),
      [],
    );
    expect(client.update).toHaveBeenCalledWith({ configuration: { storefronts: [] } });
  });

  it("mantÃ©m a configuraÃ§Ã£o para repetir a limpeza se o Discord falhar", async () => {
    const scopedStorefront = {
      ...storefront,
      catalog_store_id: "e5b82d6f-a324-47fa-a861-a046559e3a11",
      catalog_store_name: "Mundo removido",
    };
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.readStorefrontConfigurations.mockReturnValue([scopedStorefront]);
    mocks.listCatalog.mockResolvedValue([]);
    mocks.deleteDiscordStorefrontMessages.mockRejectedValueOnce(
      new Error("Discord indisponÃ­vel"),
    );

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 0,
      failed: 1,
      productEmojiFailures: 0,
    });
    expect(client.update).not.toHaveBeenCalled();
  });
});

function clientMock() {
  const guildQuery = {
    eq: vi.fn(),
    is: vi.fn(async () => ({
      data: [{ id: "guild-row", discord_guild_id: "123456789012345678", configuration: { storefronts: [storefront] }, updated_at: "2026-10-03T12:00:00.000Z" }],
      error: null,
    })),
  };
  guildQuery.eq.mockReturnValue(guildQuery);

  const updateQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async (): Promise<{ data: { id: string } | null; error: null }> => ({ data: { id: "guild-row" }, error: null })),
  };
  updateQuery.eq.mockReturnValue(updateQuery);
  updateQuery.select.mockReturnValue(updateQuery);

  const client = {
    updateQuery,
    update: vi.fn(() => updateQuery),
    from: vi.fn(),
  };
  client.from.mockReturnValue({
    select: vi.fn(() => guildQuery),
    update: client.update,
  });
  return client;
}
