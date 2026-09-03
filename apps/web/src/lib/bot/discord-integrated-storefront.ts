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
import { discordApiUrl } from "./discord-api";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  type BotMessageCustomization,
} from "./message-customization";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_CHANNEL_MESSAGE_RESPONSE = 4;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const DISCORD_COMPONENTS_V2_FLAG = 1 << 15;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const INTERACTION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{20,500}$/;

/** The deferred original message must already be Components V2 before it is edited. */
export const DEFERRED_INTEGRATED_STOREFRONT_FLAGS =
  DISCORD_EPHEMERAL_FLAG | DISCORD_COMPONENTS_V2_FLAG;

export type NativeDiscordIntegratedStorefrontInteraction = {
  gameId: string;
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
  const [gameId] = raw.data.values;
  if (raw.data.values.length !== 1 || typeof gameId !== "string" || !UUID_PATTERN.test(gameId)) {
    return null;
  }
  return { gameId };
}

/**
 * Validates that this selector is the one published by this server before
 * rendering the selected game. This prevents copied component ids in another
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
    const gameStores = catalog.filter((item) => item.id === interaction.gameId);
    if (gameStores.length === 0) {
      return discordEphemeralText("Este jogo não está disponível no momento.");
    }
    return createNativeIntegratedStorefrontSelectionResponse(gameStores, customization);
  } catch (error) {
    console.error(
      `[discord-integrated-storefront] ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
    return discordEphemeralText("Não foi possível abrir esta loja agora. Tente novamente em alguns segundos.");
  }
}

/**
 * The initial interaction must be acknowledged within three seconds. The
 * catalog needs multiple database reads, so the route defers first and this
 * function replaces the ephemeral loading state once the catalog is ready.
 */
export async function completeNativeDiscordIntegratedStorefrontResponse(
  raw: unknown,
  interaction: NativeDiscordIntegratedStorefrontInteraction,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  fetcher: typeof fetch = fetch,
) {
  const response = await createNativeDiscordIntegratedStorefrontResponse(
    raw,
    interaction,
    customization,
  );
  if (
    !isObject(response) ||
    response.type !== DISCORD_CHANNEL_MESSAGE_RESPONSE ||
    !isObject(response.data)
  ) {
    throw new Error("Resposta da vitrine integrada inválida.");
  }

  const { applicationId, token } = readInteractionFollowupContext(raw);
  const update = await fetcher(
    `${discordApiUrl()}/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...response.data,
        allowed_mentions: { parse: [] },
      }),
      cache: "no-store",
    },
  );
  if (!update.ok) {
    throw new Error(`Discord recusou a resposta privada (${update.status}).`);
  }
}

function readMessageId(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.message)) return null;
  const id = raw.message.id;
  return typeof id === "string" && /^[0-9]{15,22}$/.test(id) ? id : null;
}

function readInteractionFollowupContext(raw: unknown) {
  if (!isObject(raw)) throw new Error("Interação Discord inválida.");
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim() ?? "";
  const applicationId = typeof raw.application_id === "string" ? raw.application_id : "";
  const token = typeof raw.token === "string" ? raw.token : "";
  if (
    applicationId !== configuredApplicationId ||
    !SNOWFLAKE_PATTERN.test(applicationId) ||
    !INTERACTION_TOKEN_PATTERN.test(token)
  ) {
    throw new Error("Interação Discord incompleta.");
  }
  return { applicationId, token };
}

function discordEphemeralText(content: string) {
  return {
    type: 4,
    data: {
      flags: DEFERRED_INTEGRATED_STOREFRONT_FLAGS,
      components: [
        {
          type: 17,
          accent_color: 0x5865f2,
          components: [{ type: 10, content }],
        },
      ],
      allowed_mentions: { parse: [] },
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
