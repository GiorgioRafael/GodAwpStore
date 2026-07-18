import type {
  BotCatalogGame,
  BotCommerceRepository,
  CartItemInput,
  CartPurchaseResult,
  DiscordGuildIdentity,
  PurchaseItem,
  PurchaseResult,
} from "./types";
import {
  calculateOrderTotalCents,
  LIVEPIX_MINIMUM_BRL_CENTS,
  minimumLivePixQuantity,
} from "@/lib/livepix/limits";
import { applyBoosterDiscount } from "./booster-discount";
import { MAXIMUM_CART_ITEMS as MAX_CART_ITEMS } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export class BotCommerceService {
  constructor(private readonly repository: BotCommerceRepository) {}

  listCatalog(): Promise<BotCatalogGame[]> {
    return this.repository.listCatalog();
  }

  async registerGuild(identity: DiscordGuildIdentity) {
    if (!isValidGuild(identity)) {
      return null;
    }

    return this.repository.ensureGuild(identity);
  }

  async purchase(input: {
    interactionId: string;
    buyerDiscordId: string;
    productId: string;
    quantity: number;
    isServerBooster: boolean;
    guild: DiscordGuildIdentity;
  }): Promise<PurchaseResult> {
    if (
      !SNOWFLAKE_PATTERN.test(input.interactionId) ||
      !SNOWFLAKE_PATTERN.test(input.buyerDiscordId) ||
      !UUID_PATTERN.test(input.productId) ||
      !isValidGuild(input.guild)
    ) {
      return { kind: "invalid_request" };
    }
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      return { kind: "invalid_quantity" };
    }

    const existing = await this.repository.findOrderByInteraction(input.interactionId);
    if (existing) {
      if (
        existing.buyerDiscordId !== input.buyerDiscordId ||
        existing.productId !== input.productId ||
        existing.quantity !== input.quantity
      ) {
        return { kind: "interaction_conflict" };
      }

      const product = await this.repository.findPurchasableProduct(input.productId);
      return {
        kind: "duplicate",
        orderId: existing.id,
        productName: product?.name ?? "Produto",
        quantity: existing.quantity,
        unitPriceCents: existing.unitPriceCents,
        subtotalPriceCents: existing.subtotalPriceCents,
        totalPriceCents: existing.salePriceCents,
        discountBps: existing.discountBps,
        discountAmountCents: existing.discountAmountCents,
        discountReason: existing.discountReason,
      };
    }

    const [guild, product] = await Promise.all([
      this.repository.ensureGuild(input.guild),
      this.repository.findPurchasableProduct(input.productId),
    ]);

    if (!product) {
      return { kind: "product_unavailable" };
    }
    if (!guild.whitelistEntryId) {
      return { kind: "guild_not_authorized" };
    }

    const minimumQuantity = minimumLivePixQuantity(product.minimumPriceCents);
    const subtotalPriceCents = calculateOrderTotalCents(product.minimumPriceCents, input.quantity);
    const pricing = subtotalPriceCents === null
      ? null
      : applyBoosterDiscount(
          subtotalPriceCents,
          guild.boosterDiscount,
          input.isServerBooster,
        );
    if (!minimumQuantity || !pricing) {
      return { kind: "invalid_quantity" };
    }
    if (pricing.totalPriceCents < LIVEPIX_MINIMUM_BRL_CENTS) {
      return {
        kind: "quantity_below_minimum",
        minimumQuantity,
        minimumTotalCents: product.minimumPriceCents * minimumQuantity,
      };
    }

    const availableStock = await this.repository.countAvailableStock(product.id);
    if (availableStock < input.quantity) {
      return availableStock < 1
        ? { kind: "out_of_stock" }
        : { kind: "insufficient_stock", availableStock };
    }

    const commissionBps = await this.repository.getCommissionBps(guild.whitelistEntryId);
    const order = await this.repository.createAwaitingPaymentOrder({
      interactionId: input.interactionId,
      guildId: guild.id,
      whitelistEntryId: guild.whitelistEntryId,
      product,
      buyerDiscordId: input.buyerDiscordId,
      quantity: input.quantity,
      subtotalPriceCents: pricing.subtotalPriceCents,
      totalPriceCents: pricing.totalPriceCents,
      discountBps: pricing.discountBps,
      discountAmountCents: pricing.discountAmountCents,
      discountReason: pricing.discountReason,
      commissionBps,
    });
    if (order.outOfStock || !order.id) {
      return { kind: "out_of_stock" };
    }

    return {
      kind: order.created ? "created" : "duplicate",
      orderId: order.id,
      productName: product.name,
      quantity: input.quantity,
      unitPriceCents: product.minimumPriceCents,
      subtotalPriceCents: pricing.subtotalPriceCents,
      totalPriceCents: pricing.totalPriceCents,
      discountBps: pricing.discountBps,
      discountAmountCents: pricing.discountAmountCents,
      discountReason: pricing.discountReason,
    };
  }

  async purchaseCart(input: {
    interactionId: string;
    buyerDiscordId: string;
    items: CartItemInput[];
    isServerBooster: boolean;
    guild: DiscordGuildIdentity;
  }): Promise<CartPurchaseResult> {
    if (
      !SNOWFLAKE_PATTERN.test(input.interactionId) ||
      !SNOWFLAKE_PATTERN.test(input.buyerDiscordId) ||
      !isValidGuild(input.guild) ||
      input.items.length < 1 ||
      input.items.length > MAX_CART_ITEMS ||
      input.items.some(
        (item) =>
          !UUID_PATTERN.test(item.productId) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1,
      ) ||
      new Set(input.items.map((item) => item.productId)).size !== input.items.length
    ) {
      return { kind: "invalid_request" };
    }

    const productIds = input.items.map((item) => item.productId);
    const [existing, guild, products, stockByProduct] = await Promise.all([
      this.repository.findPurchaseByInteraction(input.interactionId),
      this.repository.ensureGuild(input.guild),
      this.repository.findPurchasableProducts(productIds),
      this.repository.countAvailableStocks(productIds),
    ]);

    if (!guild.whitelistEntryId) {
      return { kind: "guild_not_authorized" };
    }

    if (existing) {
      const sameItems =
        existing.items.length === input.items.length &&
        existing.items.every(
          (item, index) =>
            item.productId === input.items[index]?.productId &&
            item.quantity === input.items[index]?.quantity,
        );
      if (
        existing.buyerDiscordId !== input.buyerDiscordId ||
        existing.guildId !== guild.id ||
        !sameItems
      ) {
        return { kind: "interaction_conflict" };
      }
      return {
        kind: "duplicate",
        orderId: existing.id,
        items: existing.items,
        subtotalPriceCents: existing.subtotalPriceCents,
        totalPriceCents: existing.salePriceCents,
        discountBps: existing.discountBps,
        discountAmountCents: existing.discountAmountCents,
        discountReason: existing.discountReason,
      };
    }

    if (products.length !== productIds.length) {
      return { kind: "product_unavailable" };
    }
    const productById = new Map(products.map((product) => [product.id, product]));
    const subtotals = input.items.map((item) => {
      const product = productById.get(item.productId);
      const subtotalPriceCents = product
        ? calculateOrderTotalCents(product.minimumPriceCents, item.quantity)
        : null;
      return product && subtotalPriceCents !== null
        ? { item, product, subtotalPriceCents }
        : null;
    });
    if (subtotals.some((item) => item === null)) {
      return { kind: "invalid_quantity" };
    }

    const subtotalPriceCents = subtotals.reduce(
      (sum, item) => sum + (item?.subtotalPriceCents ?? 0),
      0,
    );
    const pricing = applyBoosterDiscount(
      subtotalPriceCents,
      guild.boosterDiscount,
      input.isServerBooster,
    );
    if (!pricing) return { kind: "invalid_quantity" };
    if (pricing.totalPriceCents < LIVEPIX_MINIMUM_BRL_CENTS) {
      return {
        kind: "total_below_minimum",
        minimumTotalCents: LIVEPIX_MINIMUM_BRL_CENTS,
      };
    }

    for (const entry of subtotals) {
      if (!entry) continue;
      const availableStock = stockByProduct.get(entry.product.id) ?? 0;
      if (availableStock < entry.item.quantity) {
        return availableStock < 1
          ? { kind: "out_of_stock" }
          : {
              kind: "insufficient_stock",
              productName: entry.product.name,
              availableStock,
            };
      }
    }

    const purchaseItems = distributePurchaseDiscount(
      subtotals as Array<NonNullable<(typeof subtotals)[number]>>,
      pricing.discountBps,
      pricing.discountAmountCents,
    );
    const commissionBps = await this.repository.getCommissionBps(guild.whitelistEntryId);
    const purchase = await this.repository.createAwaitingPaymentPurchase({
      interactionId: input.interactionId,
      guildId: guild.id,
      whitelistEntryId: guild.whitelistEntryId,
      buyerDiscordId: input.buyerDiscordId,
      items: input.items,
      discountBps: pricing.discountBps,
      discountReason: pricing.discountReason,
      commissionBps,
    });
    if (purchase.outOfStock || !purchase.id) {
      return { kind: "out_of_stock" };
    }

    return {
      kind: purchase.created ? "created" : "duplicate",
      orderId: purchase.id,
      items: purchaseItems,
      subtotalPriceCents: pricing.subtotalPriceCents,
      totalPriceCents: pricing.totalPriceCents,
      discountBps: pricing.discountBps,
      discountAmountCents: pricing.discountAmountCents,
      discountReason: pricing.discountReason,
    };
  }
}

