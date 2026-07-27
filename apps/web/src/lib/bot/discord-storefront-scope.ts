import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readStorefrontConfigurations } from "./discord-storefront";
import type { BotCatalogGame } from "./types";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export function filterCatalogForDiscordChannel(
  catalog: BotCatalogGame[],
  configuration: Parameters<typeof readStorefrontConfigurations>[0],
  channelId: string,
) {
  const storefront = readStorefrontConfigurations(configuration).find(
    (item) => item.channel_id === channelId,
  );
  if (!storefront?.game_id) return catalog;
  const game = catalog.find((item) => item.id === storefront.game_id);
  return game ? [game] : [];
}

export async function scopeCatalogToDiscordChannel(
  catalog: BotCatalogGame[],
  discordGuildId: string | null,
  channelId: string | null,
) {
  if (
    !discordGuildId ||
    !channelId ||
    !SNOWFLAKE_PATTERN.test(discordGuildId) ||
    !SNOWFLAKE_PATTERN.test(channelId)
  ) {
    return catalog;
  }

  const client = createAdminSupabaseClient();
  if (!client) return catalog;
  const { data, error } = await client
    .from("guilds")
    .select("configuration")
    .eq("discord_guild_id", discordGuildId)
    .eq("status", "active")
    .is("archived_at", null)
    .maybeSingle();
  if (error || !data) return catalog;
  return filterCatalogForDiscordChannel(catalog, data.configuration, channelId);
}
