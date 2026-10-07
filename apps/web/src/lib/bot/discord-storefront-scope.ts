import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readDiscordIntegratedStorefrontConfiguration, readStorefrontConfigurations } from "./discord-storefront";
import type { BotCatalogGame } from "./types";
import { GW_UP_STORE_ID } from "./gw-up-catalog";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export function filterCatalogForDiscordChannel(
  catalog: BotCatalogGame[],
  configuration: Parameters<typeof readStorefrontConfigurations>[0],
  channelId: string,
) {
  if (configuration && typeof configuration === "object" && !Array.isArray(configuration)) {
    const up = configuration.up_services;
    if (up && typeof up === "object" && !Array.isArray(up) && up.channel_id === channelId && up.catalog_store_id === GW_UP_STORE_ID) {
      return catalog.filter(store => store.catalogStoreId === GW_UP_STORE_ID);
    }
  }
  const storefront = readStorefrontConfigurations(configuration).find(
    (item) => item.channel_id === channelId,
  );
  const integrated = readDiscordIntegratedStorefrontConfiguration(configuration);
  if (!storefront && integrated?.channel_id !== channelId && isRetiredChannel(configuration, channelId)) {
    return [];
  }
  if (!storefront?.game_id) return catalog;
  const store = storefront.catalog_store_id
    ? catalog.find((item) => item.catalogStoreId === storefront.catalog_store_id)
    : catalog.find((item) => item.id === storefront.game_id && item.isDefaultStore);
  return store ? [store] : [];
}

function isRetiredChannel(configuration: Parameters<typeof readStorefrontConfigurations>[0], channelId: string) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return false;
  const retired = configuration.retired_storefronts;
  return Array.isArray(retired) && retired.some((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) && entry.channel_id === channelId,
  );
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
