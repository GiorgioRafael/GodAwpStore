import type {
  BotCatalogGame,
  BotCommerceRepository,
  DiscordGuildIdentity,
  PurchaseResult,
} from "./types";

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

    const existing = await this.repository.findOrderByInteraction(input.interactionId);
    if (existing) {
      if (existing.buyerDiscordId !== input.buyerDiscordId || existing.productId !== input.productId) {
        return { kind: "interaction_conflict" };
      }

      const product = await this.repository.findPurchasableProduct(input.productId);
      return {
        kind: "duplicate",
        orderId: existing.id,
        productName: product?.name ?? "Produto",
        priceCents: product?.minimumPriceCents ?? 0,
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

    const availableStock = await this.repository.countAvailableStock(product.id);
    if (availableStock < 1) {
      return { kind: "out_of_stock" };
    }

    const commissionBps = await this.repository.getCommissionBps(guild.whitelistEntryId);
    const order = await this.repository.createAwaitingPaymentOrder({
      interactionId: input.interactionId,
      guildId: guild.id,
      whitelistEntryId: guild.whitelistEntryId,
      product,
      buyerDiscordId: input.buyerDiscordId,
      commissionBps,
    });
    if (order.outOfStock || !order.id) {
      return { kind: "out_of_stock" };
    }

    return {
      kind: order.created ? "created" : "duplicate",
      orderId: order.id,
      productName: product.name,
      priceCents: product.minimumPriceCents,
    };
  }
}

function isValidGuild(identity: DiscordGuildIdentity) {
  return (
    SNOWFLAKE_PATTERN.test(identity.discordGuildId) &&
    SNOWFLAKE_PATTERN.test(identity.ownerDiscordId) &&
    identity.name.trim().length > 0
  );
}
