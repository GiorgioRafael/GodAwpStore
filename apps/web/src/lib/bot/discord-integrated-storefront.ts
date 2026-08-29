import "server-only";

import { decodeDiscordCustomId } from "@chat-adapter/discord";

import { BotCommerceService } from "./commerce-service";
import {
  createNativeIntegratedStorefrontSelectionResponse,
  INTEGRATED_STOREFRONT_SELECT_ACTION,
} from "./discord-bot";
import { readDiscordInteraction } from "./discord-context";
import {
  catalogStoresForIntegratedStorefront,
  readDiscordIntegratedStorefrontConfiguration,
} from "./discord-storefront";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  type BotMessageCustomization,
} from "./message-customization";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NativeDiscordIntegratedStorefrontInteraction = {
  catalogStoreId: string;
};

export function parseNativeDiscordIntegratedStorefrontInteraction(
  raw: unknown,
): NativeDiscordIntegratedStorefrontInteraction | null {
  if (!isObject(raw) || raw.type !== DISCORD_MESSAGE_COMPONENT || !isObject(raw.data)) {
    return null;
  }
  if (typeof raw.data.custom_id !== "string" || !Array.isArray(raw.data.values)) {
    return null;
  }
  if (decodeDiscordCustomId(raw.data.custom_id).actionId !== INTEGRATED_STOREFRONT_SELECT_ACTION) {
    return null;
  }
  const [catalogStoreId] = raw.data.values;
  if (raw.data.values.length !== 1 || typeof catalogStoreId !== "string" || !UUID_PATTERN.test(catalogStoreId)) {
    return null;
  }
  return { catalogStoreId };
}

/**
 * Validates that this selector is the one published by this server before
 * rendering the selected store. This prevents copied component ids in another
 * channel from turning into a catalog entry point.
 */
export async function createNativeDiscordIntegratedStorefrontResponse(
  raw: unknown,
  interaction: NativeDiscordIntegratedStorefrontInteraction,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const context = readDiscordInteraction(raw, "");
  const messageId = readMessageId(raw);
  if (!context.guildId || !context.channelId || !messageId) {
    return discordEphemeralText("Esta vitrine não está mais disponível. Abra a mensagem publicada novamente.");
  }

  const client = createAdminSupabaseClient();
  if (!client) return discordEphemeralText("A loja está temporariamente indisponível. Tente novamente em instantes.");
  const { data: guild, error } = await client
    .from("guilds")
    .select("configuration")
    .eq("discord_guild_id", context.guildId)
    .eq("status", "active")
    .is("archived_at", null)
    .maybeSingle();
  if (error || !guild) return discordEphemeralText("Esta vitrine não está mais disponível.");

  const storefront = readDiscordIntegratedStorefrontConfiguration(guild.configuration);
  if (
    !storefront ||
    storefront.channel_id !== context.channelId ||
    storefront.message_id !== messageId
  ) {
    return discordEphemeralText("Esta vitrine foi substituída. Use a mensagem mais recente da loja.");
  }

  try {
    const catalog = catalogStoresForIntegratedStorefront(
      await new BotCommerceService(new SupabaseBotCommerceRepository(client)).listCatalog(),
    );
    const store = catalog.find((item) => item.catalogStoreId === interaction.catalogStoreId);
    if (!store) return discordEphemeralText("Esta loja não está disponível no momento.");
    return createNativeIntegratedStorefrontSelectionResponse(store, customization);
  } catch (error) {
    console.error(
      `[discord-integrated-storefront] ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
    return discordEphemeralText("Não foi possível abrir esta loja agora. Tente novamente em alguns segundos.");
  }
}

function readMessageId(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.message)) return null;
  const id = raw.message.id;
  return typeof id === "string" && /^[0-9]{15,22}$/.test(id) ? id : null;
}

function discordEphemeralText(content: string) {
  return {
    type: 4,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
