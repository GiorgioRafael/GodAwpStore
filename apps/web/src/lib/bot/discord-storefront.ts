import "server-only";

import {
  cardToDiscordPayload,
  DiscordContentFormat,
} from "@chat-adapter/discord";
import { toCardElement } from "chat";

import type { Json, JsonObject } from "@/lib/supabase/database.types";
import {
  catalogCards,
  collectDiscordProductOptionEmojis,
  configureDiscordProductEntrySelect,
} from "./discord-bot";
import type { BotMessageCustomization } from "./message-customization";
import type { BotCatalogGame } from "./types";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const DISCORD_TEXT_CHANNEL_TYPES = new Set([0, 5]);
const DISCORD_CATEGORY_CHANNEL_TYPE = 4;

export type DiscordStorefrontChannel = {
  id: string;
  name: string;
  type: 0 | 5;
  position: number;
  parentId: string | null;
  categoryName: string | null;
};

export type DiscordCategoryChannel = {
  id: string;
  name: string;
  position: number;
};

export type DiscordGuildChannels = {
  textChannels: DiscordStorefrontChannel[];
  categories: DiscordCategoryChannel[];
};

export type DiscordStorefrontConfiguration = {
  channel_id: string;
  channel_name: string;
  message_ids: string[];
  published_at: string;
};

export type PublishDiscordStorefrontResult = {
  configuration: DiscordStorefrontConfiguration;
};

type DiscordChannelPayload = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  position?: unknown;
  parent_id?: unknown;
};

type DiscordMessagePayload = {
  id?: unknown;
  channel_id?: unknown;
};

