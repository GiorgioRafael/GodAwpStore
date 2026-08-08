import "server-only";

import { STORE_CATALOG_LABEL, STORE_NAME, STORE_SLUG } from "@/lib/brand";
import { rouletteBrandingFor } from "@/lib/roulette/branding";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type RoulettePromotionSettings = {
  title: string;
  description: string;
  buttonLabel: string;
  channelId: string | null;
  messageId: string | null;
};

export function defaultRoulettePromotion(
  storeSlug = STORE_SLUG,
  storeName = STORE_NAME,
  catalogLabel = STORE_CATALOG_LABEL,
): RoulettePromotionSettings {
  const branding = rouletteBrandingFor(storeSlug, storeName, catalogLabel);
  return {
    ...branding.promotion,
    channelId: null,
    messageId: null,
  };
}

export const DEFAULT_ROULETTE_PROMOTION = defaultRoulettePromotion();

export async function getRoulettePromotionSettings() {
  const client = await createServerSupabaseClient();
  if (!client) {
    return {
      ok: false as const,
      settings: DEFAULT_ROULETTE_PROMOTION,
      reason: "Supabase não está configurado.",
    };
  }

  const { data, error } = await client
    .from("platform_settings")
    .select(
      "roulette_promotion_title,roulette_promotion_description,roulette_promotion_button_label,roulette_promotion_channel_id,roulette_promotion_message_id",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    if (error) {
      console.error(
        `[admin:roleta:divulgacao] ${error.code ?? "sem código"} ${error.message}`,
      );
    }
    return {
      ok: false as const,
      settings: DEFAULT_ROULETTE_PROMOTION,
      reason: error?.message ?? "Configurações globais não encontradas.",
    };
  }

  return {
    ok: true as const,
    settings: normalizeStoredPromotion({
      title: data.roulette_promotion_title,
      description: data.roulette_promotion_description,
      buttonLabel: data.roulette_promotion_button_label,
      channelId: data.roulette_promotion_channel_id,
      messageId: data.roulette_promotion_message_id,
    }),
  };
}

/**
 * THStore was enabled while both databases still carried the GWStore defaults.
 * Only replace that exact legacy triplet; anything an owner edited remains
 * untouched. The channel/message link is preserved so the next save edits the
 * publication instead of creating a duplicate.
 */
export function normalizeStoredPromotion(
  settings: RoulettePromotionSettings,
  storeSlug = STORE_SLUG,
  storeName = STORE_NAME,
  catalogLabel = STORE_CATALOG_LABEL,
): RoulettePromotionSettings {
  if (storeSlug !== "thstore") return settings;

  const gwDefaults = defaultRoulettePromotion(
    "gwstore",
    "GWStore",
    "Grow a Garden 2",
  );
  const isLegacyGwCopy =
    settings.title === gwDefaults.title &&
    settings.description === gwDefaults.description &&
    settings.buttonLabel === gwDefaults.buttonLabel;

  return isLegacyGwCopy
    ? {
        ...settings,
        ...rouletteBrandingFor(storeSlug, storeName, catalogLabel).promotion,
      }
    : settings;
}
