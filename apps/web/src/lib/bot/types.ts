export type BotCatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  availableStock: number;
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
  salePriceCents: number;
  status: string;
};

export type OrderCreation = {
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
  getCommissionBps(whitelistEntryId: string | null): Promise<number>;
  createAwaitingPaymentOrder(input: {
    interactionId: string;
    guildId: string;
    whitelistEntryId: string | null;
    product: PurchasableProduct;
    buyerDiscordId: string;
    quantity: number;
    totalPriceCents: number;
    commissionBps: number;
  }): Promise<OrderCreation>;
}

export type PurchaseResult =
  | {
      kind: "created" | "duplicate";
      orderId: string;
      productName: string;
      quantity: number;
      unitPriceCents: number;
      totalPriceCents: number;
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
