import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseBotCommerceRepository } from "./supabase-repository";

function queryReturning(result: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    update: vi.fn(() => query),
  };
  return query;
}

function queryReturningSequence(results: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(async () => results.shift()),
    update: vi.fn(() => query),
  };
  return query;
}

describe("SupabaseBotCommerceRepository compradores opcionais", () => {
  it("preserva a compra web sem Discord na leitura compartilhada por ID", async () => {
    const orderQuery = queryReturning({ data: {
      id: "web-order", buyer_discord_id: null, guild_id: "guild-row", status: "paid",
      subtotal_price_cents: 200, sale_price_cents: 200, discount_bps: 0, discount_amount_cents: 0,
      discount_reason: null, upsell_product_id: null, upsell_discount_bps: 0, upsell_discount_amount_cents: 0,
      lead_recovery_discount_bps: 0, lead_recovery_discount_amount_cents: 0,
    }, error: null });
    const itemQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn(async () => ({ data: [], error: null })),
    };
    const from = vi.fn((table: string) => table === "orders" ? orderQuery : itemQuery);
    await expect(new SupabaseBotCommerceRepository({ from } as never).findPurchaseById("web-order"))
      .resolves.toMatchObject({ id: "web-order", buyerDiscordId: null, salePriceCents: 200 });
  });

  it("mantém a leitura exclusiva do pedido Discord estrita", async () => {
    const orderQuery = queryReturning({ data: { id: "web-order", buyer_discord_id: null }, error: null });
    const from = vi.fn(() => orderQuery);
    await expect(new SupabaseBotCommerceRepository({ from } as never).findOrderByInteraction("123456789012345678"))
      .rejects.toThrow("Pedido Discord sem comprador válido");
  });
});

describe("SupabaseBotCommerceRepository.ensureGuild", () => {
  it("reutiliza o cadastro ativo quando a identidade do servidor não mudou", async () => {
    const whitelistQuery = queryReturning({
      data: { id: "15c5caff-a349-4ca8-9955-f5a069caa956" },
      error: null,
    });
    const guildQuery = queryReturning({
      data: {
        id: "6b272381-d0c0-46bd-83da-71061770549f",
        owner_discord_id: "949355341353721868",
        whitelist_entry_id: "15c5caff-a349-4ca8-9955-f5a069caa956",
        name: "THStore",
        status: "active",
        configuration: {},
        archived_at: null,
        left_at: null,
        last_bot_seen_at: "2999-01-01T00:00:00.000Z",
      },
      error: null,
    });
    const client = {
      from: vi.fn((table: string) =>
        table === "whitelist_entries" ? whitelistQuery : guildQuery,
      ),
    };
    const repository = new SupabaseBotCommerceRepository(client as never);

    await expect(
      repository.ensureGuild({
        discordGuildId: "1319006069611302932",
        ownerDiscordId: "949355341353721868",
        name: "THStore",
      }),
    ).resolves.toMatchObject({
      id: "6b272381-d0c0-46bd-83da-71061770549f",
      whitelistEntryId: "15c5caff-a349-4ca8-9955-f5a069caa956",
    });
    expect(guildQuery.update).not.toHaveBeenCalled();
  });

  it("mantém o checkout funcionando quando a base ainda não possui a coluna de heartbeat", async () => {
    const whitelistQuery = queryReturning({
      data: { id: "15c5caff-a349-4ca8-9955-f5a069caa956" },
      error: null,
    });
    const guildQuery = queryReturningSequence([
      {
        data: null,
        error: {
          code: "42703",
          message: "column guilds.last_bot_seen_at does not exist",
        },
      },
      {
        data: {
          id: "6b272381-d0c0-46bd-83da-71061770549f",
          owner_discord_id: "949355341353721868",
          whitelist_entry_id: "15c5caff-a349-4ca8-9955-f5a069caa956",
          name: "THStore",
          status: "active",
          configuration: {},
          archived_at: null,
          left_at: null,
        },
        error: null,
      },
    ]);
    const client = {
      from: vi.fn((table: string) =>
        table === "whitelist_entries" ? whitelistQuery : guildQuery,
      ),
    };
    const repository = new SupabaseBotCommerceRepository(client as never);

    await expect(
      repository.ensureGuild({
        discordGuildId: "1319006069611302932",
        ownerDiscordId: "949355341353721868",
        name: "THStore",
      }),
    ).resolves.toMatchObject({
      id: "6b272381-d0c0-46bd-83da-71061770549f",
      whitelistEntryId: "15c5caff-a349-4ca8-9955-f5a069caa956",
    });
    expect(guildQuery.update).not.toHaveBeenCalled();
  });
});

describe("SupabaseBotCommerceRepository.findPurchasableProduct", () => {
  it("expõe catálogo e estoque ilimitado usando somente produtos ativos", async () => {
    const productId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
    const storeId = "22222222-2222-4222-8222-222222222222";
    const productQuery = queryReturning({ data: { id: productId, name: "Kitsune Permanente", minimum_price_cents: 20_000, substore_id: "substore", catalog_store_id: storeId, unlimited_stock: true }, error: null });
    const substoreQuery = queryReturning({ data: { game_id: "game" }, error: null });
    const gameQuery = queryReturning({ data: { id: "game" }, error: null });
    const client = { from: vi.fn((table: string) => table === "products" ? productQuery : table === "substores" ? substoreQuery : gameQuery) };
    expect(await new SupabaseBotCommerceRepository(client as never).findPurchasableProduct(productId))
      .toEqual({ id: productId, name: "Kitsune Permanente", minimumPriceCents: 20_000, catalogStoreId: storeId, unlimitedStock: true });
    expect(productQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(productQuery.is).toHaveBeenCalledWith("archived_at", null);
  });
  it("retorna indisponível quando o produto foi pausado", async () => {
    const productQuery = queryReturning({ data: null, error: null });
    const client = { from: vi.fn(() => productQuery) };
    expect(await new SupabaseBotCommerceRepository(client as never).findPurchasableProduct("9a845b40-7c4e-4d25-9f3f-3cbd27f050c9"))
      .toBeNull();
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
