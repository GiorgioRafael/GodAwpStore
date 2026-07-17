import "server-only";

import { createHash } from "node:crypto";

import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  interpolateBotMessageLimited,
  type BotMessageCustomization,
} from "./message-customization";
import { loadBotMessageCustomization } from "./message-customization-server";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const TICKET_MEMBER_PERMISSIONS =
  VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY;
const DISCORD_REQUEST_TIMEOUT_MS = 4_000;
const DISCORD_MAX_RETRY_AFTER_MS = 1_500;

type DiscordPermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

type DiscordChannel = {
  id: string;
  type: number;
  name?: string;
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type DiscordUser = {
  id: string;
};

type DiscordMessage = {
  id: string;
  author?: { id?: string };
  embeds?: Array<{ footer?: { text?: string } }>;
};

export type PaidOrderTicketInput = {
  orderId: string;
  guildId: string;
  buyerDiscordId: string;
  productName: string;
  quantity: number;
  paidAmountCents: number;
  parentChannelId?: string | null;
};

export type PaidOrderTicketResult = {
  channelId: string;
  channelName: string;
  created: boolean;
  welcomeMessageCreated: boolean;
  permissionsRepaired: boolean;
};

type TicketOptions = {
  fetcher?: typeof fetch;
};

const ticketTasks = new Map<string, Promise<PaidOrderTicketResult>>();

/**
 * Creates or repairs the private Discord ticket for one paid order.
 *
 * The order UUID is persisted in the channel topic, which makes sequential
 * webhook retries idempotent without coupling this helper to the payment/DB
 * implementation. A process-local lock also collapses concurrent retries that
 * reach the same serverless instance.
 */
export function ensurePaidOrderTicket(
  input: PaidOrderTicketInput,
  options: TicketOptions = {},
): Promise<PaidOrderTicketResult> {
  let normalized: PaidOrderTicketInput;
  try {
    normalized = validateTicketInput(input);
  } catch (error) {
    return Promise.reject(error);
  }
  const taskKey = `${normalized.guildId}:${normalized.orderId}`;
  const existingTask = ticketTasks.get(taskKey);
  if (existingTask) return existingTask;

  const task = loadBotMessageCustomization()
    .then((customization) =>
      ensurePaidOrderTicketInternal(normalized, options.fetcher ?? fetch, customization),
    )
    .finally(() => {
      if (ticketTasks.get(taskKey) === task) ticketTasks.delete(taskKey);
    });
  ticketTasks.set(taskKey, task);
  return task;
}

async function ensurePaidOrderTicketInternal(
  input: PaidOrderTicketInput,
  fetcher: typeof fetch,
  customization: BotMessageCustomization,
): Promise<PaidOrderTicketResult> {
  const config = getDiscordConfig();
  const headers = discordHeaders(config.token);
  const [channels, botUser] = await Promise.all([
    discordJson<DiscordChannel[]>(config.apiUrl, `/guilds/${input.guildId}/channels`, { headers }, fetcher),
    discordJson<DiscordUser>(config.apiUrl, "/users/@me", { headers }, fetcher),
  ]);

  if (!SNOWFLAKE_PATTERN.test(botUser.id)) {
    throw new Error("Discord retornou um ID de bot inválido.");
  }

  const overwrites = buildTicketPermissionOverwrites({
    guildId: input.guildId,
    buyerDiscordId: input.buyerDiscordId,
    botDiscordId: botUser.id,
  });
  const marker = ticketTopicMarker(input.orderId);
  const readyTopic = `${marker};welcome=1`;
  let channel = channels.find((candidate) => candidate.type === 0 && candidate.topic?.startsWith(marker));
  let created = false;
  let permissionsRepaired = false;

  if (!channel) {
    channel = await discordJson<DiscordChannel>(
      config.apiUrl,
      `/guilds/${input.guildId}/channels`,
      {
        method: "POST",
        headers: {
          ...headers,
          "X-Audit-Log-Reason": `GWStore paid order ${input.orderId}`,
        },
        body: JSON.stringify({
          name: ticketChannelName(input.orderId),
          type: 0,
          topic: marker,
          permission_overwrites: overwrites,
          ...(input.parentChannelId ? { parent_id: input.parentChannelId } : {}),
        }),
      },
      fetcher,
    );
    created = true;
  } else if (!samePermissionOverwrites(channel.permission_overwrites ?? [], overwrites)) {
    channel = await discordJson<DiscordChannel>(
      config.apiUrl,
      `/channels/${channel.id}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "X-Audit-Log-Reason": `GWStore privacy repair ${input.orderId}`,
        },
        body: JSON.stringify({ permission_overwrites: overwrites }),
      },
      fetcher,
    );
    permissionsRepaired = true;
  }

  if (!SNOWFLAKE_PATTERN.test(channel.id)) {
    throw new Error("Discord retornou um ID de canal inválido.");
  }

  let welcomeMessageCreated = false;
  if (!channel.topic?.includes(";welcome=1")) {
    const hasWelcomeMessage = created
      ? false
      : await channelHasWelcomeMessage(config.apiUrl, headers, channel.id, botUser.id, input.orderId, fetcher);

    if (!hasWelcomeMessage) {
      await discordJson<DiscordMessage>(
        config.apiUrl,
        `/channels/${channel.id}/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(paidTicketWelcomeMessage(input, customization)),
        },
        fetcher,
      );
      welcomeMessageCreated = true;
    }

    channel = await discordJson<DiscordChannel>(
      config.apiUrl,
      `/channels/${channel.id}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "X-Audit-Log-Reason": `GWStore ticket ready ${input.orderId}`,
        },
        body: JSON.stringify({ topic: readyTopic }),
      },
      fetcher,
    );
  }

  return {
    channelId: channel.id,
    channelName: channel.name || ticketChannelName(input.orderId),
    created,
    welcomeMessageCreated,
    permissionsRepaired,
  };
}

export function buildTicketPermissionOverwrites(input: {
  guildId: string;
  buyerDiscordId: string;
  botDiscordId: string;
}): DiscordPermissionOverwrite[] {
  const memberPermissions = TICKET_MEMBER_PERMISSIONS.toString();

  return [
    { id: input.guildId, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() },
    { id: input.buyerDiscordId, type: 1, allow: memberPermissions, deny: "0" },
    { id: input.botDiscordId, type: 1, allow: memberPermissions, deny: "0" },
  ];
}

export function paidTicketWelcomeMessage(
  input: PaidOrderTicketInput,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const productName = sanitizeDiscordText(input.productName, 256);
  const orderMarker = welcomeMessageMarker(input.orderId);
  const message = customization.ticket;

  return {
    content: `<@${input.buyerDiscordId}>`,
    allowed_mentions: {
      parse: [],
      users: [input.buyerDiscordId],
      replied_user: false,
    },
    nonce: messageNonce(input.orderId),
    enforce_nonce: true,
    embeds: [
      {
        color: 0xa855f7,
        title: interpolateBotMessageLimited(message.title, {}, 256),
        ...(message.description
          ? { description: interpolateBotMessageLimited(message.description, {}, 4_096) }
          : {}),
        fields: [
          {
            name: interpolateBotMessageLimited(message.productLabel, {}, 256),
            value: productName,
            inline: true,
          },
          {
            name: interpolateBotMessageLimited(message.quantityLabel, {}, 256),
            value: new Intl.NumberFormat("pt-BR").format(input.quantity),
            inline: true,
          },
          {
            name: interpolateBotMessageLimited(message.amountLabel, {}, 256),
            value: formatBrl(input.paidAmountCents),
            inline: true,
          },
          {
            name: interpolateBotMessageLimited(message.orderLabel, {}, 256),
            value: `\`${input.orderId}\``,
            inline: false,
          },
        ],
        footer: { text: orderMarker },
      },
    ],
  };
}

