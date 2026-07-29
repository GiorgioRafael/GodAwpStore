import "server-only";

import { STORE_NAME } from "@/lib/brand";
import {
  assertDiscordBotGuildAccess,
  DiscordApiError,
  discordBotJson,
} from "@/lib/bot/discord-api";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const ROULETTE_CHANNEL_NAME = "🎰┊roleta";
const ROULETTE_PROMOTION_MARKER = "GWStore • Grow a Garden 2 • roleta";
const ROULETTE_EMBED_COLOR = 0xd946ef;

type DiscordChannel = {
  id?: unknown;
  guild_id?: unknown;
  name?: unknown;
  type?: unknown;
  parent_id?: unknown;
  permission_overwrites?: unknown;
};

type DiscordMessage = {
  id?: unknown;
  channel_id?: unknown;
  author?: { bot?: unknown };
  embeds?: Array<{ footer?: { text?: unknown } }>;
};

export type RoulettePromotionCopy = {
  title: string;
  description: string;
  buttonLabel: string;
};

export type RoulettePromotionPublication = {
  channelId: string;
  messageId: string;
};

export async function publishRoulettePromotion(
  input: RoulettePromotionCopy & {
    guildId: string;
    channelId?: string | null;
    messageId?: string | null;
  },
  options: { fetcher?: typeof fetch; siteUrl?: string } = {},
): Promise<RoulettePromotionPublication> {
  validatePromotionInput(input);
  const fetcher = options.fetcher ?? fetch;
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  await assertDiscordBotGuildAccess(input.guildId, fetcher);

  const channel = await ensurePromotionChannel(
    input.guildId,
    input.channelId,
    fetcher,
  );
  const payload = roulettePromotionPayload(input, siteUrl);

  let message = input.messageId
    ? await editPromotionMessage(channel.id, input.messageId, payload, fetcher)
    : null;
  if (!message) {
    const existing = await findExistingPromotionMessage(channel.id, fetcher);
    if (existing) {
      message = await editPromotionMessage(channel.id, existing.id, payload, fetcher);
    }
  }
  if (!message) {
    message = await createPromotionMessage(channel.id, payload, fetcher);
  }

  return { channelId: channel.id, messageId: message.id };
}

export function roulettePromotionPayload(
  copy: RoulettePromotionCopy,
  siteUrl = "https://gwstore.vercel.app",
) {
  const rouletteUrl = new URL("/roleta", normalizeSiteUrl(siteUrl)).toString();
  const bannerUrl = new URL(
    "/brands/gwstore-storefront-banner.png",
    normalizeSiteUrl(siteUrl),
  ).toString();

  return {
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        color: ROULETTE_EMBED_COLOR,
        title: copy.title,
        url: rouletteUrl,
        description: copy.description,
        image: { url: bannerUrl },
        footer: { text: ROULETTE_PROMOTION_MARKER },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: copy.buttonLabel,
            url: rouletteUrl,
          },
        ],
      },
    ],
  };
}

