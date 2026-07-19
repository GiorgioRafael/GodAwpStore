import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  normalizeBotMessageCustomization,
  type BotMessageCustomization,
} from "./message-customization";
import {
  normalizeTicketNotificationDiscordUserIds,
} from "./ticket-notifications";
import {
  normalizeTicketCloseAdminDiscordUserIds,
} from "./ticket-close-admins";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type BotRuntimeSettings = {
  customization: BotMessageCustomization;
  ticketNotificationDiscordUserIds: string[];
  ticketCloseAdminDiscordUserIds: string[];
};

export async function loadBotRuntimeSettings(
  client: AdminClient | null = createAdminSupabaseClient(),
): Promise<BotRuntimeSettings> {
  try {
    return await loadBotRuntimeSettingsStrict(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[bot-runtime-settings] ${message}`);
    return failClosedRuntimeSettings();
  }
}

export async function loadBotRuntimeSettingsStrict(
  client: AdminClient | null = createAdminSupabaseClient(),
): Promise<BotRuntimeSettings> {
  if (!client) throw new Error("Supabase server-only não configurado.");

  const { data, error } = await client
    .from("platform_settings")
    .select(
      "bot_message_config,ticket_notification_discord_user_ids,ticket_close_admin_discord_user_ids",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Configuração global ausente.");

  return {
    customization: normalizeBotMessageCustomization(data.bot_message_config),
    ticketNotificationDiscordUserIds: Array.isArray(
      data.ticket_notification_discord_user_ids,
    )
      ? normalizeTicketNotificationDiscordUserIds(
          data.ticket_notification_discord_user_ids,
        )
      : [],
    ticketCloseAdminDiscordUserIds: Array.isArray(
      data.ticket_close_admin_discord_user_ids,
    )
      ? normalizeTicketCloseAdminDiscordUserIds(
          data.ticket_close_admin_discord_user_ids,
        )
      : [],
  };
}

export async function loadBotMessageCustomization(
  client: AdminClient | null = createAdminSupabaseClient(),
): Promise<BotMessageCustomization> {
  return (await loadBotRuntimeSettings(client)).customization;
}

function failClosedRuntimeSettings(): BotRuntimeSettings {
  return {
    customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
    ticketNotificationDiscordUserIds: [],
    ticketCloseAdminDiscordUserIds: [],
  };
}
