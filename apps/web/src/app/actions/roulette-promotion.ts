"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import {
  ROULETTE_AVAILABLE,
  ROULETTE_UNAVAILABLE_MESSAGE,
} from "@/lib/roulette/availability";
import { getSiteUrl } from "@/lib/env";
import { normalizeBotMessageImageUrl } from "@/lib/bot/message-customization";
import { publishRoulettePromotion } from "@/lib/roulette/promotion";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const COPY_LIMITS = {
  title: 120,
  description: 1_000,
  buttonLabel: 80,
} as const;

const BANNER_LIMIT = 2_048;

export async function saveRoulettePromotionAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!ROULETTE_AVAILABLE) {
    return { ok: false, message: ROULETTE_UNAVAILABLE_MESSAGE };
  }

  const title = text(formData, "title");
  const description = text(formData, "description");
  const buttonLabel = text(formData, "buttonLabel");
  const bannerUrl = text(formData, "bannerUrl");
  const fieldErrors: Record<string, string[]> = {};
  validateText(fieldErrors, "title", title, COPY_LIMITS.title, "Informe o título.");
  validateText(
    fieldErrors,
    "description",
    description,
    COPY_LIMITS.description,
    "Informe o texto da divulgação.",
  );
  if (!normalizeBotMessageImageUrl(bannerUrl) || bannerUrl.length > BANNER_LIMIT) {
    fieldErrors.bannerUrl = ["Envie ou informe uma imagem HTTPS válida de até 2.048 caracteres."];
  }
  validateText(
    fieldErrors,
    "buttonLabel",
    buttonLabel,
    COPY_LIMITS.buttonLabel,
    "Informe o texto do botão.",
  );
  if (Object.keys(fieldErrors).length) {
    return { ok: false, message: "Revise a mensagem da roleta.", fieldErrors };
  }

  try {
    const identity = await requireAdmin();
    const client = await createServerSupabaseClient();
    const adminClient = createAdminSupabaseClient();
    if (!client || !adminClient) throw new Error("Supabase não configurado.");

    const [settingsResult, guildResult] = await Promise.all([
      client
        .from("platform_settings")
        .select("roulette_promotion_channel_id,roulette_promotion_message_id")
        .eq("id", 1)
        .maybeSingle(),
      adminClient
        .from("guilds")
        .select("discord_guild_id")
        .eq("status", "active")
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (settingsResult.error || !settingsResult.data) {
      throw new Error(settingsResult.error?.message ?? "Configurações globais não encontradas.");
    }
    if (guildResult.error || !guildResult.data) {
      throw new Error(guildResult.error?.message ?? "Servidor Discord ativo não encontrado.");
    }

    const publication = await publishRoulettePromotion(
      {
        guildId: guildResult.data.discord_guild_id,
        channelId: settingsResult.data.roulette_promotion_channel_id,
        messageId: settingsResult.data.roulette_promotion_message_id,
        title,
        description,
        buttonLabel,
        bannerUrl: normalizeBotMessageImageUrl(bannerUrl),
      },
      { siteUrl: getSiteUrl() },
    );

    const { data, error } = await client
      .from("platform_settings")
      .update({
        roulette_promotion_title: title,
        roulette_promotion_description: description,
        roulette_promotion_button_label: buttonLabel,
        roulette_promotion_banner_url: normalizeBotMessageImageUrl(bannerUrl),
        roulette_promotion_channel_id: publication.channelId,
        roulette_promotion_message_id: publication.messageId,
        updated_by: identity.authUserId,
      })
      .eq("id", 1)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Configurações globais não encontradas.");

    revalidatePath("/metricas-roleta");
    return {
      ok: true,
      message: "Divulgação salva e mensagem atualizada no canal da roleta.",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:roleta:divulgacao] ${detail}`);
    return {
      ok: false,
      message:
        "Não foi possível atualizar a divulgação. Confira se o bot ainda acessa o canal e tente novamente.",
    };
  }
}

function validateText(
  errors: Record<string, string[]>,
  name: string,
  value: string,
  maximum: number,
  emptyMessage: string,
) {
  if (!value) errors[name] = [emptyMessage];
  else if (value.length > maximum) {
    errors[name] = [`Use no máximo ${maximum} caracteres.`];
  }
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
