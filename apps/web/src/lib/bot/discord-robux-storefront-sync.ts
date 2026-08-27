import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadBotMessageCustomization } from "./message-customization-server";
import {
  publishDiscordRobuxStorefront,
  readRobuxStorefrontConfiguration,
  withRobuxStorefrontConfiguration,
} from "./discord-robux-storefront";

export type DiscordRobuxStorefrontSyncResult = {
  published: number;
  failed: number;
};

/**
 * The Robux post is not a catalog storefront, so the regular catalog sync
 * never touched it. Keep this small dedicated pass so changing a banner in
 * the panel updates the already-published Discord message in place.
 */
export async function synchronizePublishedDiscordRobuxStorefronts(): Promise<DiscordRobuxStorefrontSyncResult> {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");

  const [{ data: guilds, error }, customization] = await Promise.all([
    client
      .from("guilds")
      .select("id,discord_guild_id,configuration")
      .eq("status", "active")
      .is("archived_at", null),
    loadBotMessageCustomization(client),
  ]);
  if (error) throw new Error("Não foi possível consultar a mensagem de Robux.");

  let published = 0;
  let failed = 0;
  for (const guild of guilds ?? []) {
    const previous = readRobuxStorefrontConfiguration(guild.configuration);
    if (!previous) continue;
    try {
      const next = await publishDiscordRobuxStorefront({
        guildId: guild.discord_guild_id,
        channel: { id: previous.channel_id, name: previous.channel_name },
        previous,
        customization,
      });
      const { error: updateError } = await client
        .from("guilds")
        .update({ configuration: withRobuxStorefrontConfiguration(guild.configuration, next) })
        .eq("id", guild.id);
      if (updateError) throw updateError;
      published += 1;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "erro desconhecido";
      console.error(`[discord-robux-storefront:sync:${guild.id}] ${message}`);
      failed += 1;
    }
  }

  return { published, failed };
}
