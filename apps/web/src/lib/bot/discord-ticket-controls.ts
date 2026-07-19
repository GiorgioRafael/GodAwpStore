import "server-only";

import type { BotRuntimeSettings } from "./message-customization-server";
import type { BotMessageCustomization } from "./message-customization";
import { interpolateBotMessageLimited } from "./message-customization";
import {
  DiscordApiError,
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordBotJson,
} from "./discord-api";
import { gameNicknameInteractionId } from "./discord-game-nickname";
import { ticketCloseInteractionId } from "./discord-ticket-close";
import { normalizeTicketCloseAdminDiscordUserIds } from "./ticket-close-admins";
import { normalizeTicketNotificationDiscordUserIds } from "./ticket-notifications";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const TICKET_MEMBER_PERMISSIONS =
  VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY;
const DISCORD_MESSAGE_PAGE_SIZE = 100;
const MAXIMUM_WELCOME_MESSAGE_PAGES = 10;

export type DiscordPermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

type DiscordChannel = {
  id: string;
  guild_id?: string;
  type: number;
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type DiscordMessage = {
  id: string;
  author?: { id?: string };
  embeds?: Array<{ footer?: { text?: string } }>;
  components?: unknown;
};

export class DiscordTicketChannelMissingError extends Error {
  constructor(
    readonly orderId: string,
    readonly channelId: string,
    cause: DiscordApiError,
  ) {
    super("O canal inicial do ticket Discord não existe mais.", { cause });
    this.name = "DiscordTicketChannelMissingError";
  }
}

export function buildTicketPermissionOverwrites(input: {
  guildId: string;
  buyerDiscordId: string;
  botDiscordId: string;
  closerDiscordUserIds?: readonly string[];
  notificationDiscordUserIds?: readonly string[];
}): DiscordPermissionOverwrite[] {
  const memberPermissions = TICKET_MEMBER_PERMISSIONS.toString();
  const memberIds = [
    ...new Set([
      input.buyerDiscordId,
      input.botDiscordId,
      ...normalizeTicketNotificationDiscordUserIds(
        input.notificationDiscordUserIds ?? [],
      ),
      ...normalizeTicketCloseAdminDiscordUserIds(input.closerDiscordUserIds ?? []),
    ]),
  ];

  return [
    { id: input.guildId, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() },
    ...memberIds.map((id) => ({
      id,
      type: 1 as const,
      allow: memberPermissions,
      deny: "0",
    })),
  ];
}

export function buildPaidTicketControlComponents(
  orderId: string,
  customization: BotMessageCustomization,
) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          custom_id: gameNicknameInteractionId(orderId),
          label: interpolateBotMessageLimited(
            customization.ticket.nicknameButtonLabel,
            {},
            80,
          ),
        },
        {
          type: 2,
          style: 4,
          custom_id: ticketCloseInteractionId(orderId),
          label: interpolateBotMessageLimited(
            customization.ticket.closeButtonLabel,
            {},
            80,
          ),
        },
      ],
    },
  ];
}

