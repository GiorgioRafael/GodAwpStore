import "server-only";

import { getSiteUrl } from "@/lib/env";
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
import type { Enums } from "@/lib/supabase/database.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export type GiveawayPrize = {
  productName: string;
  quantity: number;
};

export type GiveawayAnnouncementInput = {
  id: string;
  publicSlug: string;
  channelId: string;
  messageId?: string | null;
  title: string;
  description: string;
  rulesText: string;
  startsAt: string;
  endsAt: string;
  status: Enums<"giveaway_status">;
  requiredValidInvites: number;
  minimumAccountAgeDays: number;
  minimumStayMinutes: number;
  winnerDiscordUserId?: string | null;
  failureReason?: string | null;
  prizes: GiveawayPrize[];
};

export async function publishGiveawayAnnouncement(
  input: GiveawayAnnouncementInput,
  options: { fetcher?: typeof fetch; siteUrl?: string } = {},
) {
  validateAnnouncement(input);
  const fetcher = options.fetcher ?? fetch;
  const siteUrl = options.siteUrl ?? getSiteUrl();
  const payload = giveawayAnnouncementPayload(input, siteUrl);
  const path = input.messageId
    ? `/channels/${input.channelId}/messages/${input.messageId}`
    : `/channels/${input.channelId}/messages`;
  const message = await discordBotJson<{ id?: unknown; channel_id?: unknown }>(
    path,
    {
      method: input.messageId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    },
    fetcher,
  );
  if (
    typeof message.id !== "string" ||
    !SNOWFLAKE_PATTERN.test(message.id) ||
    (message.channel_id !== undefined && message.channel_id !== input.channelId)
  ) {
    throw new Error("Discord retornou uma publicação de sorteio inválida.");
  }
  return { messageId: message.id };
}

export function giveawayAnnouncementPayload(
  input: GiveawayAnnouncementInput,
  siteUrl: string,
) {
  const status = statusPresentation(input.status);
  const prizeLines = input.prizes.map(
    (prize) => `• **${formatQuantity(prize.quantity)}×** ${sanitize(prize.productName, 180)}`,
  );
  const requirement = input.requiredValidInvites === 0
    ? "Sem convite obrigatório"
    : `${formatQuantity(input.requiredValidInvites)} convite(s) válido(s)`;
  const accountAge = input.minimumAccountAgeDays === 0
    ? "Sem idade mínima de conta"
    : `Conta Discord com ${formatQuantity(input.minimumAccountAgeDays)} dia(s) ou mais`;
  const stay = input.minimumStayMinutes === 0
    ? "Validação após entrar"
    : `Permanecer ${formatDuration(input.minimumStayMinutes)} no servidor`;
  const winnerLine = input.winnerDiscordUserId
    ? `\n\n🏆 **Ganhador:** <@${input.winnerDiscordUserId}>`
    : "";
  const failureLine = input.status === "failed" && input.failureReason
    ? `\n\n⚠️ ${sanitize(input.failureReason, 500)}`
    : "";

  return {
    allowed_mentions: { parse: [], users: input.winnerDiscordUserId ? [input.winnerDiscordUserId] : [] },
    embeds: [
      {
        color: status.color,
        title: `🎁 ${sanitize(input.title, 240)}`,
        description: [
          sanitize(input.description, 2_000),
          `\n**Pacote completo para 1 ganhador**\n${prizeLines.join("\n")}`,
          `\n**Requisitos**\n• ${requirement}\n• ${accountAge}\n• ${stay}`,
          input.rulesText ? `\n**Regras adicionais**\n${sanitize(input.rulesText, 1_500)}` : "",
          winnerLine,
          failureLine,
        ].filter(Boolean).join("\n"),
        fields: [
          { name: "Status", value: status.label, inline: true },
          { name: "Início", value: discordTimestamp(input.startsAt), inline: true },
          { name: "Encerramento", value: discordTimestamp(input.endsAt), inline: true },
        ],
        footer: { text: `GWStore Giveaway • ${input.id}` },
      },
    ],
    components: input.status === "scheduled" || input.status === "active"
      ? [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: input.status === "active" ? "Participar" : "Ver sorteio",
                url: `${siteUrl}/sorteios/${input.publicSlug}`,
              },
            ],
          },
        ]
      : [],
  };
}

export type GiveawayWinnerTicketInput = {
  giveawayId: string;
  guildId: string;
  winnerDiscordUserId: string;
  winnerDisplayName: string;
  title: string;
  parentChannelId?: string | null;
  prizes: GiveawayPrize[];
};

