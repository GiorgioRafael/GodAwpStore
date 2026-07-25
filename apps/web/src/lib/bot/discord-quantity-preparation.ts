import "server-only";

import { BotCommerceService } from "./commerce-service";
import { fetchDiscordGuildIdentity, readDiscordInteraction } from "./discord-context";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import type { CartQuantityPreparationResult } from "./types";

export async function prepareDiscordCartQuantities(
  raw: unknown,
  productIds: string[],
): Promise<CartQuantityPreparationResult> {
  const context = readDiscordInteraction(raw, "");
  if (!context.guildId || !context.userId) {
    return { kind: "invalid_request" };
  }

  try {
    const guild = await fetchDiscordGuildIdentity(context.guildId);
    return await new BotCommerceService(
      new SupabaseBotCommerceRepository(),
    ).prepareCartQuantities({
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
