import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchDiscordGuildIdentity: vi.fn(),
  readDiscordInteraction: vi.fn(),
  listCatalog: vi.fn(),
  scopeCatalogToDiscordChannel: vi.fn(),
  prepareCartQuantities: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./discord-context", () => ({
  fetchDiscordGuildIdentity: mocks.fetchDiscordGuildIdentity,
  readDiscordInteraction: mocks.readDiscordInteraction,
}));
vi.mock("./supabase-repository", () => ({
  SupabaseBotCommerceRepository: class {
    listCatalog = mocks.listCatalog;
  },
}));
vi.mock("./discord-storefront-scope", () => ({
  scopeCatalogToDiscordChannel: mocks.scopeCatalogToDiscordChannel,
}));
vi.mock("./commerce-service", () => ({
  BotCommerceService: class {
    prepareCartQuantities = mocks.prepareCartQuantities;
  },
}));

import { prepareDiscordCartQuantities } from "./discord-quantity-preparation";

const productId = "10000000-0000-4000-8000-000000000001";
const otherProductId = "10000000-0000-4000-8000-000000000002";
const guild = {
  discordGuildId: "123456789012345678",
  ownerDiscordId: "223456789012345678",
  name: "GWStore",
};
const scopedCatalog = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Grow a Garden 2",
    catalogStoreId: "30000000-0000-4000-8000-000000000001",
    catalogStoreName: "Mundo 1",
    isDefaultStore: true,
    substores: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        name: "Seeds",
        title: "Seeds",
        description: "",
        colorHex: "#d7ad42",
        imageUrl: null,
        products: [
          {
            id: productId,
            name: "Star Fruit",
            description: null,
            priceCents: 100,
            availableStock: 10,
            sortOrder: 0,
          },
        ],
      },
    ],
  },
];

describe("preparação de quantidades por loja", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readDiscordInteraction.mockReturnValue({
      guildId: guild.discordGuildId,
      channelId: "323456789012345678",
      userId: "423456789012345678",
      isServerBooster: false,
    });
    mocks.fetchDiscordGuildIdentity.mockResolvedValue(guild);
    mocks.listCatalog.mockResolvedValue(scopedCatalog);
    mocks.scopeCatalogToDiscordChannel.mockResolvedValue(scopedCatalog);
    mocks.prepareCartQuantities.mockResolvedValue({
      kind: "ready",
      items: [],
      totalPriceCents: 100,
    });
  });

  it("aceita somente produtos pertencentes à loja publicada no canal", async () => {
    await expect(prepareDiscordCartQuantities({}, [productId])).resolves.toMatchObject({
      kind: "ready",
    });
    expect(mocks.scopeCatalogToDiscordChannel).toHaveBeenCalledWith(
      scopedCatalog,
      guild.discordGuildId,
      "323456789012345678",
    );
    expect(mocks.prepareCartQuantities).toHaveBeenCalledTimes(1);
  });

  it("rejeita um ID válido que pertença a outra loja", async () => {
    await expect(prepareDiscordCartQuantities({}, [otherProductId])).resolves.toEqual({
      kind: "product_unavailable",
    });
    expect(mocks.prepareCartQuantities).not.toHaveBeenCalled();
  });
});
