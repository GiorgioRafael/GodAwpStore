import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  normalizeBotMessageCustomization,
  type BotMessageCustomization,
} from "./message-customization";
import {
  DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
  normalizeTicketNotificationDiscordUserIds,
} from "./ticket-notifications";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type BotRuntimeSettings = {
  customization: BotMessageCustomization;
  ticketNotificationDiscordUserIds: string[];
};

const DEFAULT_BOT_RUNTIME_SETTINGS: BotRuntimeSettings = {
  customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  ticketNotificationDiscordUserIds: [...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS],
};

export async function loadBotRuntimeSettings(
  client: AdminClient | null = createAdminSupabaseClient(),
): Promise<BotRuntimeSettings> {
  if (!client) return cloneDefaultRuntimeSettings();

  const { data, error } = await client
    .from("platform_settings")
    .select("bot_message_config,ticket_notification_discord_user_ids")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error(`[bot-runtime-settings] ${error.message}`);
    return cloneDefaultRuntimeSettings();
  }

  return {
    customization: normalizeBotMessageCustomization(data?.bot_message_config),
    ticketNotificationDiscordUserIds: normalizeTicketNotificationDiscordUserIds(
      data?.ticket_notification_discord_user_ids,
    ),
  };
}

export async function loadBotMessageCustomization(
  client: AdminClient | null = createAdminSupabaseClient(),
): Promise<BotMessageCustomization> {
  return (await loadBotRuntimeSettings(client)).customization;
}

function cloneDefaultRuntimeSettings(): BotRuntimeSettings {
  return {
    customization: DEFAULT_BOT_RUNTIME_SETTINGS.customization,
    ticketNotificationDiscordUserIds: [
      ...DEFAULT_BOT_RUNTIME_SETTINGS.ticketNotificationDiscordUserIds,
    ],
  };
}
