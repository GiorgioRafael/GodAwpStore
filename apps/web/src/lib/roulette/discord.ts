import "server-only";

import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordBotJson,
} from "@/lib/bot/discord-api";
import {
  buildTicketPermissionOverwrites,
  samePermissionOverwrites,
  type DiscordPermissionOverwrite,
} from "@/lib/bot/discord-ticket-controls";
import { loadBotRuntimeSettings } from "@/lib/bot/message-customization-server";
import { botMessageBannerUrl, type BotMessageCustomization } from "@/lib/bot/message-customization";
import { STORE_NAME } from "@/lib/brand";
import { formatCoins } from "@/lib/roulette/demo";
import { buildRouletteTicketControlComponents } from "@/lib/roulette/discord-controls";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

type DiscordChannel = {
  id: string;
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

const DISCORD_MESSAGE_PAGE_SIZE = 100;
const MAXIMUM_WELCOME_MESSAGE_PAGES = 5;

/** Footer marker that lets a later run find the message carrying the buttons. */
export function rouletteWelcomeMessageMarker(redemptionId: string) {
  return `${STORE_NAME} resgate · ${redemptionId}`;
}

export type RouletteRedemptionTicketInput = {
  redemptionId: string;
  guildDiscordId: string;
  playerDiscordId: string;
  /** One line per prize, already formatted as "2x Rainbow Seed". */
  itemSummary: string;
  totalValueCents: number;
};

/** Marker kept on the channel topic so a retry finds the channel it created. */
export function rouletteRedemptionTicketMarker(redemptionId: string) {
  return `gwstore:roulette-redemption:${redemptionId}`;
}

function ticketChannelName(itemSummary: string, redemptionId: string) {
  const slug = itemSummary.split("\n")[0]
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `resgate-${slug || "premio"}-${redemptionId.slice(0, 6)}`.slice(0, 90);
}

/**
 * Opens (or recovers) the private channel where the team hands the roulette
 * prize over. It mirrors the paid-order ticket: only the player, the bot and
 * the configured staff can see it.
 */
export async function ensureRouletteRedemptionTicket(
  input: RouletteRedemptionTicketInput,
  options: {
    fetcher?: typeof fetch;
    /** The channel already stored for this redemption, when there is one. */
    existingChannelId?: string | null;
    /**
     * Refuses to open a new channel. The delivery button is bound to the stored
     * channel, so a caller that only meant to refresh the buttons must never
     * end up creating a second one.
     */
    refuseCreate?: boolean;
  } = {},
) {
  if (!UUID_PATTERN.test(input.redemptionId)) {
    throw new Error("ID do resgate inválido.");
  }
  if (!SNOWFLAKE_PATTERN.test(input.guildDiscordId)) {
    throw new Error("Servidor do resgate inválido.");
  }
  if (!SNOWFLAKE_PATTERN.test(input.playerDiscordId)) {
    throw new Error("Usuário do resgate inválido.");
  }

  const fetcher = options.fetcher ?? fetch;
  const [botUserId, settings] = await Promise.all([
    assertConfiguredDiscordBotIdentity(fetcher),
    loadBotRuntimeSettings(),
  ]);
  await assertDiscordBotGuildAccess(input.guildDiscordId, fetcher);

  const marker = rouletteRedemptionTicketMarker(input.redemptionId);
  const overwrites = buildTicketPermissionOverwrites({
    guildId: input.guildDiscordId,
    buyerDiscordId: input.playerDiscordId,
    botDiscordId: botUserId,
    closerDiscordUserIds: settings.ticketCloseAdminDiscordUserIds,
    notificationDiscordUserIds: settings.ticketNotificationDiscordUserIds,
  });

  const channels = await discordBotJson<DiscordChannel[]>(
    `/guilds/${input.guildDiscordId}/channels`,
    {},
    fetcher,
  );
  // The stored id wins over the marker: an edited topic must not make the
  // lookup miss and open a parallel ticket beside the live one.
  let channel =
    channels.find(
      (candidate) =>
        candidate.type === 0 &&
        options.existingChannelId != null &&
        candidate.id === options.existingChannelId,
    ) ??
    channels.find(
      (candidate) => candidate.type === 0 && candidate.topic?.startsWith(marker),
    );
  let created = false;

  if (!channel && options.refuseCreate) {
    return {
      synchronized: false as const,
      reason: options.existingChannelId
        ? ("channel-gone" as const)
        : ("no-channel" as const),
    };
  }

  if (!channel) {
    channel = await discordBotJson<DiscordChannel>(
      `/guilds/${input.guildDiscordId}/channels`,
      {
        method: "POST",
        headers: {
          "X-Audit-Log-Reason": encodeURIComponent(
            `${STORE_NAME} roulette redemption ${input.redemptionId}`,
          ),
        },
        body: JSON.stringify({
          name: ticketChannelName(input.itemSummary, input.redemptionId),
          type: 0,
          topic: marker,
          permission_overwrites: overwrites,
        }),
      },
      fetcher,
    );
    created = true;
  } else if (!samePermissionOverwrites(channel.permission_overwrites ?? [], overwrites)) {
    channel = await discordBotJson<DiscordChannel>(
      `/channels/${channel.id}`,
      { method: "PATCH", body: JSON.stringify({ permission_overwrites: overwrites }) },
      fetcher,
    );
  }

  if (!SNOWFLAKE_PATTERN.test(channel.id)) {
    throw new Error("Discord retornou um canal de resgate inválido.");
  }

  const components = buildRouletteTicketControlComponents(
    input.redemptionId,
    settings.customization,
  );

  if (created) {
    // The staff ids have to be in allowed_mentions as well as in the text.
    // Discord renders a mention that is not listed there but notifies nobody:
    // the ticket looked like it called the team and never did.
    const staffIds = [...new Set(settings.ticketNotificationDiscordUserIds)].filter(
      (id) => id !== input.playerDiscordId,
    );
    const staffLine = staffIds.length
      ? `🔔 Equipe notificada: ${staffIds.map((id) => `<@${id}>`).join(" ")}`
      : "";
    await discordBotJson(
      `/channels/${channel.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: [`<@${input.playerDiscordId}>`, staffLine].filter(Boolean).join("\n"),
          embeds: [buildWelcomeEmbed(input, settings.customization)],
          components,
          allowed_mentions: {
            parse: [],
            users: [input.playerDiscordId, ...staffIds],
            replied_user: false,
          },
        }),
      },
      fetcher,
    );
  } else {
    // A ticket opened before the buttons existed still has to get them, and a
    // label change in the bot settings has to reach tickets already open.
    const patched = await synchronizeControls(
      channel.id,
      input,
      components,
      botUserId,
      settings.customization,
      fetcher,
    );
    if (!patched) {
      // Saying "updated" here would send the operator away believing the
      // buttons are there when the welcome message could not be found.
      return { synchronized: false as const, reason: "welcome-missing" as const };
    }
  }

  return { synchronized: true as const, channelId: channel.id, created };
}

function buildWelcomeEmbed(
  input: RouletteRedemptionTicketInput,
  customization: BotMessageCustomization,
) {
  return {
    title: "Resgate da roleta",
    description: `O prêmio saiu do seu inventário e a equipe da ${STORE_NAME} entrega por aqui.`,
    color: 0xd946ef,
    fields: [
      { name: "Itens", value: input.itemSummary.slice(0, 1024), inline: false },
      {
        name: "Valor total",
        value: `${formatCoins(input.totalValueCents)} moedas`,
        inline: true,
      },
    ],
    image: { url: botMessageBannerUrl(customization, "ticketUrl") },
    footer: { text: rouletteWelcomeMessageMarker(input.redemptionId) },
  };
}

/**
 * Finds the message this ticket opened with and brings its buttons up to date.
 * A ticket from before the controls existed has no marker in its footer, so the
 * first bot message with the redemption embed is adopted and stamped.
 */
async function synchronizeControls(
  channelId: string,
  input: RouletteRedemptionTicketInput,
  components: ReturnType<typeof buildRouletteTicketControlComponents>,
  botUserId: string,
  customization: BotMessageCustomization,
  fetcher: typeof fetch,
): Promise<boolean> {
  const marker = rouletteWelcomeMessageMarker(input.redemptionId);
  const legacyMarker = `Resgate ${input.redemptionId.slice(0, 8)}`;
  let before: string | undefined;

  for (let page = 0; page < MAXIMUM_WELCOME_MESSAGE_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(DISCORD_MESSAGE_PAGE_SIZE) });
    if (before) query.set("before", before);
    const messages = await discordBotJson<DiscordMessage[]>(
      `/channels/${channelId}/messages?${query.toString()}`,
      {},
      fetcher,
    );
    if (!messages.length) return false;

    const welcome = messages.find(
      (message) =>
        message.author?.id === botUserId &&
        message.embeds?.some(
          (embed) => embed.footer?.text === marker || embed.footer?.text === legacyMarker,
        ),
    );
    if (welcome) {
      if (JSON.stringify(welcome.components ?? []) === JSON.stringify(components)) return true;
      await discordBotJson(
        `/channels/${channelId}/messages/${welcome.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            embeds: [buildWelcomeEmbed(input, customization)],
            components,
          }),
        },
        fetcher,
      );
      return true;
    }

    before = messages[messages.length - 1]?.id;
    if (!before) return false;
  }
  return false;
}
