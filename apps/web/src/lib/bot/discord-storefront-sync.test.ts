import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  listCatalog: vi.fn(),
  publishDiscordStorefront: vi.fn(),
  readStorefrontConfigurations: vi.fn(),
  withStorefrontConfigurations: vi.fn(),
  loadBotMessageCustomization: vi.fn(),
  synchronizeDiscordProductEmojis: vi.fn(),
}));

vi.mock("server-only", () => ({}));
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
  publishDiscordStorefront: mocks.publishDiscordStorefront,
  readStorefrontConfigurations: mocks.readStorefrontConfigurations,
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
    mocks.withStorefrontConfigurations.mockReturnValue({ storefronts: [storefront] });
    mocks.loadBotMessageCustomization.mockResolvedValue(customization);
    mocks.publishDiscordStorefront.mockResolvedValue({ configuration: storefront });
    mocks.synchronizeDiscordProductEmojis.mockResolvedValue({ failed: 0 });
  });

  it("edita a vitrine já publicada e persiste os IDs rastreados", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 1,
      failed: 0,
      productEmojiFailures: 0,
    });
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
});

function clientMock() {
  const guildQuery = {
    eq: vi.fn(),
    is: vi.fn(async () => ({
      data: [{ id: "guild-row", configuration: { storefronts: [storefront] } }],
      error: null,
    })),
  };
  guildQuery.eq.mockReturnValue(guildQuery);

  const updateQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: { id: "guild-row" }, error: null })),
  };
  updateQuery.eq.mockReturnValue(updateQuery);
  updateQuery.select.mockReturnValue(updateQuery);

  const client = {
    update: vi.fn(() => updateQuery),
    from: vi.fn(),
  };
  client.from.mockReturnValue({
    select: vi.fn(() => guildQuery),
    update: client.update,
  });
  return client;
}
