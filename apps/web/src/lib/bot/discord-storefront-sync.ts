import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { BotCommerceService } from "./commerce-service";
import {
  publishDiscordStorefront,
  readStorefrontConfiguration,
  withStorefrontConfiguration,
} from "./discord-storefront";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import { loadBotMessageCustomization } from "./message-customization-server";

export type DiscordStorefrontSyncResult = {
  published: number;
  failed: number;
};

/**
 * Rebuilds every storefront that an admin has already published. Existing
 * Discord messages are patched in place, so stock changes never duplicate the
 * storefront or require a manual republish.
 */
export async function synchronizePublishedDiscordStorefronts(): Promise<DiscordStorefrontSyncResult> {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");

  const { data: guilds, error } = await client
    .from("guilds")
    .select("id,configuration")
    .eq("status", "active")
    .is("archived_at", null);
  if (error) throw new Error("Não foi possível consultar as vitrines publicadas.");

  const publishedGuilds = (guilds ?? []).flatMap((guild) => {
    const storefront = readStorefrontConfiguration(guild.configuration);
    return storefront ? [{ guild, storefront }] : [];
  });
  if (publishedGuilds.length === 0) return { published: 0, failed: 0 };

  const [catalog, customization] = await Promise.all([
    new BotCommerceService(new SupabaseBotCommerceRepository(client)).listCatalog(),
    loadBotMessageCustomization(client),
  ]);
  const results = await Promise.all(
    publishedGuilds.map(async ({ guild, storefront }) => {
      try {
        const publication = await publishDiscordStorefront({
          channel: { id: storefront.channel_id, name: storefront.channel_name },
          catalog,
          customization,
          previous: storefront,
        });
        const { data: updated, error: updateError } = await client
          .from("guilds")
          .update({
            configuration: withStorefrontConfiguration(
              guild.configuration,
              publication.configuration,
            ),
          })
          .eq("id", guild.id)
          .select("id")
          .maybeSingle();
        if (updateError || !updated) throw new Error("Configuração da vitrine não foi salva.");
        return true;
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : "erro desconhecido";
        console.error(`[discord-storefront:sync:${guild.id}] ${message}`);
        return false;
      }
    }),
  );

  const published = results.filter(Boolean).length;
  return { published, failed: results.length - published };
}
