import "server-only";

import { getSiteUrl } from "@/lib/env";
import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  DiscordApiError,
  discordBotJson,
} from "@/lib/bot/discord-api";
import {
  buildTicketPermissionOverwrites,
  samePermissionOverwrites,
  type DiscordPermissionOverwrite,
} from "@/lib/bot/discord-ticket-controls";
import { loadBotRuntimeSettings } from "@/lib/bot/message-customization-server";
import { giveawayParticipationInteractionId } from "@/lib/giveaways/discord-participation";
import type { Enums } from "@/lib/supabase/database.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const DISCORD_UNKNOWN_MESSAGE_CODE = 10_008;
const EMBED_DESCRIPTION_LIMIT = 4_096;
const EMBED_FIELD_VALUE_LIMIT = 1_024;

export type GiveawayPrize = {
  productName: string;
  quantity: number;
};

export type GiveawayAnnouncementWinner = {
  discordUserId: string;
  displayName: string;
};

export type GiveawayAnnouncementInput = {
  id: string;
  publicSlug: string;
  channelId: string;
  messageId?: string | null;
  resultMessageId?: string | null;
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
  winners?: GiveawayAnnouncementWinner[];
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
  let message: { id?: unknown; channel_id?: unknown };
  try {
    message = await sendGiveawayAnnouncement(input, payload, fetcher);
  } catch (error) {
    if (!input.messageId || !isUnknownDiscordMessage(error)) throw error;
    message = await discordBotJson(
      `/channels/${input.channelId}/messages`,
      { method: "POST", body: JSON.stringify(payload) },
      fetcher,
    );
  }
  if (
    typeof message.id !== "string" ||
    !SNOWFLAKE_PATTERN.test(message.id) ||
    (message.channel_id !== undefined && message.channel_id !== input.channelId)
  ) {
    throw new Error("Discord retornou uma publicação de sorteio inválida.");
  }
  return { messageId: message.id };
}

export async function publishGiveawayResultAnnouncement(
  input: GiveawayAnnouncementInput,
  options: { fetcher?: typeof fetch; siteUrl?: string } = {},
) {
  validateAnnouncement(input);
  const winners = normalizedWinners(input);
  if (input.status !== "completed" || !winners.length) {
    throw new Error("O resultado só pode ser publicado após definir os ganhadores.");
  }
  const fetcher = options.fetcher ?? fetch;
  const siteUrl = options.siteUrl ?? getSiteUrl();
  const payload = giveawayResultAnnouncementPayload(input, siteUrl);
  const send = (messageId?: string | null) => discordBotJson<{
    id?: unknown;
    channel_id?: unknown;
  }>(
    messageId
      ? `/channels/${input.channelId}/messages/${messageId}`
      : `/channels/${input.channelId}/messages`,
    {
      method: messageId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    },
    fetcher,
  );
  let message;
  try {
    message = await send(input.resultMessageId);
  } catch (error) {
    if (!input.resultMessageId || !isUnknownDiscordMessage(error)) throw error;
    message = await send();
  }
  if (
    typeof message.id !== "string"
    || !SNOWFLAKE_PATTERN.test(message.id)
    || (message.channel_id !== undefined && message.channel_id !== input.channelId)
  ) {
    throw new Error("Discord retornou uma publicação de resultado inválida.");
  }
  return { messageId: message.id };
}

export function giveawayAnnouncementPayload(
  input: GiveawayAnnouncementInput,
  siteUrl: string,
) {
  const status = statusPresentation(input.status);
  const prizeLines = input.prizes.map(
    (prize) => `• **${formatQuantity(prize.quantity)}×** ${sanitize(prize.productName, 100)}`,
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
  const winners = normalizedWinners(input);
  const winnerLine = winners.length
    ? `\n\n🏆 **${winners.length === 1 ? "Ganhador" : "Ganhadores"}:**\n${winners
        .map((winner, index) => `${index + 1}. <@${winner.discordUserId}>`)
        .join("\n")}`
    : "";
  const failureLine = input.status === "failed" && input.failureReason
    ? `\n\n⚠️ ${sanitize(input.failureReason, 300)}`
    : "";
  const prizeHeading = winners.length > 1
    ? `Prêmios distribuídos entre ${formatQuantity(winners.length)} ganhadores`
    : "Pacote completo para 1 ganhador";
  const mentionedWinnerIds = winners.map((winner) => winner.discordUserId);

  const payload = {
    allowed_mentions: { parse: [], users: mentionedWinnerIds },
    embeds: [
      {
        color: status.color,
        title: `🎁 ${sanitize(input.title, 240)}`,
        description: limitText([
          sanitize(input.description, 900),
          `\n**${prizeHeading}**\n${prizeLines.join("\n")}`,
          `\n**Requisitos**\n• ${requirement}\n• ${accountAge}\n• ${stay}`,
          winnerLine,
          failureLine,
        ].filter(Boolean).join("\n"), EMBED_DESCRIPTION_LIMIT),
        fields: [
          { name: "Status", value: status.label, inline: true },
          { name: "Início", value: discordTimestamp(input.startsAt), inline: true },
          { name: "Encerramento", value: discordTimestamp(input.endsAt), inline: true },
          ...(input.rulesText
            ? [{ name: "Regras adicionais", value: sanitize(input.rulesText, 900), inline: false }]
            : []),
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
                style: 3,
                label: "Participar",
                custom_id: giveawayParticipationInteractionId(input.id),
              },
              {
                type: 2,
                style: 5,
                label: "Visualizar",
                url: giveawayViewerUrl(siteUrl, input.publicSlug),
              },
            ],
          },
        ]
      : [],
  };
  assertDiscordEmbeds(payload.embeds);
  return payload;
}