export async function ensureGiveawayWinnerTicket(
  input: GiveawayWinnerTicketInput,
  options: { fetcher?: typeof fetch } = {},
) {
  validateTicket(input);
  const fetcher = options.fetcher ?? fetch;
  const [botUserId, settings] = await Promise.all([
    assertConfiguredDiscordBotIdentity(fetcher),
    loadBotRuntimeSettings(),
  ]);
  await assertDiscordBotGuildAccess(input.guildId, fetcher);
  const channels = await discordBotJson<DiscordChannel[]>(
    `/guilds/${input.guildId}/channels`,
    {},
    fetcher,
  );
  const marker = giveawayTicketMarker(input.giveawayId);
  const readyMarker = `${marker};welcome=1`;
  const overwrites = buildTicketPermissionOverwrites({
    guildId: input.guildId,
    buyerDiscordId: input.winnerDiscordUserId,
    botDiscordId: botUserId,
    closerDiscordUserIds: settings.ticketCloseAdminDiscordUserIds,
    notificationDiscordUserIds: settings.ticketNotificationDiscordUserIds,
  });

  let channel = channels.find(
    (candidate) => candidate.type === 0 && candidate.topic?.startsWith(marker),
  );
  let created = false;
  if (!channel) {
    channel = await discordBotJson<DiscordChannel>(
      `/guilds/${input.guildId}/channels`,
      {
        method: "POST",
        headers: {
          "X-Audit-Log-Reason": encodeURIComponent(
            `GWStore giveaway winner ${input.giveawayId}`,
          ),
        },
        body: JSON.stringify({
          name: winnerTicketChannelName(input.winnerDisplayName, input.giveawayId),
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
    channel = await discordBotJson<DiscordChannel>(
      `/channels/${channel.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ permission_overwrites: overwrites }),
      },
      fetcher,
    );
  }

  if (!SNOWFLAKE_PATTERN.test(channel.id)) {
    throw new Error("Discord retornou um canal de prêmio inválido.");
  }

  if (!channel.topic?.includes(";welcome=1")) {
    const teamIds = settings.ticketNotificationDiscordUserIds.filter(
      (id) => id !== input.winnerDiscordUserId,
    );
    await discordBotJson(
      `/channels/${channel.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: [
            `<@${input.winnerDiscordUserId}>`,
            teamIds.length ? `🔔 Equipe notificada: ${teamIds.map((id) => `<@${id}>`).join(" ")}` : "",
          ].filter(Boolean).join("\n"),
          allowed_mentions: {
            parse: [],
            users: [...new Set([input.winnerDiscordUserId, ...teamIds])],
          },
          embeds: [
            {
              color: 0xd4a64a,
              title: "🏆 Prêmio do sorteio",
              description: `Parabéns! Você ganhou o pacote completo de **${sanitize(input.title, 200)}**.`,
              fields: [
                {
                  name: "Itens do pacote",
                  value: input.prizes
                    .map((prize) => `• **${formatQuantity(prize.quantity)}×** ${sanitize(prize.productName, 180)}`)
                    .join("\n"),
                },
                {
                  name: "Próximo passo",
                  value: "Aguarde a equipe da GWStore neste ticket para combinar a entrega.",
                },
              ],
              footer: { text: `GWStore Giveaway • ${input.giveawayId}` },
            },
          ],
        }),
      },
      fetcher,
    );
    channel = await discordBotJson<DiscordChannel>(
      `/channels/${channel.id}`,
      { method: "PATCH", body: JSON.stringify({ topic: readyMarker }) },
      fetcher,
    );
  }

  return { channelId: channel.id, created };
}

type DiscordChannel = {
  id: string;
  type: number;
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

function giveawayTicketMarker(giveawayId: string) {
  return `gwstore:giveaway:${giveawayId}`;
}

function winnerTicketChannelName(displayName: string, giveawayId: string) {
  const name = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 45) || "ganhador";
  return `premio-${name}-${giveawayId.slice(0, 4)}`;
}

function validateAnnouncement(input: GiveawayAnnouncementInput) {
  if (!UUID_PATTERN.test(input.id)) throw new Error("ID do sorteio inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.channelId)) throw new Error("Canal do sorteio inválido.");
  if (input.messageId && !SNOWFLAKE_PATTERN.test(input.messageId)) {
    throw new Error("Mensagem do sorteio inválida.");
  }
  if (input.prizes.length < 1 || input.prizes.length > 20) {
    throw new Error("Pacote de prêmios inválido.");
  }
}

function validateTicket(input: GiveawayWinnerTicketInput) {
  if (!UUID_PATTERN.test(input.giveawayId)) throw new Error("ID do sorteio inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.guildId)) throw new Error("Servidor do sorteio inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.winnerDiscordUserId)) {
    throw new Error("Ganhador do sorteio inválido.");
  }
  if (input.parentChannelId && !SNOWFLAKE_PATTERN.test(input.parentChannelId)) {
    throw new Error("Categoria do ticket inválida.");
  }
  if (input.prizes.length < 1 || input.prizes.length > 20) {
    throw new Error("Pacote de prêmios inválido.");
  }
}

function statusPresentation(status: Enums<"giveaway_status">) {
  switch (status) {
    case "scheduled": return { label: "Agendado", color: 0x5865f2 };
    case "active": return { label: "Participações abertas", color: 0x65c98b };
    case "drawing": return { label: "Sorteando...", color: 0xe4ad55 };
    case "completed": return { label: "Encerrado", color: 0xd4a64a };
    case "cancelled": return { label: "Cancelado", color: 0x6b7280 };
    case "failed": return { label: "Encerrado sem ganhador", color: 0xef6f6c };
  }
}

function discordTimestamp(value: string) {
  const seconds = Math.floor(Date.parse(value) / 1_000);
  return Number.isFinite(seconds) ? `<t:${seconds}:F> (<t:${seconds}:R>)` : "Data indisponível";
}

function formatDuration(minutes: number) {
  if (minutes % 1_440 === 0) return `${formatQuantity(minutes / 1_440)} dia(s)`;
  if (minutes % 60 === 0) return `${formatQuantity(minutes / 60)} hora(s)`;
  return `${formatQuantity(minutes)} minuto(s)`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function sanitize(value: string, max: number) {
  return value.replace(/[@`]/g, "").trim().slice(0, max) || "—";
}
