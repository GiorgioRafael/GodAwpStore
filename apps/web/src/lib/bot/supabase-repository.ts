import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  BotCatalogGame,
  BotCommerceRepository,
  CartItemInput,
  DiscordGuildIdentity,
  ExistingPurchase,
  ExistingOrder,
  OrderCreation,
  PurchasableProduct,
  RegisteredGuild,
} from "./types";
import { readBoosterDiscountConfiguration } from "./booster-discount";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export class SupabaseBotCommerceRepository implements BotCommerceRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async listCatalog(): Promise<BotCatalogGame[]> {
    const [gamesResult, substoresResult, productsResult, stockResult] = await Promise.all([
      this.client
        .from("games")
        .select("id,name,sort_order")
        .eq("status", "active")
        .is("archived_at", null)
        .order("sort_order")
        .order("name"),
      this.client
        .from("substores")
        .select("id,game_id,name,title,description,color_hex,image_url,sort_order")
        .eq("status", "active")
        .is("archived_at", null)
        .order("sort_order")
        .order("name"),
      this.client
        .from("products")
        .select("id,substore_id,name,description,minimum_price_cents,sort_order")
        .eq("status", "active")
        .is("archived_at", null)
        .order("sort_order")
        .order("name"),
      this.client.from("product_stock_summary").select("product_id,available_count"),
    ]);

    assertQuery(gamesResult.error, "jogos");
    assertQuery(substoresResult.error, "sublojas");
    assertQuery(productsResult.error, "produtos");
    assertQuery(stockResult.error, "estoque");

    const stockByProduct = new Map(
      (stockResult.data ?? []).map((row) => [row.product_id, safeInteger(row.available_count)]),
    );
    const productsBySubstore = new Map<string, BotCatalogGame["substores"][number]["products"]>();

    for (const product of productsResult.data ?? []) {
      const products = productsBySubstore.get(product.substore_id) ?? [];
      products.push({
        id: product.id,
        name: product.name,
        description: product.description,
        priceCents: safeInteger(product.minimum_price_cents),
        availableStock: stockByProduct.get(product.id) ?? 0,
      });
      productsBySubstore.set(product.substore_id, products);
    }

    const substoresByGame = new Map<string, BotCatalogGame["substores"]>();
    for (const substore of substoresResult.data ?? []) {
      const products = productsBySubstore.get(substore.id) ?? [];
      if (products.length === 0) continue;

      const substores = substoresByGame.get(substore.game_id) ?? [];
      substores.push({
        id: substore.id,
        name: substore.name,
        title: substore.title,
        description: substore.description,
        colorHex: substore.color_hex,
        imageUrl: substore.image_url,
        products,
      });
      substoresByGame.set(substore.game_id, substores);
    }

    return (gamesResult.data ?? [])
      .map((game) => ({ id: game.id, name: game.name, substores: substoresByGame.get(game.id) ?? [] }))
      .filter((game) => game.substores.length > 0);
  }

  async findOrderByInteraction(interactionId: string): Promise<ExistingOrder | null> {
    const { data, error } = await this.client
      .from("orders")
      .select("id,buyer_discord_id,product_id,quantity,minimum_price_cents,subtotal_price_cents,sale_price_cents,discount_bps,discount_amount_cents,discount_reason,status")
      .eq("payment_reference", interactionReference(interactionId))
      .maybeSingle();
    assertQuery(error, "pedido existente");

    return data
      ? {
          id: data.id,
          buyerDiscordId: data.buyer_discord_id,
          productId: data.product_id,
          quantity: safeInteger(data.quantity),
          unitPriceCents: safeInteger(data.minimum_price_cents),
          subtotalPriceCents: safeInteger(data.subtotal_price_cents),
          salePriceCents: safeInteger(data.sale_price_cents),
          discountBps: safeInteger(data.discount_bps),
          discountAmountCents: safeInteger(data.discount_amount_cents),
          discountReason: data.discount_reason === "server_booster" ? "server_booster" : null,
          status: data.status,
        }
      : null;
  }

  async findPurchaseByInteraction(interactionId: string): Promise<ExistingPurchase | null> {
    const { data: lead, error: leadError } = await this.client
      .from("orders")
      .select("id,buyer_discord_id,guild_id,subtotal_price_cents,sale_price_cents,discount_bps,discount_amount_cents,discount_reason,status")
      .eq("payment_reference", interactionReference(interactionId))
      .maybeSingle();
    assertQuery(leadError, "compra existente");
    if (!lead) return null;

    const { data: rows, error: rowsError } = await this.client
      .from("order_items")
      .select("product_id,quantity,unit_price_cents,subtotal_price_cents,sale_price_cents,discount_amount_cents,position")
      .eq("order_id", lead.id)
      .order("position");
    assertQuery(rowsError, "itens da compra existente");

    const productIds = (rows ?? []).map((row) => row.product_id);
    const { data: products, error: productsError } = productIds.length
      ? await this.client.from("products").select("id,name").in("id", productIds)
      : { data: [], error: null };
    assertQuery(productsError, "produtos da compra existente");
    const names = new Map((products ?? []).map((product) => [product.id, product.name]));

    return {
      id: lead.id,
      buyerDiscordId: lead.buyer_discord_id,
      guildId: lead.guild_id,
      items: (rows ?? []).map((row) => ({
        productId: row.product_id,
        productName: names.get(row.product_id) ?? "Produto",
        quantity: safeInteger(row.quantity),
        unitPriceCents: safeInteger(row.unit_price_cents),
        subtotalPriceCents: safeInteger(row.subtotal_price_cents),
        totalPriceCents: safeInteger(row.sale_price_cents),
        discountAmountCents: safeInteger(row.discount_amount_cents),
      })),
      subtotalPriceCents: (rows ?? []).reduce(
        (sum, row) => sum + safeInteger(row.subtotal_price_cents),
        0,
      ),
      salePriceCents: (rows ?? []).reduce(
        (sum, row) => sum + safeInteger(row.sale_price_cents),
        0,
      ),
      discountBps: safeInteger(lead.discount_bps),
      discountAmountCents: (rows ?? []).reduce(
        (sum, row) => sum + safeInteger(row.discount_amount_cents),
        0,
      ),
      discountReason: lead.discount_reason === "server_booster" ? "server_booster" : null,
      status: lead.status,
    };
  }

  async ensureGuild(identity: DiscordGuildIdentity): Promise<RegisteredGuild> {
    const { data: whitelist, error: whitelistError } = await this.client
      .from("whitelist_entries")
      .select("id")
      .eq("discord_id", identity.ownerDiscordId)
      .eq("is_active", true)
      .is("archived_at", null)
      .maybeSingle();
    assertQuery(whitelistError, "whitelist do servidor");

    const { data: existing, error: existingError } = await this.client
      .from("guilds")
      .select("id")
      .eq("discord_guild_id", identity.discordGuildId)
      .maybeSingle();
    assertQuery(existingError, "servidor existente");

    const now = new Date().toISOString();
    const record = {
      owner_discord_id: identity.ownerDiscordId,
      name: identity.name,
      whitelist_entry_id: whitelist?.id ?? null,
      status: "active" as const,
      archived_at: null,
      left_at: null,
    };

    const query = existing
      ? this.client.from("guilds").update(record).eq("id", existing.id).select("id,whitelist_entry_id,configuration").single()
      : this.client
          .from("guilds")
          .insert({
            ...record,
            discord_guild_id: identity.discordGuildId,
            joined_at: now,
          })
          .select("id,whitelist_entry_id,configuration")
          .single();
    const { data, error } = await query;
    assertQuery(error, "registro do servidor");

    return {
      id: data.id,
      whitelistEntryId: data.whitelist_entry_id,
      boosterDiscount: readBoosterDiscountConfiguration(data.configuration),
    };
  }

  async findPurchasableProduct(productId: string): Promise<PurchasableProduct | null> {
    const { data: product, error: productError } = await this.client
      .from("products")
      .select("id,substore_id,name,minimum_price_cents")
      .eq("id", productId)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    assertQuery(productError, "produto");
    if (!product) return null;

    const { data: substore, error: substoreError } = await this.client
      .from("substores")
      .select("game_id")
      .eq("id", product.substore_id)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    assertQuery(substoreError, "subloja");
    if (!substore) return null;

    const { data: game, error: gameError } = await this.client
      .from("games")
      .select("id")
      .eq("id", substore.game_id)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    assertQuery(gameError, "jogo");
    if (!game) return null;

    return {
      id: product.id,
      name: product.name,
      minimumPriceCents: safeInteger(product.minimum_price_cents),
    };
  }

  async findPurchasableProducts(productIds: string[]): Promise<PurchasableProduct[]> {
    const products = await Promise.all(
      productIds.map((productId) => this.findPurchasableProduct(productId)),
    );
    return products.filter((product): product is PurchasableProduct => product !== null);
  }

  async countAvailableStock(productId: string): Promise<number> {
    const { data, error } = await this.client
      .from("product_stock_summary")
      .select("available_count")
      .eq("product_id", productId)
      .maybeSingle();
    assertQuery(error, "estoque do produto");
    return safeInteger(data?.available_count ?? 0);
  }

  async countAvailableStocks(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from("product_stock_summary")
      .select("product_id,available_count")
      .in("product_id", productIds);
    assertQuery(error, "estoque dos produtos");
    return new Map(
      (data ?? []).map((row) => [row.product_id, safeInteger(row.available_count)]),
    );
  }

  async getCommissionBps(whitelistEntryId: string | null): Promise<number> {
    if (whitelistEntryId) {
      const { data, error } = await this.client
        .from("effective_whitelist_commissions")
        .select("effective_commission_bps")
        .eq("whitelist_entry_id", whitelistEntryId)
        .maybeSingle();
      assertQuery(error, "comissão da whitelist");
      if (data) return clampCommission(data.effective_commission_bps);
    }

    const { data, error } = await this.client
      .from("platform_settings")
      .select("global_commission_bps")
      .eq("id", 1)
      .single();
    assertQuery(error, "comissão global");
    return clampCommission(data.global_commission_bps);
  }

  async createAwaitingPaymentOrder(input: {
    interactionId: string;
    guildId: string;
    whitelistEntryId: string | null;
    product: PurchasableProduct;
    buyerDiscordId: string;
    quantity: number;
    subtotalPriceCents: number;
    totalPriceCents: number;
    discountBps: number;
    discountAmountCents: number;
    discountReason: "server_booster" | null;
    commissionBps: number;
  }): Promise<OrderCreation> {
    if (!input.whitelistEntryId) {
      throw new Error("Servidor sem vendedor autorizado.");
    }
    const { data, error } = await this.client
      .rpc("create_bot_order_with_reservation", {
        p_interaction_id: input.interactionId,
        p_guild_id: input.guildId,
        p_whitelist_entry_id: input.whitelistEntryId,
        p_product_id: input.product.id,
        p_buyer_discord_id: input.buyerDiscordId,
        p_quantity: input.quantity,
        p_subtotal_price_cents: input.subtotalPriceCents,
        p_sale_price_cents: input.totalPriceCents,
        p_discount_bps: input.discountBps,
        p_discount_amount_cents: input.discountAmountCents,
        p_discount_reason: input.discountReason,
        p_commission_bps: input.commissionBps,
      })
      .single();
    assertQuery(error, "criação do pedido");
    return {
      id: data.created_order_id,
      status: "awaiting_payment",
      created: data.was_created,
      outOfStock: data.out_of_stock,
    };
  }

  async createAwaitingPaymentPurchase(input: {
    interactionId: string;
    guildId: string;
    whitelistEntryId: string | null;
    buyerDiscordId: string;
    items: CartItemInput[];
    discountBps: number;
    discountReason: "server_booster" | null;
    commissionBps: number;
  }) {
    if (!input.whitelistEntryId) {
      throw new Error("Servidor sem vendedor autorizado.");
    }
    const { data, error } = await this.client
      .rpc("create_bot_cart_with_reservation", {
        p_interaction_id: input.interactionId,
        p_guild_id: input.guildId,
        p_whitelist_entry_id: input.whitelistEntryId,
        p_buyer_discord_id: input.buyerDiscordId,
        p_items: input.items.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
        })),
        p_discount_bps: input.discountBps,
        p_discount_reason: input.discountReason,
        p_commission_bps: input.commissionBps,
      })
      .single();
    assertQuery(error, "criação da compra");
    return {
      id: data.checkout_order_id,
      status: "awaiting_payment" as const,
      created: data.was_created,
      outOfStock: data.out_of_stock,
    };
  }
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function interactionReference(interactionId: string) {
  return `discord:${interactionId}`;
}

function assertQuery(error: { message: string } | null, operation: string): asserts error is null {
  if (error) throw new Error(`Falha ao consultar ${operation}.`);
}

function safeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function clampCommission(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : 0;
}