async function channelHasWelcomeMessage(
  apiUrl: string,
  headers: Record<string, string>,
  channelId: string,
  botUserId: string,
  orderId: string,
  fetcher: typeof fetch,
) {
  const messages = await discordJson<DiscordMessage[]>(
    apiUrl,
    `/channels/${channelId}/messages?limit=100`,
    { headers },
    fetcher,
  );
  const marker = welcomeMessageMarker(orderId);
  return messages.some(
    (message) =>
      message.author?.id === botUserId &&
      message.embeds?.some((embed) => embed.footer?.text === marker),
  );
}

function samePermissionOverwrites(
  left: DiscordPermissionOverwrite[],
  right: DiscordPermissionOverwrite[],
) {
  const normalize = (values: DiscordPermissionOverwrite[]) =>
    values
      .map((value) => `${value.type}:${value.id}:${value.allow || "0"}:${value.deny || "0"}`)
      .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function validateTicketInput(input: PaidOrderTicketInput): PaidOrderTicketInput {
  if (!UUID_PATTERN.test(input.orderId)) throw new Error("ID do pedido inválido para ticket Discord.");
  if (!SNOWFLAKE_PATTERN.test(input.guildId)) throw new Error("ID do servidor inválido para ticket Discord.");
  if (!SNOWFLAKE_PATTERN.test(input.buyerDiscordId)) throw new Error("ID do comprador inválido para ticket Discord.");
  if (input.parentChannelId && !SNOWFLAKE_PATTERN.test(input.parentChannelId)) {
    throw new Error("ID da categoria de tickets inválido.");
  }
  if (!input.productName.trim()) throw new Error("Produto inválido para ticket Discord.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10_000) {
    throw new Error("Quantidade inválida para ticket Discord.");
  }
  if (!Number.isSafeInteger(input.paidAmountCents) || input.paidAmountCents < 0) {
    throw new Error("Valor pago inválido para ticket Discord.");
  }

  return {
    ...input,
    orderId: input.orderId.toLowerCase(),
    productName: input.productName.trim(),
  };
}

function getDiscordConfig() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN não configurado.");
  return {
    token,
    apiUrl: (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(/\/$/, ""),
  };
}

function discordHeaders(token: string) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

async function discordJson<T>(
  apiUrl: string,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
  attempt = 0,
): Promise<T> {
  const response = await fetcher(`${apiUrl}${path}`, {
    ...init,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
  });
  if (response.status === 429 && attempt === 0) {
    const payload: unknown = await response.json().catch(() => null);
    const retryAfter = readRetryAfterMs(payload);
    if (retryAfter !== null && retryAfter <= DISCORD_MAX_RETRY_AFTER_MS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      return discordJson<T>(apiUrl, path, init, fetcher, attempt + 1);
    }
  }
  if (!response.ok) {
    throw new Error(`Discord recusou a operação do ticket (${response.status}).`);
  }
  return (await response.json()) as T;
}

function readRetryAfterMs(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("retry_after" in payload)) return null;
  const seconds = (payload as { retry_after?: unknown }).retry_after;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds * 1_000)
    : null;
}

function ticketTopicMarker(orderId: string) {
  return `gwstore-order:${orderId}`;
}

function welcomeMessageMarker(orderId: string) {
  return `GWStore ticket · ${orderId}`;
}

function ticketChannelName(orderId: string) {
  return `ticket-${orderId.replaceAll("-", "").slice(0, 12)}`;
}

function messageNonce(orderId: string) {
  return createHash("sha256").update(`gwstore:${orderId}`).digest("hex").slice(0, 25);
}

function sanitizeDiscordText(value: string, maxLength: number) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
