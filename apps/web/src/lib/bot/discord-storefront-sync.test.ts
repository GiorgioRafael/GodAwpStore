import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  listCatalog: vi.fn(),
  publishDiscordStorefront: vi.fn(),
  readStorefrontConfiguration: vi.fn(),
  withStorefrontConfiguration: vi.fn(),
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
  readStorefrontConfiguration: mocks.readStorefrontConfiguration,
  withStorefrontConfiguration: mocks.withStorefrontConfiguration,
}));

import { synchronizePublishedDiscordStorefronts } from "./discord-storefront-sync";

const storefront = {
  channel_id: "223456789012345678",
  channel_name: "compras",
  message_ids: ["323456789012345678"],
  published_at: "2026-07-17T09:00:00.000Z",
};

describe("sincronização automática da vitrine Discord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCatalog.mockResolvedValue([]);
    mocks.readStorefrontConfiguration.mockReturnValue(storefront);
    mocks.withStorefrontConfiguration.mockReturnValue({ storefront });
    mocks.publishDiscordStorefront.mockResolvedValue({ configuration: storefront });
  });

  it("edita a vitrine já publicada e persiste os IDs rastreados", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 1,
      failed: 0,
    });
    expect(mocks.publishDiscordStorefront).toHaveBeenCalledWith({
      channel: { id: storefront.channel_id, name: storefront.channel_name },
      catalog: [],
      previous: storefront,
    });
    expect(client.update).toHaveBeenCalledWith({ configuration: { storefront } });
  });

  it("informa falha sem impedir as outras vitrines", async () => {
    const client = clientMock();
    mocks.createAdminSupabaseClient.mockReturnValue(client);
    mocks.publishDiscordStorefront.mockRejectedValueOnce(new Error("Discord indisponível"));

    await expect(synchronizePublishedDiscordStorefronts()).resolves.toEqual({
      published: 0,
      failed: 1,
    });
    expect(client.update).not.toHaveBeenCalled();
  });
});

function clientMock() {
  const guildQuery = {
    eq: vi.fn(),
    is: vi.fn(async () => ({
      data: [{ id: "guild-row", configuration: { storefront } }],
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
