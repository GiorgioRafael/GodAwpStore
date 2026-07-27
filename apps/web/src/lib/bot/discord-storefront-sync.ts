import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { BotCommerceService } from "./commerce-service";
import {
  publishDiscordStorefront,
  readStorefrontConfigurations,
  withStorefrontConfigurations,
} from "./discord-storefront";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import { loadBotMessageCustomization } from "./message-customization-server";
import { synchronizeDiscordProductEmojis } from "./discord-product-emojis";

export type DiscordStorefrontSyncResult = {
  published: number;
  failed: number;
  productEmojiFailures: number;
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
    const storefronts = readStorefrontConfigurations(guild.configuration);
    return storefronts.length > 0 ? [{ guild, storefronts }] : [];
  });
  if (publishedGuilds.length === 0) {
    return { published: 0, failed: 0, productEmojiFailures: 0 };
  }

  let productEmojiFailures = 0;
  try {
    productEmojiFailures = (await synchronizeDiscordProductEmojis(client)).failed;
  } catch (emojiError) {
    const message = emojiError instanceof Error ? emojiError.message : "erro desconhecido";
    console.error(`[discord-product-emojis:sync] ${message}`);
    productEmojiFailures = 1;
  }

  const [catalog, customization] = await Promise.all([
    new BotCommerceService(new SupabaseBotCommerceRepository(client)).listCatalog(),
    loadBotMessageCustomization(client),
  ]);
  const results = await Promise.all(
    publishedGuilds.map(async ({ guild, storefronts }) => {
      const publicationResults = await Promise.all(
        storefronts.map(async (storefront) => {
          try {
            const game = storefront.game_id
              ? catalog.find((item) => item.id === storefront.game_id) ?? null
              : null;
            const publication = await publishDiscordStorefront({
              channel: { id: storefront.channel_id, name: storefront.channel_name },
              catalog: storefront.game_id ? (game ? [game] : []) : catalog,
              customization,
              previous: storefront,
              game:
                game ??
                (storefront.game_id
                  ? { id: storefront.game_id, name: storefront.game_name }
                  : null),
            });
            return { ok: true as const, configuration: publication.configuration };
          } catch (syncError) {
            const message =
              syncError instanceof Error ? syncError.message : "erro desconhecido";
            console.error(
              `[discord-storefront:sync:${guild.id}:${storefront.game_id ?? "legacy"}] ${message}`,
            );
            return { ok: false as const, configuration: storefront };
          }
        }),
      );
      const published = publicationResults.filter((result) => result.ok).length;
      if (published === 0) {
        return { published: 0, failed: publicationResults.length };
      }

      try {
        const { data: updated, error: updateError } = await client
          .from("guilds")
          .update({
            configuration: withStorefrontConfigurations(
              guild.configuration,
              publicationResults.map((result) => result.configuration),
            ),
          })
          .eq("id", guild.id)
          .select("id")
          .maybeSingle();
        if (updateError || !updated) throw new Error("Configuração da vitrine não foi salva.");
        return {
          published,
          failed: publicationResults.length - published,
        };
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : "erro desconhecido";
        console.error(`[discord-storefront:sync:${guild.id}] ${message}`);
        return { published: 0, failed: publicationResults.length };
      }
    }),
  );

  return {
    published: results.reduce((sum, result) => sum + result.published, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
    productEmojiFailures,
  };
}
