import "server-only";

import { BotCommerceService } from "./commerce-service";
import { fetchDiscordGuildIdentity, readDiscordInteraction } from "./discord-context";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import { scopeCatalogToDiscordChannel } from "./discord-storefront-scope";
import type { CartQuantityPreparationResult } from "./types";

export async function prepareDiscordCartQuantities(
  raw: unknown,
  productIds: string[],
): Promise<CartQuantityPreparationResult> {
  const context = readDiscordInteraction(raw, "");
  if (!context.guildId || !context.channelId || !context.userId) {
    return { kind: "invalid_request" };
  }

  try {
    const guild = await fetchDiscordGuildIdentity(context.guildId);
    const repository = new SupabaseBotCommerceRepository();
    const scopedCatalog = await scopeCatalogToDiscordChannel(
      await repository.listCatalog(),
      context.guildId,
      context.channelId,
    );
    const allowedProductIds = new Set(
      scopedCatalog.flatMap((store) =>
        store.substores.flatMap((substore) => substore.products.map((product) => product.id)),
      ),
    );
    if (!productIds.length || productIds.some((productId) => !allowedProductIds.has(productId))) {
      return { kind: "product_unavailable" };
    }
    return await new BotCommerceService(repository).prepareCartQuantities({
      buyerDiscordId: context.userId,
      productIds,
      isServerBooster: context.isServerBooster,
      guild,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-quantity:prepare] ${message}`);
    return { kind: "invalid_request" };
  }
}