export async function synchronizeOpenDiscordTicketControls(
  input: {
    orderId: string;
    guildId: string;
    buyerDiscordId: string;
    channelId: string;
    settings: BotRuntimeSettings;
  },
  options: { fetcher?: typeof fetch } = {},
) {
  const normalized = validateSynchronizationInput(input);
  const fetcher = options.fetcher ?? fetch;
  const botUserId = await assertConfiguredDiscordBotIdentity(fetcher);
  await assertDiscordBotGuildAccess(normalized.guildId, fetcher);
  const channel = await readInitialTicketChannel(
    normalized.orderId,
    normalized.guildId,
    normalized.channelId,
    fetcher,
  );

  assertTicketChannel(channel, normalized.orderId, normalized.guildId, normalized.channelId);

  const expectedOverwrites = buildTicketPermissionOverwrites({
    guildId: normalized.guildId,
    buyerDiscordId: normalized.buyerDiscordId,
    botDiscordId: botUserId,
    closerDiscordUserIds: normalized.settings.ticketCloseAdminDiscordUserIds,
    notificationDiscordUserIds:
      normalized.settings.ticketNotificationDiscordUserIds,
  });
  let permissionsUpdated = false;
  if (!samePermissionOverwrites(channel.permission_overwrites ?? [], expectedOverwrites)) {
    await discordBotJson<DiscordChannel>(
      `/channels/${normalized.channelId}`,
      {
        method: "PATCH",
        headers: {
          "X-Audit-Log-Reason": encodeURIComponent(
            `GWStore ticket controls ${normalized.orderId}`,
          ),
        },
        body: JSON.stringify({ permission_overwrites: expectedOverwrites }),
      },
      fetcher,
    );
    permissionsUpdated = true;
  }

  const welcome = await findTicketWelcomeMessage(
    normalized.channelId,
    normalized.orderId,
    botUserId,
    fetcher,
  );
  if (!welcome || !SNOWFLAKE_PATTERN.test(welcome.id)) {
    throw new Error("Mensagem inicial do ticket Discord não encontrada.");
  }

  const expectedComponents = buildPaidTicketControlComponents(
    normalized.orderId,
    normalized.settings.customization,
  );
  let welcomeMessageUpdated = false;
  if (JSON.stringify(welcome.components ?? []) !== JSON.stringify(expectedComponents)) {
    await discordBotJson<DiscordMessage>(
      `/channels/${normalized.channelId}/messages/${welcome.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ components: expectedComponents }),
      },
      fetcher,
    );
    welcomeMessageUpdated = true;
  }

  return { permissionsUpdated, welcomeMessageUpdated };
}

async function readInitialTicketChannel(
  orderId: string,
  guildId: string,
  channelId: string,
  fetcher: typeof fetch,
) {
  try {
    return await discordBotJson<DiscordChannel>(`/channels/${channelId}`, {}, fetcher);
  } catch (error) {
    if (
      error instanceof DiscordApiError &&
      error.status === 404 &&
      error.discordCode === 10_003 &&
      error.method === "GET" &&
      error.path === `/channels/${channelId}`
    ) {
      await assertDiscordBotGuildAccess(guildId, fetcher);
      throw new DiscordTicketChannelMissingError(orderId, channelId, error);
    }
    throw error;
  }
}

async function findTicketWelcomeMessage(
  channelId: string,
  orderId: string,
  botUserId: string,
  fetcher: typeof fetch,
) {
  const marker = welcomeMessageMarker(orderId);
  let before: string | null = null;

  for (let pageIndex = 0; pageIndex < MAXIMUM_WELCOME_MESSAGE_PAGES; pageIndex += 1) {
    const page: DiscordMessage[] = await discordBotJson<DiscordMessage[]>(
      `/channels/${channelId}/messages?limit=${DISCORD_MESSAGE_PAGE_SIZE}${
        before ? `&before=${before}` : ""
      }`,
      {},
      fetcher,
    );
    const welcome: DiscordMessage | undefined = page.find(
      (message) =>
        message.author?.id === botUserId &&
        message.embeds?.some((embed) => embed.footer?.text === marker),
    );
    if (welcome) return welcome;
    if (page.length < DISCORD_MESSAGE_PAGE_SIZE) return null;

    const oldestMessageId: string | undefined = page.at(-1)?.id;
    if (!oldestMessageId || !SNOWFLAKE_PATTERN.test(oldestMessageId)) return null;
    before = oldestMessageId;
  }

  return null;
}

export function ticketTopicMarker(orderId: string) {
  return `gwstore-order:${orderId}`;
}

export function welcomeMessageMarker(orderId: string) {
  return `GWStore ticket · ${orderId}`;
}

export function assertTicketChannel(
  channel: DiscordChannel,
  orderId: string,
  guildId: string,
  channelId: string,
) {
  const marker = ticketTopicMarker(orderId);
  const topicMatches = channel.topic === marker || channel.topic?.startsWith(`${marker};`);
  if (
    channel.id !== channelId ||
    channel.guild_id !== guildId ||
    channel.type !== 0 ||
    !topicMatches
  ) {
    throw new Error("Canal Discord não corresponde ao ticket deste pedido.");
  }
}

export function samePermissionOverwrites(
  left: DiscordPermissionOverwrite[],
  right: DiscordPermissionOverwrite[],
) {
  const normalize = (values: DiscordPermissionOverwrite[]) =>
    values
      .map((value) => `${value.type}:${value.id}:${value.allow || "0"}:${value.deny || "0"}`)
      .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function validateSynchronizationInput<T extends {
  orderId: string;
  guildId: string;
  buyerDiscordId: string;
  channelId: string;
  settings: BotRuntimeSettings;
}>(input: T): T {
  if (!UUID_PATTERN.test(input.orderId)) throw new Error("ID do pedido inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.guildId)) throw new Error("ID do servidor inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.buyerDiscordId)) throw new Error("ID do comprador inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.channelId)) throw new Error("ID do canal inválido.");
  return { ...input, orderId: input.orderId.toLowerCase() };
}
