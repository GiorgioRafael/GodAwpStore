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
import { STORE_NAME } from "@/lib/brand";
import { formatCoins } from "@/lib/roulette/demo";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

type DiscordChannel = {
  id: string;
  type: number;
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

export type RouletteRedemptionTicketInput = {
  redemptionId: string;
  guildDiscordId: string;
  playerDiscordId: string;
  productName: string;
  valueCents: number;
};

/** Marker kept on the channel topic so a retry finds the channel it created. */
export function rouletteRedemptionTicketMarker(redemptionId: string) {
  return `gwstore:roulette-redemption:${redemptionId}`;
}

function ticketChannelName(productName: string, redemptionId: string) {
  const slug = productName
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
  options: { fetcher?: typeof fetch } = {},
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
  let channel = channels.find(
    (candidate) => candidate.type === 0 && candidate.topic?.startsWith(marker),
  );
  let created = false;

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
          name: ticketChannelName(input.productName, input.redemptionId),
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

  if (created) {
    const staffMentions = [
      ...new Set(settings.ticketNotificationDiscordUserIds),
    ]
      .map((id) => `<@${id}>`)
      .join(" ");
    await discordBotJson(
      `/channels/${channel.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: `<@${input.playerDiscordId}>${staffMentions ? ` ${staffMentions}` : ""}`,
          embeds: [
            {
              title: "Resgate da roleta",
              description:
                `O prêmio saiu do seu inventário e a equipe da ${STORE_NAME} entrega por aqui.`,
              color: 0xd946ef,
              fields: [
                { name: "Item", value: input.productName, inline: true },
                {
                  name: "Valor",
                  value: `${formatCoins(input.valueCents)} moedas`,
                  inline: true,
                },
              ],
              footer: { text: `Resgate ${input.redemptionId.slice(0, 8)}` },
            },
          ],
          allowed_mentions: { parse: [], users: [input.playerDiscordId] },
        }),
      },
      fetcher,
    );
  }

  return { channelId: channel.id, created };
}
