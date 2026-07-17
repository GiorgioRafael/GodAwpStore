import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  normalizeBotMessageCustomization,
  type BotMessageCustomization,
} from "./message-customization";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export async function loadBotMessageCustomization(
  client: AdminClient | null = createAdminSupabaseClient(),
): Promise<BotMessageCustomization> {
  if (!client) return DEFAULT_BOT_MESSAGE_CUSTOMIZATION;

  const { data, error } = await client
    .from("platform_settings")
    .select("bot_message_config")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error(`[bot-message-customization] ${error.message}`);
    return DEFAULT_BOT_MESSAGE_CUSTOMIZATION;
  }

  return normalizeBotMessageCustomization(data?.bot_message_config);
}
