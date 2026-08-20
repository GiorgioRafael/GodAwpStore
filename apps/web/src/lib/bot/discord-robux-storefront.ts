import "server-only";

import type { Json, JsonObject } from "@/lib/supabase/database.types";
import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordBotJson,
  discordBotRequest,
} from "./discord-api";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const ROBUX_BUTTON_CUSTOM_ID = "gwstore_robux:open";

export type DiscordRobuxStorefrontConfiguration = {
  channel_id: string;
  channel_name: string;
  message_id: string;
  published_at: string;
};

type DiscordMessage = { id?: unknown; channel_id?: unknown };

export function readRobuxStorefrontConfiguration(
  configuration: Json,
): DiscordRobuxStorefrontConfiguration | null {
  if (!isObject(configuration) || !isObject(configuration.robux_storefront)) return null;
  const storefront = configuration.robux_storefront;
  const channelId = asSnowflake(storefront.channel_id);
  const channelName = asChannelName(storefront.channel_name);
  const messageId = asSnowflake(storefront.message_id);
  const publishedAt = asTimestamp(storefront.published_at);
  if (!channelId || !channelName || !messageId || !publishedAt) return null;
  return {
    channel_id: channelId,
    channel_name: channelName,
    message_id: messageId,
    published_at: publishedAt,
  };
}

export function withRobuxStorefrontConfiguration(
  configuration: Json,
  storefront: DiscordRobuxStorefrontConfiguration,
): JsonObject {
  const current = isObject(configuration) ? configuration : {};
  return { ...current, robux_storefront: storefront };
}

export async function publishDiscordRobuxStorefront({
  guildId,
  channel,
  previous,
  fetcher = fetch,
}: {
  guildId: string;
  channel: { id: string; name: string };
  previous: DiscordRobuxStorefrontConfiguration | null;
  fetcher?: typeof fetch;
}): Promise<DiscordRobuxStorefrontConfiguration> {
  assertSnowflake(guildId, "servidor");
  assertSnowflake(channel.id, "canal");
  const channelName = asChannelName(channel.name);
  if (!channelName) throw new Error("Nome do canal Discord inválido.");

  await Promise.all([
    assertConfiguredDiscordBotIdentity(fetcher),
    assertDiscordBotGuildAccess(guildId, fetcher),
  ]);

  const payload = createDiscordRobuxStorefrontPayload();
  const message =
    previous?.channel_id === channel.id
      ? await editOrCreateMessage(channel.id, previous.message_id, payload, fetcher)
      : await createMessage(channel.id, payload, fetcher);

  if (previous && previous.channel_id !== channel.id) {
    await deleteMessage(previous.channel_id, previous.message_id, fetcher).catch(() => undefined);
  }

  return {
    channel_id: channel.id,
    channel_name: channelName,
    message_id: message.id,
    published_at: new Date().toISOString(),
  };
}

export function createDiscordRobuxStorefrontPayload() {
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: 0xa855f7,
        title: "Robux",
        description:
          "Compre Robux com Pix de forma simples e segura. Clique no botão abaixo, informe a quantidade e o valor será calculado na hora.",
        fields: [
          {
            name: "Preço",
            value: "**1.000 Robux = R$ 35,00**",
            inline: false,
          },
          {
            name: "Como funciona",
            value: "Informe a quantidade, pague o Pix e aguarde o ticket privado para a entrega.",
            inline: false,
          },
        ],
        footer: { text: "GWStore · Pagamento via LivePix" },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: ROBUX_BUTTON_CUSTOM_ID,
            label: "Comprar Robux",
          },
        ],
      },
    ],
  };
}

async function editOrCreateMessage(
  channelId: string,
  messageId: string,
  payload: ReturnType<typeof createDiscordRobuxStorefrontPayload>,
  fetcher: typeof fetch,
) {
  try {
    return await discordBotJson<DiscordMessage>(
      `/channels/${channelId}/messages/${messageId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      fetcher,
    ).then((message) => readMessage(message, channelId));
  } catch (error) {
    if (isDiscordNotFound(error)) return createMessage(channelId, payload, fetcher);
    throw error;
  }
}

async function createMessage(
  channelId: string,
  payload: ReturnType<typeof createDiscordRobuxStorefrontPayload>,
  fetcher: typeof fetch,
) {
  const message = await discordBotJson<DiscordMessage>(
    `/channels/${channelId}/messages`,
    { method: "POST", body: JSON.stringify(payload) },
    fetcher,
  );
  return readMessage(message, channelId);
}

async function deleteMessage(channelId: string, messageId: string, fetcher: typeof fetch) {
  const response = await discordBotRequest(
    `/channels/${channelId}/messages/${messageId}`,
    { method: "DELETE" },
    fetcher,
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Discord recusou a remoção da mensagem de Robux (${response.status}).`);
  }
}

function readMessage(message: DiscordMessage, expectedChannelId: string) {
  const id = asSnowflake(message.id);
  const channelId = asSnowflake(message.channel_id);
  if (!id || (channelId && channelId !== expectedChannelId)) {
    throw new Error("Discord retornou uma mensagem de Robux inválida.");
  }
  return { id };
}

function isDiscordNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function assertSnowflake(value: string, label: string) {
  if (!SNOWFLAKE_PATTERN.test(value)) throw new Error(`ID do ${label} Discord inválido.`);
}

function asSnowflake(value: unknown) {
  return typeof value === "string" && SNOWFLAKE_PATTERN.test(value) ? value : null;
}

function asChannelName(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100
    ? value.trim()
    : null;
}

function asTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
