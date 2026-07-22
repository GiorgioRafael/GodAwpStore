import type { BoosterDiscountConfiguration } from "./booster-discount";
import type {
  CustomerDiscountReason,
  CustomerRankProgress,
} from "./customer-rank";
import type { DiscordProductEmoji } from "./discord-product-emoji-shared";

export const MAXIMUM_CART_ITEMS = 3;

export type BotCatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  imageUrl?: string | null;
  discordEmoji?: DiscordProductEmoji | null;
  priceCents: number;
  availableStock: number;
  sortOrder: number;
};

export type BotCatalogSubstore = {
  id: string;
  name: string;
  title: string;
  description: string;
  colorHex: string;
  imageUrl: string | null;
  products: BotCatalogProduct[];
};

export type BotCatalogGame = {
  id: string;
  name: string;
  substores: BotCatalogSubstore[];
};

export type DiscordGuildIdentity = {
  discordGuildId: string;
  ownerDiscordId: string;
  name: string;
};

export type RegisteredGuild = {
  id: string;
  whitelistEntryId: string | null;
  boosterDiscount: BoosterDiscountConfiguration;
};

export type PurchasableProduct = {
  id: string;
  name: string;
  minimumPriceCents: number;
};

export type ExistingOrder = {
  id: string;
  buyerDiscordId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  subtotalPriceCents: number;
  salePriceCents: number;
  discountBps: number;
  discountAmountCents: number;
  discountReason: CustomerDiscountReason;
  status: string;
};

export type OrderCreation = {
  id: string | null;
  status: "awaiting_payment";
  created: boolean;
  outOfStock: boolean;
};

export type CartItemInput = {
  productId: string;
  quantity: number;
};

export type PurchaseItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  subtotalPriceCents: number;
  totalPriceCents: number;
  discountAmountCents: number;
};

export type ExistingPurchase = {
  id: string;
  buyerDiscordId: string;
  guildId: string;
  items: PurchaseItem[];
  subtotalPriceCents: number;
  salePriceCents: number;
  discountBps: number;
  discountAmountCents: number;
  discountReason: CustomerDiscountReason;
  status: string;
};

export type PurchaseCreation = {
  id: string | null;
  status: "awaiting_payment";
  created: boolean;
  outOfStock: boolean;
};

export interface BotCommerceRepository {
  listCatalog(): Promise<BotCatalogGame[]>;
  findOrderByInteraction(interactionId: string): Promise<ExistingOrder | null>;
  ensureGuild(identity: DiscordGuildIdentity): Promise<RegisteredGuild>;
  findPurchasableProduct(productId: string): Promise<PurchasableProduct | null>;
  countAvailableStock(productId: string): Promise<number>;
  getCustomerRankProgress(
    guildId: string,
    buyerDiscordId: string,
  ): Promise<CustomerRankProgress>;
  getCommissionBps(whitelistEntryId: string | null): Promise<number>;
  createAwaitingPaymentOrder(input: {
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
    discountReason: CustomerDiscountReason;
    commissionBps: number;
  }): Promise<OrderCreation>;
  findPurchaseByInteraction(interactionId: string): Promise<ExistingPurchase | null>;
  findPurchasableProducts(productIds: string[]): Promise<PurchasableProduct[]>;
  countAvailableStocks(productIds: string[]): Promise<Map<string, number>>;
  createAwaitingPaymentPurchase(input: {
    interactionId: string;
    guildId: string;
    whitelistEntryId: string | null;
    buyerDiscordId: string;
    items: CartItemInput[];
    discountBps: number;
    discountReason: CustomerDiscountReason;
    commissionBps: number;
  }): Promise<PurchaseCreation>;
}

export type PurchaseResult =
  | {
      kind: "created" | "duplicate";
      orderId: string;
      productName: string;
      quantity: number;
      unitPriceCents: number;
      subtotalPriceCents: number;
      totalPriceCents: number;
      discountBps: number;
      discountAmountCents: number;
      discountReason: CustomerDiscountReason;
    }
  | {
      kind: "quantity_below_minimum";
      minimumQuantity: number;
      minimumTotalCents: number;
    }
  | { kind: "insufficient_stock"; availableStock: number }
  | {
      kind:
        | "invalid_request"
        | "invalid_quantity"
        | "guild_not_authorized"
        | "product_unavailable"
        | "out_of_stock"
        | "interaction_conflict";
    };

export type CartPurchaseResult =
  | {
      kind: "created" | "duplicate";
      orderId: string;
      items: PurchaseItem[];
      subtotalPriceCents: number;
      totalPriceCents: number;
      discountBps: number;
      discountAmountCents: number;
      discountReason: CustomerDiscountReason;
    }
  | { kind: "total_below_minimum"; minimumTotalCents: number }
  | {
      kind: "insufficient_stock";
      productName: string;
      availableStock: number;
    }
  | {
      kind:
        | "invalid_request"
        | "invalid_quantity"
        | "guild_not_authorized"
        | "product_unavailable"
        | "out_of_stock"
        | "interaction_conflict";
    };