export async function listDiscordTextChannels(
  guildId: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordStorefrontChannel[]> {
  return (await listDiscordGuildChannels(guildId, fetcher)).textChannels;
}

export async function listDiscordGuildChannels(
  guildId: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordGuildChannels> {
  assertSnowflake(guildId, "servidor");
  const response = await fetcher(`${discordApiUrl()}/guilds/${guildId}/channels`, {
    headers: discordHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Discord recusou a leitura dos canais (${response.status}).`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("Resposta de canais inválida do Discord.");

  const categoryNames = new Map<string, string>();
  const categories: DiscordCategoryChannel[] = [];
  for (const item of body) {
    if (!isObject(item) || item.type !== DISCORD_CATEGORY_CHANNEL_TYPE) continue;
    const id = asSnowflake(item.id);
    const name = asChannelName(item.name);
    if (!id || !name) continue;
    categoryNames.set(id, name);
    categories.push({
      id,
      name,
      position: Number.isInteger(item.position) ? Number(item.position) : 0,
    });
  }

  const textChannels = body
    .map((item) => normalizeTextChannel(item, categoryNames))
    .filter((item): item is DiscordStorefrontChannel => item !== null)
    .sort((left, right) => {
      const categoryComparison = (left.categoryName ?? "").localeCompare(
        right.categoryName ?? "",
        "pt-BR",
      );
      if (categoryComparison !== 0) return categoryComparison;
      if (left.position !== right.position) return left.position - right.position;
      return left.name.localeCompare(right.name, "pt-BR");
    });

  return {
    textChannels,
    categories: categories.sort(
      (left, right) =>
        left.position - right.position || left.name.localeCompare(right.name, "pt-BR"),
    ),
  };
}

export function readStorefrontConfiguration(
  configuration: Json,
): DiscordStorefrontConfiguration | null {
  if (!isObject(configuration) || !isObject(configuration.storefront)) return null;
  const storefront = configuration.storefront;
  const channelId = asSnowflake(storefront.channel_id);
  const channelName = asChannelName(storefront.channel_name);
  const publishedAt = typeof storefront.published_at === "string"
    ? storefront.published_at.trim()
    : "";
  const messageIds = Array.isArray(storefront.message_ids)
    ? storefront.message_ids.map(asSnowflake).filter((id): id is string => id !== null)
    : [];

  if (!channelId || !channelName || !publishedAt || messageIds.length === 0) return null;
  return {
    channel_id: channelId,
    channel_name: channelName,
    message_ids: messageIds,
    published_at: publishedAt,
  };
}

export function withStorefrontConfiguration(
  configuration: Json,
  storefront: DiscordStorefrontConfiguration,
): JsonObject {
  return {
    ...(isObject(configuration) ? configuration : {}),
    storefront,
  };
}

export async function publishDiscordStorefront({
  channel,
  catalog,
  customization,
  previous,
  fetcher = fetch,
}: {
  channel: Pick<DiscordStorefrontChannel, "id" | "name">;
  catalog: BotCatalogGame[];
  customization?: BotMessageCustomization;
  previous: DiscordStorefrontConfiguration | null;
  fetcher?: typeof fetch;
}): Promise<PublishDiscordStorefrontResult> {
  assertSnowflake(channel.id, "canal");
  const channelName = asChannelName(channel.name);
  if (!channelName) throw new Error("Nome do canal Discord inválido.");

  const payloads = catalogCards(catalog, customization).map((card) => {
    const productOptionEmojis = collectDiscordProductOptionEmojis(card);
    const normalized = toCardElement(card);
    if (!normalized) throw new Error("Não foi possível montar a vitrine do Discord.");
    return {
      ...configureDiscordProductEntrySelect(
        cardToDiscordPayload(normalized, {
          contentFormat: DiscordContentFormat.ComponentsV2,
        }),
        productOptionEmojis,
      ),
      allowed_mentions: { parse: [] },
    };
  });

  const reusableMessageIds = previous?.channel_id === channel.id ? previous.message_ids : [];
  const messageIds: string[] = [];

  for (let index = 0; index < payloads.length; index += 1) {
    const existingId = reusableMessageIds[index];
    const message = existingId
      ? await editOrCreateMessage(channel.id, existingId, payloads[index], fetcher)
      : await createMessage(channel.id, payloads[index], fetcher);
    messageIds.push(message.id);
  }

  await deleteMessages(
    channel.id,
    reusableMessageIds.slice(payloads.length),
    fetcher,
  );
  if (previous && previous.channel_id !== channel.id) {
    await deleteMessages(previous.channel_id, previous.message_ids, fetcher);
  }

  return {
    configuration: {
      channel_id: channel.id,
      channel_name: channelName,
      message_ids: messageIds,
      published_at: new Date().toISOString(),
    },
  };
}

async function editOrCreateMessage(
  channelId: string,
  messageId: string,
  payload: unknown,
  fetcher: typeof fetch,
) {
  const response = await fetcher(
    `${discordApiUrl()}/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: discordJsonHeaders(),
      body: JSON.stringify(payload),
      cache: "no-store",
    },
  );
  if (response.status === 404) return createMessage(channelId, payload, fetcher);
  return readMessageResponse(response, channelId, "atualização");
}

async function createMessage(channelId: string, payload: unknown, fetcher: typeof fetch) {
  const response = await fetcher(`${discordApiUrl()}/channels/${channelId}/messages`, {
    method: "POST",
    headers: discordJsonHeaders(),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return readMessageResponse(response, channelId, "publicação");
}

async function readMessageResponse(response: Response, channelId: string, operation: string) {
  if (!response.ok) {
    throw new Error(`Discord recusou a ${operation} da vitrine (${response.status}).`);
  }
  const body: unknown = await response.json();
  if (!isObject(body)) throw new Error("Resposta de mensagem inválida do Discord.");
  const id = asSnowflake((body as DiscordMessagePayload).id);
  const responseChannelId = asSnowflake((body as DiscordMessagePayload).channel_id);
  if (!id || (responseChannelId && responseChannelId !== channelId)) {
    throw new Error("Discord retornou uma mensagem incompleta.");
  }
  return { id };
}

async function deleteMessages(channelId: string, messageIds: string[], fetcher: typeof fetch) {
  await Promise.all(
    messageIds.map(async (messageId) => {
      try {
        await fetcher(`${discordApiUrl()}/channels/${channelId}/messages/${messageId}`, {
          method: "DELETE",
          headers: discordHeaders(),
          cache: "no-store",
        });
      } catch {
        // A vitrine nova já está funcional. Limpeza antiga é apenas best effort.
      }
    }),
  );
}

function normalizeTextChannel(
  value: unknown,
  categories: Map<string, string>,
): DiscordStorefrontChannel | null {
  if (!isObject(value) || !DISCORD_TEXT_CHANNEL_TYPES.has(Number(value.type))) return null;
  const raw = value as DiscordChannelPayload;
  const id = asSnowflake(raw.id);
  const name = asChannelName(raw.name);
  if (!id || !name) return null;
  const type = Number(raw.type) as 0 | 5;
  const position = Number.isInteger(raw.position) ? Number(raw.position) : 0;
  const parentId = asSnowflake(raw.parent_id);
  return {
    id,
    name,
    type,
    position,
    parentId,
    categoryName: parentId ? categories.get(parentId) ?? null : null,
  };
}

function discordApiUrl() {
  return (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(/\/$/, "");
}

function discordHeaders(): Record<string, string> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN não configurado.");
  return { Authorization: `Bot ${token}` };
}

function discordJsonHeaders() {
  return { ...discordHeaders(), "Content-Type": "application/json" };
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

function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
