import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type RoulettePromotionSettings = {
  title: string;
  description: string;
  buttonLabel: string;
  channelId: string | null;
  messageId: string | null;
};

export const DEFAULT_ROULETTE_PROMOTION: RoulettePromotionSettings = {
  title: "A roleta da GWStore chegou",
  description:
    "Agora a GWStore tem uma roleta para você conseguir seus itens dentro do Grow a Garden 2. Gire, descubra seu prêmio e acompanhe tudo pelo site.",
  buttonLabel: "Abrir a roleta",
  channelId: null,
  messageId: null,
};

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
    settings: {
      title: data.roulette_promotion_title,
      description: data.roulette_promotion_description,
      buttonLabel: data.roulette_promotion_button_label,
      channelId: data.roulette_promotion_channel_id,
      messageId: data.roulette_promotion_message_id,
    } satisfies RoulettePromotionSettings,
  };
}