function distributePurchaseDiscount(
  entries: Array<{
    item: CartItemInput;
    product: { id: string; name: string; minimumPriceCents: number };
    subtotalPriceCents: number;
  }>,
  discountBps: number,
  totalDiscountCents: number,
): PurchaseItem[] {
  const discounts = entries.map((entry) =>
    Number((BigInt(entry.subtotalPriceCents) * BigInt(discountBps)) / 10_000n),
  );
  const allocated = discounts.reduce((sum, discount) => sum + discount, 0);
  const remainderIndex = entries.reduce(
    (largestIndex, entry, index) =>
      entry.subtotalPriceCents > entries[largestIndex]!.subtotalPriceCents
        ? index
        : largestIndex,
    0,
  );
  discounts[remainderIndex] =
    (discounts[remainderIndex] ?? 0) + totalDiscountCents - allocated;

  return entries.map((entry, index) => {
    const discountAmountCents = discounts[index] ?? 0;
    return {
      productId: entry.product.id,
      productName: entry.product.name,
      quantity: entry.item.quantity,
      unitPriceCents: entry.product.minimumPriceCents,
      subtotalPriceCents: entry.subtotalPriceCents,
      totalPriceCents: entry.subtotalPriceCents - discountAmountCents,
      discountAmountCents,
    };
  });
}

function isValidGuild(identity: DiscordGuildIdentity) {
  return (
    SNOWFLAKE_PATTERN.test(identity.discordGuildId) &&
    SNOWFLAKE_PATTERN.test(identity.ownerDiscordId) &&
    identity.name.trim().length > 0
  );
}
