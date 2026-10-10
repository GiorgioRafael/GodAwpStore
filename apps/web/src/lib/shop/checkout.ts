import "server-only";
import { IS_GWSTORE } from "@/lib/brand";
import { BotCommerceService } from "@/lib/bot/commerce-service";
import { GW_UP_GUILD_ID, GW_UP_STORE_ID } from "@/lib/bot/gw-up-catalog";
import type { BotCommerceRepository, DiscordGuildIdentity } from "@/lib/bot/types";
import { getLivePixPaymentService } from "@/lib/livepix/runtime";
import { getSiteUrl } from "@/lib/env";
import { ShopError } from "./errors";
import { ShopCommerceRepository, readShopOrder, requireShopClient } from "./repository";
import { shopCheckoutSchema } from "./validation";
import type { ShopActor, ShopOrderStatus } from "./types";

type BuyerContext = { guild: DiscordGuildIdentity; isServerBooster: boolean };
type CheckoutDependencies = {
  repository?: BotCommerceRepository;
  buyerContext?: (buyerDiscordId: string | null) => Promise<BuyerContext>;
  createWebPurchase?: ShopCommerceRepository["createWebPurchase"];
  createCheckout?: (orderId: string) => Promise<unknown>;
  readOrder?: (orderId: string, actor: ShopActor) => Promise<ShopOrderStatus>;
};

export async function createShopCheckout(raw: unknown, actor: ShopActor, dependencies: CheckoutDependencies = {}) {
  if (!IS_GWSTORE) throw new ShopError("not_found");
  const parsed = shopCheckoutSchema.safeParse(raw);
  if (!parsed.success || (actor.discordId !== null && !/^[0-9]{17,20}$/.test(actor.discordId))) throw new ShopError("invalid_request");
  const buyerDiscordId = actor.discordId;
  const input = parsed.data;
  const repository = dependencies.repository ?? new ShopCommerceRepository(
    requireShopClient(), input.gameNickname, input.serviceRequirementsConfirmed === true, actor,
  );
  const context = await (dependencies.buyerContext ?? (async () => ({
    guild: await (repository as ShopCommerceRepository).readGuildIdentity(), isServerBooster: false,
  })))(buyerDiscordId);
  if (context.guild.discordGuildId !== GW_UP_GUILD_ID) throw new ShopError("forbidden");
  // An idempotent retry must retain its existing invoice even if a product is
  // paused afterwards. The commerce service still validates buyer/items/guild.
  const existing = await repository.findPurchaseByInteraction(input.requestId);
  if (existing) {
    const guild = await repository.ensureGuild(context.guild);
    if (existing.guildId !== guild.id || existing.items.length !== input.items.length || existing.items.some((item, index) =>
      item.productId !== input.items[index]?.productId || item.quantity !== input.items[index]?.quantity)) throw new ShopError("request_conflict");
  } else {
    const products = await repository.findPurchasableProducts(input.items.map(item => item.productId));
    if (products.length !== input.items.length) throw new ShopError("product_unavailable");
    if (products.some(product => product.catalogStoreId === GW_UP_STORE_ID) && input.serviceRequirementsConfirmed !== true) {
      throw new ShopError("requirements_required");
    }
  }
  const result = existing ? { kind: "duplicate" as const, orderId: existing.id } : buyerDiscordId ? await new BotCommerceService(repository, "web").purchaseCart({
    interactionId: input.requestId, buyerDiscordId, items: input.items,
    // Web delivery has no Discord guild-membership dependency; only earned
    // customer-rank discounts apply. Booster status cannot be supplied by a client.
    isServerBooster: false, guild: context.guild,
    serviceRequirementsConfirmed: input.serviceRequirementsConfirmed,
  }) : await (async () => {
    const guild = await repository.ensureGuild(context.guild);
    if (!guild.whitelistEntryId) throw new ShopError("unavailable");
    const createPurchase = dependencies.createWebPurchase ?? ((args: Parameters<ShopCommerceRepository["createWebPurchase"]>[0]) =>
      (repository as ShopCommerceRepository).createWebPurchase(args));
    const purchase = await createPurchase({
      interactionId: input.requestId, guildId: guild.id, whitelistEntryId: guild.whitelistEntryId,
      buyerDiscordId: null, items: input.items, discountBps: 0, discountReason: null,
      commissionBps: await repository.getCommissionBps(guild.whitelistEntryId),
    });
    if (purchase.outOfStock || !purchase.id) throw new ShopError("out_of_stock");
    return { kind: purchase.created ? "created" as const : "duplicate" as const, orderId: purchase.id };
  })();
  if (result.kind !== "created" && result.kind !== "duplicate") {
    if (result.kind === "out_of_stock" || result.kind === "insufficient_stock") throw new ShopError("out_of_stock");
    if (result.kind === "total_below_minimum") throw new ShopError("total_below_minimum");
    if (result.kind === "interaction_conflict") throw new ShopError("request_conflict");
    if (result.kind === "product_unavailable") throw new ShopError("product_unavailable");
    throw new ShopError("invalid_request");
  }
  const readOrder = dependencies.readOrder ?? readShopOrder;
  const order = await readOrder(result.orderId, actor);
  // Retried paid/expired requests return their existing outcome, never another invoice.
  if (order.status !== "awaiting_payment" || order.paymentStatus === "paid"
    || (order.paymentExpiresAt && Date.parse(order.paymentExpiresAt) <= Date.now())) return order;
  try {
    await (dependencies.createCheckout ?? (orderId => getLivePixPaymentService().createCheckout(orderId, getSiteUrl())))(result.orderId);
  } catch {
    throw new ShopError("checkout_pending");
  }
  // Read authoritative persisted totals after the RPC, including a price update
  // between the catalog preview and its transaction. Never echo client totals.
  return readOrder(result.orderId, actor);
}