export function giveawayResultAnnouncementPayload(
  input: GiveawayAnnouncementInput,
  siteUrl: string,
) {
  const winners = normalizedWinners(input);
  const winnerLines = winners.map(
    (winner, index) => `**${index + 1}.** <@${winner.discordUserId}>`,
  );
  const prizeLines = input.prizes.map(
    (prize) => `• **${formatQuantity(prize.quantity)}×** ${sanitize(prize.productName, 100)}`,
  );
  const embed = {
    color: 0xd4a64a,
    title: "🏆 RESULTADO DO SORTEIO",
    description: limitText([
      `O sorteio **${sanitize(input.title, 220)}** foi encerrado.`,
      `\n**${winners.length === 1 ? "Ganhador" : "Ganhadores"}**\n${winnerLines.join("\n")}`,
      `\n**Prêmios**\n${prizeLines.join("\n")}`,
      "\nOs tickets privados de entrega serão abertos automaticamente.",
    ].join("\n"), EMBED_DESCRIPTION_LIMIT),
    footer: { text: `GWStore Giveaway • ${input.id}` },
  };
  assertDiscordEmbeds([embed]);
  return {
    content: "🎉 **Sorteio encerrado — confiram os ganhadores!**",
    allowed_mentions: {
      parse: [],
      users: winners.map((winner) => winner.discordUserId),
    },
    embeds: [embed],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Ver resultado",
        url: giveawayViewerUrl(siteUrl, input.publicSlug),
      }],
    }],
  };
}

function giveawayViewerUrl(siteUrl: string, publicSlug: string) {
  const url = new URL("/api/sorteios/oauth/iniciar", siteUrl);
  url.searchParams.set("slug", publicSlug);
  url.searchParams.set("modo", "visualizar");
  return url.toString();
}

