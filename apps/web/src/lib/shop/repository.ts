import "server-only";
import { SupabaseBotCommerceRepository } from "@/lib/bot/supabase-repository";
import { GW_UP_GUILD_ID } from "@/lib/bot/gw-up-catalog";
import type { BotCommerceRepository } from "@/lib/bot/types";
import { readBoosterDiscountConfiguration } from "@/lib/bot/booster-discount";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ShopError } from "./errors";
import type { ShopActor, ShopOrderItem, ShopOrderStatus } from "./types";

export type ShopClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
type RpcClient = {
  rpc(name: string, input: Record<string, unknown>): {
    single(): Promise<{ data: { checkout_order_id: string | null; was_created: boolean; out_of_stock: boolean } | null;
      error: { code?: string; message: string } | null }>;
  };
};

export class ShopCommerceRepository extends SupabaseBotCommerceRepository {
  constructor(
    private readonly shopClient: ShopClient,
    private readonly gameNickname: string,
    private readonly requirementsConfirmed: boolean,
    private readonly buyer: ShopActor,
  ) { super(shopClient); }

  override async ensureGuild() {
    const { data, error } = await this.shopClient.from("guilds")
      .select("id,whitelist_entry_id,configuration").eq("discord_guild_id", GW_UP_GUILD_ID)
      .eq("status", "active").is("archived_at", null).maybeSingle();
    if (error || !data?.whitelist_entry_id) throw new ShopError("unavailable");
    return { id: data.id, whitelistEntryId: data.whitelist_entry_id,
      boosterDiscount: readBoosterDiscountConfiguration(data.configuration) };
  }

  async readGuildIdentity() {
    const { data, error } = await this.shopClient.from("guilds")
      .select("discord_guild_id,owner_discord_id,name").eq("discord_guild_id", GW_UP_GUILD_ID)
      .eq("status", "active").is("archived_at", null).maybeSingle();
    if (error || !data) throw new ShopError("unavailable");
    return { discordGuildId: data.discord_guild_id, ownerDiscordId: data.owner_discord_id, name: data.name };
  }

  override async findPurchaseByInteraction(requestId: string) {
    const { data, error } = await this.shopClient.from("orders")
      .select("id,game_nickname,web_buyer_auth_user_id,buyer_discord_id").eq("payment_reference", `web:${requestId}`).maybeSingle();
    if (error) throw new ShopError("unavailable");
    if (!data) return null;
    if (data.game_nickname !== this.gameNickname || data.web_buyer_auth_user_id !== this.buyer.authUserId) throw new ShopError("request_conflict");
    return super.findPurchaseById(data.id);
  }

  override async findPurchasableProduct(productId: string) {
    const product = await super.findPurchasableProduct(productId);
    if (!product?.catalogStoreId) return null;
    const { data, error } = await this.shopClient.from("catalog_stores")
      .select("id").eq("id", product.catalogStoreId).eq("status", "active").is("archived_at", null).maybeSingle();
    if (error) throw new ShopError("unavailable");
    return data ? product : null;
  }

  override async createAwaitingPaymentPurchase(input: Parameters<BotCommerceRepository["createAwaitingPaymentPurchase"]>[0]) {
    return this.createWebPurchase(input);
  }

  /** Web-only entry: the Auth UUID owns the purchase; Discord is optional. */
  async createWebPurchase(input: Omit<Parameters<BotCommerceRepository["createAwaitingPaymentPurchase"]>[0], "buyerDiscordId"> & { buyerDiscordId: string | null }) {
    const { data, error } = await (this.shopClient as unknown as RpcClient)
      .rpc("create_gwstore_web_purchase", {
        p_request_id: input.interactionId,
        p_guild_id: input.guildId,
        p_whitelist_entry_id: input.whitelistEntryId,
        p_buyer_discord_id: this.buyer.discordId,
        p_items: input.items.map(item => ({ product_id: item.productId, quantity: item.quantity })),
        p_discount_bps: input.discountBps,
        p_discount_reason: input.discountReason,
        p_commission_bps: input.commissionBps,
        p_game_nickname: this.gameNickname,
        p_service_requirements_confirmed: this.requirementsConfirmed,
        p_buyer_auth_user_id: this.buyer.authUserId,
        p_buyer_name: this.buyer.displayName.slice(0, 80),
      }).single();
    if (error) {
      if (error.code === "P0008") throw new ShopError("rate_limited");
      if (error.code === "22000") throw new ShopError("request_conflict");
      if (error.code === "22023") throw new ShopError("invalid_request");
      if (error.code === "42501") throw new ShopError("product_unavailable");
      throw new ShopError("unavailable");
    }
    if (!data) throw new ShopError("unavailable");
    return { id: data.checkout_order_id, status: "awaiting_payment" as const,
      created: data.was_created, outOfStock: data.out_of_stock };
  }
}

