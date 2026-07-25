import type {
  BotCatalogGame,
  BotCommerceRepository,
  CartItemInput,
  CartPurchaseResult,
  DiscordGuildIdentity,
  PurchaseItem,
  PurchaseResult,
  UpsellPreparationResult,
} from "./types";
import {
  calculateOrderTotalCents,
  LIVEPIX_MINIMUM_BRL_CENTS,
} from "@/lib/livepix/limits";
import {
  applyBestCustomerDiscount,
  minimumLivePixQuantityWithCustomerDiscount,
} from "./customer-rank";
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

    const rank = await this.repository.getCustomerRankProgress(
      guild.id,
      input.buyerDiscordId,
    );
    const minimumPurchase = minimumLivePixQuantityWithCustomerDiscount({
      unitPriceCents: product.minimumPriceCents,
      boosterConfiguration: guild.boosterDiscount,
      isServerBooster: input.isServerBooster,
      rank,
    });
    const subtotalPriceCents = calculateOrderTotalCents(product.minimumPriceCents, input.quantity);
    const pricing = subtotalPriceCents === null
      ? null
      : applyBestCustomerDiscount(
          subtotalPriceCents,
          guild.boosterDiscount,
          input.isServerBooster,
          rank,
        );
    if (!minimumPurchase || !pricing) {
      return { kind: "invalid_quantity" };
    }
    if (pricing.totalPriceCents < LIVEPIX_MINIMUM_BRL_CENTS) {
      return {
        kind: "quantity_below_minimum",
        minimumQuantity: minimumPurchase.quantity,
        minimumTotalCents: minimumPurchase.totalPriceCents,
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
        upsellProductId: existing.upsellProductId,
        upsellDiscountBps: existing.upsellDiscountBps,
        upsellDiscountAmountCents: existing.upsellDiscountAmountCents,
        leadRecoveryDiscountBps: existing.leadRecoveryDiscountBps,
        leadRecoveryDiscountAmountCents: existing.leadRecoveryDiscountAmountCents,
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
    const rank = await this.repository.getCustomerRankProgress(
      guild.id,
      input.buyerDiscordId,
    );
    const pricing = applyBestCustomerDiscount(
      subtotalPriceCents,
      guild.boosterDiscount,
      input.isServerBooster,
      rank,
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
      upsellProductId: null,
      upsellDiscountBps: 0,
      upsellDiscountAmountCents: 0,
      leadRecoveryDiscountBps: 0,
      leadRecoveryDiscountAmountCents: 0,
    };
  }

  async prepareUpsell(input: {
    interactionId: string;
    buyerDiscordId: string;
    items: CartItemInput[];
    isServerBooster: boolean;
    guild: DiscordGuildIdentity;
  }): Promise<UpsellPreparationResult> {
    if (!isValidCartInput(input)) {
      return { kind: "not_offered" };
    }

    const productIds = input.items.map((item) => item.productId);
    const [existing, guild, products] = await Promise.all([
      this.repository.findPurchaseByInteraction(input.interactionId),
      this.repository.ensureGuild(input.guild),
      this.repository.findPurchasableProducts(productIds),
    ]);
    if (existing || !guild.whitelistEntryId || products.length !== productIds.length) {
      return { kind: "not_offered" };
    }

    const productById = new Map(products.map((product) => [product.id, product]));
    let subtotalPriceCents = 0;
    for (const item of input.items) {
      const product = productById.get(item.productId);
      const itemSubtotal = product
        ? calculateOrderTotalCents(product.minimumPriceCents, item.quantity)
        : null;
      if (itemSubtotal === null) return { kind: "not_offered" };
      subtotalPriceCents += itemSubtotal;
      if (!Number.isSafeInteger(subtotalPriceCents)) {
        return { kind: "not_offered" };
      }
    }

    const rank = await this.repository.getCustomerRankProgress(
      guild.id,
      input.buyerDiscordId,
    );
    const pricing = applyBestCustomerDiscount(
      subtotalPriceCents,
      guild.boosterDiscount,
      input.isServerBooster,
      rank,
    );
    if (!pricing || pricing.totalPriceCents < LIVEPIX_MINIMUM_BRL_CENTS) {
      return { kind: "not_offered" };
    }

    const commissionBps = await this.repository.getCommissionBps(
      guild.whitelistEntryId,
    );
    const result = await this.repository.createUpsellOffer({
      interactionId: input.interactionId,
      guildId: guild.id,
      whitelistEntryId: guild.whitelistEntryId,
      buyerDiscordId: input.buyerDiscordId,
      items: input.items,
      baseDiscountBps: pricing.discountBps,
      baseDiscountReason: pricing.discountReason,
      commissionBps,
    });

    return result.offer && isValidUpsellOffer(result.offer)
      ? { kind: "offered", offer: result.offer }
      : { kind: "not_offered" };
  }

  async finalizeUpsell(input: {
    offerId: string;
    interactionId: string;
    buyerDiscordId: string;
    discordGuildId: string;
    accepted: boolean;
  }): Promise<CartPurchaseResult> {
    if (
      !UUID_PATTERN.test(input.offerId) ||
      !SNOWFLAKE_PATTERN.test(input.interactionId) ||
      !SNOWFLAKE_PATTERN.test(input.buyerDiscordId) ||
      !SNOWFLAKE_PATTERN.test(input.discordGuildId)
    ) {
      return { kind: "invalid_request" };
    }

    const finalization = await this.repository.finalizeUpsellOffer({
      offerId: input.offerId,
      discordGuildId: input.discordGuildId,
      buyerDiscordId: input.buyerDiscordId,
      accepted: input.accepted,
      decisionInteractionId: input.interactionId,
    });
    if (finalization.decisionConflict) {
      return { kind: "interaction_conflict" };
    }
    if (finalization.expired) {
      return { kind: "offer_expired" };
    }
    if (finalization.outOfStock || !finalization.orderId) {
      return { kind: "out_of_stock" };
    }

    const purchase = await this.repository.findPurchaseById(finalization.orderId);
    if (!purchase) return { kind: "invalid_request" };

    return {
      kind: finalization.created ? "created" : "duplicate",
      orderId: purchase.id,
      items: purchase.items,
      subtotalPriceCents: purchase.subtotalPriceCents,
      totalPriceCents: purchase.salePriceCents,
      discountBps: purchase.discountBps,
      discountAmountCents: purchase.discountAmountCents,
      discountReason: purchase.discountReason,
      upsellProductId: purchase.upsellProductId,
      upsellDiscountBps: purchase.upsellDiscountBps,
      upsellDiscountAmountCents: purchase.upsellDiscountAmountCents,
      leadRecoveryDiscountBps: purchase.leadRecoveryDiscountBps,
      leadRecoveryDiscountAmountCents: purchase.leadRecoveryDiscountAmountCents,
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

function isValidCartInput(input: {
  interactionId: string;
  buyerDiscordId: string;
  items: CartItemInput[];
  guild: DiscordGuildIdentity;
}) {
  return (
    SNOWFLAKE_PATTERN.test(input.interactionId) &&
    SNOWFLAKE_PATTERN.test(input.buyerDiscordId) &&
    isValidGuild(input.guild) &&
    input.items.length >= 1 &&
    input.items.length <= MAX_CART_ITEMS &&
    input.items.every(
      (item) =>
        UUID_PATTERN.test(item.productId) &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1,
    ) &&
    new Set(input.items.map((item) => item.productId)).size === input.items.length
  );
}

function isValidUpsellOffer(offer: {
  id: string;
  productId: string;
  productName: string;
  unitPriceCents: number;
  discountedUnitPriceCents: number;
  discountBps: number;
  expiresAt: string;
}) {
  if (
    !Number.isSafeInteger(offer.unitPriceCents) ||
    offer.unitPriceCents <= 0 ||
    !Number.isInteger(offer.discountBps) ||
    offer.discountBps < 1 ||
    offer.discountBps > 500
  ) {
    return false;
  }
  const expectedDiscount = Number(
    (BigInt(offer.unitPriceCents) * BigInt(offer.discountBps)) / 10_000n,
  );
  return (
    UUID_PATTERN.test(offer.id) &&
    UUID_PATTERN.test(offer.productId) &&
    offer.productName.trim().length > 0 &&
    Number.isSafeInteger(offer.discountedUnitPriceCents) &&
    offer.discountedUnitPriceCents > 0 &&
    offer.discountedUnitPriceCents === offer.unitPriceCents - expectedDiscount &&
    expectedDiscount > 0 &&
    Number.isFinite(Date.parse(offer.expiresAt))
  );
}
