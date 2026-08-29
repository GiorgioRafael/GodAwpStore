import "server-only";

import type { Json, JsonObject } from "@/lib/supabase/database.types";
import {
  botMessageBannerUrl,
  type BotMessageCustomization,
} from "./message-customization";
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
  customization,
  fetcher = fetch,
}: {
  guildId: string;
  channel: { id: string; name: string };
  previous: DiscordRobuxStorefrontConfiguration | null;
  customization?: BotMessageCustomization;
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

  const payload = createDiscordRobuxStorefrontPayload(customization);
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

export function createDiscordRobuxStorefrontPayload(
  customization?: BotMessageCustomization,
) {
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: 0xa855f7,
        title: "Robux",
        description:
          "Compre Robux com Pix de forma simples e segura. Clique em comprar, informe a quantidade e confira o valor antes de gerar o Pix.",
        fields: [
          {
            name: "Preço",
            value: "**1.000 Robux = R$ 40,00**",
            inline: false,
          },
          {
            name: "Como funciona",
            value: "Informe a quantidade, finalize a compra, pague o Pix e aguarde o ticket privado para a entrega.",
            inline: false,
          },
        ],
        image: { url: botMessageBannerUrl(customization, "robuxUrl") },
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
    // Qualquer recusa 4xx da edição vira mensagem nova. Só 404 era tratado, e a
    // mensagem antiga da vitrine de catálogo foi criada com a flag de
    // componentes v2 — o Discord não deixa trocar essa flag numa edição e
    // responde 400, então a publicação de Robux morria em cima de uma vitrine
    // que o painel tinha acabado de prometer substituir.
    if (isDiscordEditRefusal(error)) return createMessage(channelId, payload, fetcher);
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

/**
 * A edição foi recusada por algo que criar de novo resolve.
 *
 * 404 é a mensagem apagada; 400 é o Discord recusando o formato — tipicamente a
 * flag de componentes, que não pode ser adicionada nem removida editando. Um
 * 5xx ou 429 NÃO entra aqui: repetir como criação duplicaria a vitrine.
 */
function isDiscordEditRefusal(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = (error as { status: unknown }).status;
  return status === 404 || status === 400;
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