async function ensurePromotionChannel(
  guildId: string,
  preferredChannelId: string | null | undefined,
  fetcher: typeof fetch,
) {
  if (preferredChannelId && SNOWFLAKE_PATTERN.test(preferredChannelId)) {
    try {
      const preferred = await discordBotJson<DiscordChannel>(
        `/channels/${preferredChannelId}`,
        {},
        fetcher,
      );
      if (
        preferred.id === preferredChannelId
        && preferred.guild_id === guildId
        && preferred.type === 0
      ) {
        return { id: preferredChannelId };
      }
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404) throw error;
    }
  }

  const channels = await discordBotJson<DiscordChannel[]>(
    `/guilds/${guildId}/channels`,
    {},
    fetcher,
  );
  const existing = channels.find(
    (channel) =>
      channel.type === 0
      && channel.name === ROULETTE_CHANNEL_NAME
      && typeof channel.id === "string"
      && SNOWFLAKE_PATTERN.test(channel.id),
  );
  if (existing && typeof existing.id === "string") return { id: existing.id };

  const storefront = channels.find(
    (channel) =>
      channel.type === 0
      && typeof channel.name === "string"
      && channel.name.includes("comprar-itens"),
  );
  const created = await discordBotJson<DiscordChannel>(
    `/guilds/${guildId}/channels`,
    {
      method: "POST",
      body: JSON.stringify({
        name: ROULETTE_CHANNEL_NAME,
        type: 0,
        topic: `Gire a roleta da ${STORE_NAME} e acompanhe seus prêmios em gwstore.vercel.app/roleta`,
        parent_id:
          typeof storefront?.parent_id === "string" ? storefront.parent_id : undefined,
        permission_overwrites: Array.isArray(storefront?.permission_overwrites)
          ? storefront.permission_overwrites
          : undefined,
        rate_limit_per_user: 0,
      }),
    },
    fetcher,
  );
  if (typeof created.id !== "string" || !SNOWFLAKE_PATTERN.test(created.id)) {
    throw new Error("Discord retornou um canal inválido para a divulgação da roleta.");
  }
  return { id: created.id };
}

async function findExistingPromotionMessage(
  channelId: string,
  fetcher: typeof fetch,
) {
  const messages = await discordBotJson<DiscordMessage[]>(
    `/channels/${channelId}/messages?limit=50`,
    {},
    fetcher,
  );
  const message = messages.find(
    (candidate) =>
      candidate.author?.bot === true
      && candidate.embeds?.some(
        (embed) => embed.footer?.text === ROULETTE_PROMOTION_MARKER,
      )
      && typeof candidate.id === "string"
      && SNOWFLAKE_PATTERN.test(candidate.id),
  );
  return message && typeof message.id === "string" ? { id: message.id } : null;
}

async function editPromotionMessage(
  channelId: string,
  messageId: string,
  payload: ReturnType<typeof roulettePromotionPayload>,
  fetcher: typeof fetch,
) {
  if (!SNOWFLAKE_PATTERN.test(messageId)) return null;
  try {
    const message = await discordBotJson<DiscordMessage>(
      `/channels/${channelId}/messages/${messageId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      fetcher,
    );
    return validMessage(message, channelId);
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null;
    throw error;
  }
}

async function createPromotionMessage(
  channelId: string,
  payload: ReturnType<typeof roulettePromotionPayload>,
  fetcher: typeof fetch,
) {
  const message = await discordBotJson<DiscordMessage>(
    `/channels/${channelId}/messages`,
    { method: "POST", body: JSON.stringify(payload) },
    fetcher,
  );
  return validMessage(message, channelId);
}

function validMessage(message: DiscordMessage, channelId: string) {
  if (
    typeof message.id !== "string"
    || !SNOWFLAKE_PATTERN.test(message.id)
    || (message.channel_id !== undefined && message.channel_id !== channelId)
  ) {
    throw new Error("Discord retornou uma divulgação de roleta inválida.");
  }
  return { id: message.id };
}

function validatePromotionInput(
  input: RoulettePromotionCopy & { guildId: string },
) {
  if (!SNOWFLAKE_PATTERN.test(input.guildId)) {
    throw new Error("Servidor Discord inválido.");
  }
  if (!input.title.trim() || input.title.length > 120) {
    throw new Error("Título da divulgação inválido.");
  }
  if (!input.description.trim() || input.description.length > 1_000) {
    throw new Error("Texto da divulgação inválido.");
  }
  if (!input.buttonLabel.trim() || input.buttonLabel.length > 80) {
    throw new Error("Texto do botão inválido.");
  }
}

function normalizeSiteUrl(siteUrl?: string) {
  const url = new URL(siteUrl ?? "https://gwstore.vercel.app");
  if (url.protocol !== "https:") throw new Error("A divulgação exige um endereço HTTPS.");
  return url.origin;
}