export function requireShopClient(): ShopClient {
  const client = createAdminSupabaseClient();
  if (!client) throw new ShopError("unavailable");
  return client;
}

/** Service role reads are scoped to the authenticated buyer AND the GW guild. */
export async function readShopOrder(orderId: string, actor: ShopActor, client = requireShopClient()): Promise<ShopOrderStatus> {
  let query = client.from("orders").select(SHOP_ORDER_SELECT)
    .eq("id", orderId).like("payment_reference", "web:%").eq("guilds.discord_guild_id", GW_UP_GUILD_ID);
  if (!actor.isAdmin) query = query.eq("web_buyer_auth_user_id", actor.authUserId);
  const { data: result, error } = await query.maybeSingle();
  if (error) throw new ShopError("unavailable");
  const data = result as unknown as ShopOrderRow | null;
  if (!data || data.guilds?.discord_guild_id !== GW_UP_GUILD_ID) throw new ShopError("not_found");
  if (!actor.isAdmin && data.web_buyer_auth_user_id !== actor.authUserId) throw new ShopError("not_found");
  const order = orderDto(data);
  if (order.checkoutUrl && data.payment_provider_reference?.startsWith("ep:")) {
    const { data: checkout, error: pixError } = await client.from("eclipsepay_checkouts")
      .select("br_code,expires_at,operation_status").eq("order_id", data.id).maybeSingle();
    if (pixError) throw new ShopError("unavailable");
    if (checkout?.expires_at && (!order.paymentExpiresAt || Date.parse(checkout.expires_at) < Date.parse(order.paymentExpiresAt))) order.paymentExpiresAt = checkout.expires_at;
    if (checkout?.operation_status === "pending" && !isExpired(order.paymentExpiresAt)) order.pixCode = checkout.br_code;
    if (isExpired(order.paymentExpiresAt)) order.checkoutUrl = null;
  }
  return order;
}

export const SHOP_ORDER_SELECT = "id,status,payment_status,sale_price_cents,payment_checkout_url,payment_provider_reference,payment_expires_at,game_nickname,created_at,paid_at,delivered_at,buyer_discord_id,web_buyer_auth_user_id,web_buyer_name,web_items_snapshot,guilds!inner(discord_guild_id)";
export type ShopOrderRow = {
  id: string; status: string; payment_status: string; sale_price_cents: number; payment_checkout_url: string | null;
  payment_provider_reference: string | null; payment_expires_at: string | null; game_nickname: string | null;
  created_at: string; paid_at: string | null; delivered_at: string | null; buyer_discord_id: string | null;
  web_buyer_auth_user_id: string | null; web_buyer_name: string | null; web_items_snapshot: unknown;
  guilds: { discord_guild_id: string } | null;
};

export function orderDto(data: ShopOrderRow): ShopOrderStatus {
  const amount = Number(data.sale_price_cents);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ShopError("unavailable");
  const payable = data.status === "awaiting_payment" && data.payment_status === "pending" && !isExpired(data.payment_expires_at);
  return {
    orderId: data.id, status: data.status, paymentStatus: data.payment_status,
    totalPriceCents: amount, checkoutUrl: payable ? data.payment_checkout_url : null, ticketUrl: null,
    chatUrl: data.paid_at ? `/minhas-compras/${data.id}` : null,
    gameNickname: data.game_nickname, createdAt: data.created_at, paidAt: data.paid_at, deliveredAt: data.delivered_at,
    paymentExpiresAt: data.payment_expires_at, pixCode: null,
    buyerName: data.web_buyer_name || "Cliente", items: readItemsSnapshot(data.web_items_snapshot),
  };
}

function readItemsSnapshot(value: unknown): ShopOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || typeof item.productName !== "string"
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1
      || !Number.isSafeInteger(item.unitPriceCents) || !Number.isSafeInteger(item.totalPriceCents)) return [];
    return [{ productName: item.productName, quantity: item.quantity, unitPriceCents: item.unitPriceCents, totalPriceCents: item.totalPriceCents }];
  });
}

function isExpired(value: string | null) { return value !== null && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()); }