export type GiveawayWinnerTicketInput = {
  giveawayId: string;
  winnerId?: string;
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
  const marker = giveawayTicketMarker(input.giveawayId, input.winnerId);
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
          name: winnerTicketChannelName(
            input.winnerDisplayName,
            input.winnerId ?? input.giveawayId,
          ),
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
    const welcomeExists = await hasGiveawayWelcomeMessage(
      channel.id,
      botUserId,
      input.giveawayId,
      fetcher,
    );
    if (!welcomeExists) {
      const teamIds = [...new Set(settings.ticketNotificationDiscordUserIds)]
        .filter((id) => id !== input.winnerDiscordUserId)
        .slice(0, 90);
      await discordBotJson(
        `/channels/${channel.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify(giveawayWinnerTicketPayload(input, teamIds)),
        },
        fetcher,
      );
    }
    channel = await discordBotJson<DiscordChannel>(
      `/channels/${channel.id}`,
      { method: "PATCH", body: JSON.stringify({ topic: readyMarker }) },
      fetcher,
    );
  }

  return { channelId: channel.id, created };
}

async function sendGiveawayAnnouncement(
  input: GiveawayAnnouncementInput,
  payload: ReturnType<typeof giveawayAnnouncementPayload>,
  fetcher: typeof fetch,
) {
  const path = input.messageId
    ? `/channels/${input.channelId}/messages/${input.messageId}`
    : `/channels/${input.channelId}/messages`;
  return discordBotJson<{ id?: unknown; channel_id?: unknown }>(
    path,
    {
      method: input.messageId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    },
    fetcher,
  );
}

function isUnknownDiscordMessage(error: unknown) {
  return error instanceof DiscordApiError
    && error.status === 404
    && error.discordCode === DISCORD_UNKNOWN_MESSAGE_CODE;
}

export function giveawayWinnerTicketPayload(
  input: GiveawayWinnerTicketInput,
  notificationDiscordUserIds: string[],
) {
  const winnerMention = `<@${input.winnerDiscordUserId}>`;
  const teamIds: string[] = [];
  let teamLine = "";
  for (const id of notificationDiscordUserIds) {
    const candidateIds = [...teamIds, id];
    const candidateLine = `🔔 Equipe notificada: ${candidateIds.map((candidate) => `<@${candidate}>`).join(" ")}`;
    if (`${winnerMention}\n${candidateLine}`.length > 1_900) break;
    teamIds.push(id);
    teamLine = candidateLine;
  }

  const prizeLines = input.prizes.map(
    (prize) => `• **${formatQuantity(prize.quantity)}×** ${sanitize(prize.productName, 120)}`,
  );
  const prizeFields = chunkLines(prizeLines, EMBED_FIELD_VALUE_LIMIT).map(
    (value, index) => ({
      name: index === 0 ? "Itens do pacote" : `Itens do pacote (${index + 1})`,
      value,
    }),
  );
  const embed = {
    color: 0xd4a64a,
    title: "🏆 Prêmio do sorteio",
    description: `Parabéns! Você ganhou um prêmio de **${sanitize(input.title, 200)}**.`,
    fields: [
      ...prizeFields,
      {
        name: "Próximo passo",
        value: "Aguarde a equipe da GWStore neste ticket para combinar a entrega.",
      },
    ],
    footer: { text: `GWStore Giveaway • ${input.giveawayId}` },
  };
  assertDiscordEmbeds([embed]);
  return {
    content: [winnerMention, teamLine].filter(Boolean).join("\n"),
    allowed_mentions: {
      parse: [],
      users: [input.winnerDiscordUserId, ...teamIds],
    },
    embeds: [embed],
  };
}

async function hasGiveawayWelcomeMessage(
  channelId: string,
  botUserId: string,
  giveawayId: string,
  fetcher: typeof fetch,
) {
  const messages = await discordBotJson<DiscordMessage[]>(
    `/channels/${channelId}/messages?limit=100`,
    {},
    fetcher,
  );
  const expectedFooter = `GWStore Giveaway • ${giveawayId}`;
  return messages.some((message) =>
    message.author?.id === botUserId
    && message.embeds?.some((embed) => embed.footer?.text === expectedFooter),
  );
}

type DiscordChannel = {
  id: string;
  type: number;
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type DiscordMessage = {
  author?: { id?: string };
  embeds?: Array<{ footer?: { text?: string } }>;
};

function giveawayTicketMarker(giveawayId: string, winnerId?: string) {
  return winnerId
    ? `gwstore:giveaway:${giveawayId}:winner:${winnerId}`
    : `gwstore:giveaway:${giveawayId}`;
}

function winnerTicketChannelName(displayName: string, uniqueId: string) {
  const name = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 45) || "ganhador";
  return `premio-${name}-${uniqueId.slice(0, 4)}`;
}

function validateAnnouncement(input: GiveawayAnnouncementInput) {
  if (!UUID_PATTERN.test(input.id)) throw new Error("ID do sorteio inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.channelId)) throw new Error("Canal do sorteio inválido.");
  if (input.messageId && !SNOWFLAKE_PATTERN.test(input.messageId)) {
    throw new Error("Mensagem do sorteio inválida.");
  }
  if (input.resultMessageId && !SNOWFLAKE_PATTERN.test(input.resultMessageId)) {
    throw new Error("Mensagem de resultado inválida.");
  }
  if (input.prizes.length < 1 || input.prizes.length > 20) {
    throw new Error("Pacote de prêmios inválido.");
  }
}

function validateTicket(input: GiveawayWinnerTicketInput) {
  if (!UUID_PATTERN.test(input.giveawayId)) throw new Error("ID do sorteio inválido.");
  if (input.winnerId && !UUID_PATTERN.test(input.winnerId)) {
    throw new Error("ID do ganhador inválido.");
  }
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

function normalizedWinners(input: GiveawayAnnouncementInput) {
  const winners = input.winners?.filter(
    (winner) => SNOWFLAKE_PATTERN.test(winner.discordUserId),
  ) ?? [];
  if (winners.length) return winners.slice(0, 100);
  return input.winnerDiscordUserId && SNOWFLAKE_PATTERN.test(input.winnerDiscordUserId)
    ? [{ discordUserId: input.winnerDiscordUserId, displayName: "" }]
    : [];
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

function limitText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function chunkLines(lines: string[], max: number) {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const safeLine = limitText(line, max);
    const candidate = current ? `${current}\n${safeLine}` : safeLine;
    if (candidate.length <= max) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = safeLine;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function assertDiscordEmbeds(embeds: Array<{
  title?: string;
  description?: string;
  footer?: { text?: string };
  fields?: Array<{ name: string; value: string }>;
}>) {
  let total = 0;
  for (const embed of embeds) {
    if ((embed.description?.length ?? 0) > EMBED_DESCRIPTION_LIMIT) {
      throw new Error("Descrição do embed do Discord excedeu o limite.");
    }
    if ((embed.fields?.length ?? 0) > 25) {
      throw new Error("Embed do Discord excedeu o limite de campos.");
    }
    total += (embed.title?.length ?? 0)
      + (embed.description?.length ?? 0)
      + (embed.footer?.text?.length ?? 0);
    for (const field of embed.fields ?? []) {
      if (field.name.length > 256 || field.value.length > EMBED_FIELD_VALUE_LIMIT) {
        throw new Error("Campo do embed do Discord excedeu o limite.");
      }
      total += field.name.length + field.value.length;
    }
  }
  if (total > 6_000) throw new Error("Mensagem de embed do Discord excedeu o limite total.");
}
