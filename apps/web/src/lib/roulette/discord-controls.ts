import "server-only";

import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordApiUrl,
  discordBotJson,
} from "@/lib/bot/discord-api";
import {
  GAME_NICKNAME_INPUT_ID,
  GAME_NICKNAME_MAXIMUM_LENGTH,
  GAME_NICKNAME_MINIMUM_LENGTH,
  formatCopyableNicknameConfirmation,
  normalizeGameNickname,
} from "@/lib/bot/discord-game-nickname";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  interpolateBotMessageLimited,
  type BotMessageCustomization,
} from "@/lib/bot/message-customization";
import type { BotRuntimeSettings } from "@/lib/bot/message-customization-server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * The redemption ticket carries the same two controls a paid order does, but it
 * cannot borrow their custom_ids: those parse any UUID, so a redemption id would
 * be accepted and then looked up in `orders`, answering "unavailable" forever.
 * These prefixes are distinct and neither is a prefix of the other.
 */
export const ROULETTE_DELIVERY_INTERACTION_PREFIX = "gwstore_roulette_delivery:";
export const ROULETTE_NICKNAME_INTERACTION_PREFIX = "gwstore_roulette_nickname:";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_MODAL_SUBMIT = 5;
const DISCORD_CHANNEL_MESSAGE = 4;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_MODAL_RESPONSE = 9;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const DISCORD_LABEL_COMPONENT = 18;
const DISCORD_TEXT_INPUT_COMPONENT = 4;
const DISCORD_SHORT_TEXT_INPUT = 1;
const MODAL_CUSTOMIZATION_TIMEOUT_MS = 1_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const INTERACTION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{20,500}$/;

export type NativeRouletteDeliveryInteraction = { redemptionId: string };
export type NativeRouletteNicknameInteraction =
  | { kind: "open"; redemptionId: string }
  | {
      kind: "submit";
      redemptionId: string;
      response: {
        type: typeof DISCORD_DEFERRED_CHANNEL_MESSAGE;
        data: { flags: number };
      };
    };

export function rouletteDeliveryInteractionId(redemptionId: string) {
  return `${ROULETTE_DELIVERY_INTERACTION_PREFIX}${assertRedemptionId(redemptionId)}`;
}

export function rouletteNicknameInteractionId(redemptionId: string) {
  return `${ROULETTE_NICKNAME_INTERACTION_PREFIX}${assertRedemptionId(redemptionId)}`;
}

/** The button row posted with the redemption ticket. */
export function buildRouletteTicketControlComponents(
  redemptionId: string,
  customization: BotMessageCustomization,
) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          custom_id: rouletteNicknameInteractionId(redemptionId),
          label: interpolateBotMessageLimited(
            customization.ticket.nicknameButtonLabel,
            {},
            80,
          ),
        },
        {
          type: 2,
          style: 3,
          custom_id: rouletteDeliveryInteractionId(redemptionId),
          label: interpolateBotMessageLimited(
            customization.ticket.deliveryButtonLabel,
            {},
            80,
          ),
        },
      ],
    },
  ];
}

export function parseNativeRouletteDeliveryInteraction(
  raw: unknown,
): NativeRouletteDeliveryInteraction | null {
  if (!isObject(raw) || raw.type !== DISCORD_MESSAGE_COMPONENT || !isObject(raw.data)) {
    return null;
  }
  const redemptionId = readRedemptionId(
    raw.data.custom_id,
    ROULETTE_DELIVERY_INTERACTION_PREFIX,
  );
  return redemptionId ? { redemptionId } : null;
}

export function parseNativeRouletteNicknameInteraction(
  raw: unknown,
): NativeRouletteNicknameInteraction | null {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.type !== "number") return null;
  const redemptionId = readRedemptionId(
    raw.data.custom_id,
    ROULETTE_NICKNAME_INTERACTION_PREFIX,
  );
  if (!redemptionId) return null;

  if (raw.type === DISCORD_MESSAGE_COMPONENT) return { kind: "open", redemptionId };
  if (raw.type === DISCORD_MODAL_SUBMIT) {
    return {
      kind: "submit",
      redemptionId,
      response: {
        type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
        data: { flags: DISCORD_EPHEMERAL_FLAG },
      },
    };
  }
  return null;
}

/**
 * Only the staff who close tickets may conclude a delivery, and the answer has
 * to be inline: Discord gives three seconds before the interaction expires.
 */
export function createNativeRouletteDeliveryResponse(
  raw: unknown,
  settings: BotRuntimeSettings,
) {
  const interaction = parseNativeRouletteDeliveryInteraction(raw);
  const context = readInteractionContext(raw);
  const authorized = Boolean(
    interaction &&
      context &&
      settings.ticketCloseAdminDiscordUserIds.includes(context.userId),
  );

  return {
    authorized,
    response: authorized
      ? { type: DISCORD_DEFERRED_CHANNEL_MESSAGE, data: { flags: DISCORD_EPHEMERAL_FLAG } }
      : {
          type: DISCORD_CHANNEL_MESSAGE,
          data: {
            content: interpolateBotMessageLimited(
              settings.customization.ticket.deliveryUnauthorizedText,
              {},
              2_000,
            ),
            flags: DISCORD_EPHEMERAL_FLAG,
            allowed_mentions: { parse: [] },
          },
        },
  };
}

/** A modal cannot follow a deferral, so the copy races a short timeout. */
export async function createNativeRouletteNicknameResponse(
  redemptionId: string,
  customization: BotMessageCustomization | Promise<BotMessageCustomization> =
    DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const message = (await resolveModalCustomization(customization)).ticket;

  return {
    type: DISCORD_MODAL_RESPONSE,
    data: {
      custom_id: rouletteNicknameInteractionId(redemptionId),
      title: interpolateBotMessageLimited(message.nicknameModalTitle, {}, 45),
      components: [
        {
          type: DISCORD_LABEL_COMPONENT,
          label: interpolateBotMessageLimited(message.nicknameInputLabel, {}, 45),
          component: {
            type: DISCORD_TEXT_INPUT_COMPONENT,
            custom_id: GAME_NICKNAME_INPUT_ID,
            style: DISCORD_SHORT_TEXT_INPUT,
            min_length: GAME_NICKNAME_MINIMUM_LENGTH,
            max_length: GAME_NICKNAME_MAXIMUM_LENGTH,
            required: true,
            placeholder: interpolateBotMessageLimited(
              message.nicknameInputPlaceholder,
              {},
              100,
            ),
          },
        },
      ],
    },
  };
}

export async function completeRouletteNicknameSubmission(
  raw: unknown,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  options: { fetcher?: typeof fetch } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const message = customization.ticket;
  const interaction = parseNativeRouletteNicknameInteraction(raw);
  const context = readInteractionContext(raw);
  const nickname = normalizeGameNickname(readModalTextInput(raw));

  if (!interaction || interaction.kind !== "submit" || !context) {
    await updateOriginalInteractionSafely(raw, message.nicknameUnavailableText, fetcher);
    return { status: "unavailable" as const };
  }
  if (!nickname) {
    await updateOriginalInteractionSafely(raw, message.nicknameInvalidText, fetcher);
    return { status: "invalid" as const };
  }

  const client = createAdminSupabaseClient();
  if (!client) {
    await updateOriginalInteractionSafely(raw, message.nicknameUnavailableText, fetcher);
    return { status: "unavailable" as const };
  }

  const { data, error } = await client.rpc("submit_roulette_redemption_nickname", {
    p_redemption_id: interaction.redemptionId,
    p_player_discord_id: context.userId,
    p_nickname: nickname,
  });
  const row = data?.[0];
  if (error?.code === "42501") {
    await updateOriginalInteractionSafely(raw, message.nicknameUnauthorizedText, fetcher);
    return { status: "unauthorized" as const };
  }
  if (error || !row) {
    if (error) console.error(`[roleta:ticket:nick] ${error.code ?? "sem código"} ${error.message}`);
    await updateOriginalInteractionSafely(raw, message.nicknameUnavailableText, fetcher);
    return { status: "unavailable" as const };
  }

  // The staff read the ticket, not the ephemeral reply, so the name is posted
  // in the channel in a block they can copy — the same shape a paid order gets.
  const confirmation = formatCopyableNicknameConfirmation(
    message.nicknameSavedText,
    row.updated_nickname,
  );
  await postChannelMessageSafely(
    context.channelId,
    confirmation,
    `gwstore-roulette-nickname:${interaction.redemptionId}:${row.updated_nickname}`,
    fetcher,
  );
  await updateOriginalInteractionSafely(raw, confirmation, fetcher);
  return { status: "saved" as const, nickname: row.updated_nickname };
}

export async function completeRouletteRedemptionDelivery(
  raw: unknown,
  settings: BotRuntimeSettings,
  options: { fetcher?: typeof fetch } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const message = settings.customization.ticket;
  const interaction = parseNativeRouletteDeliveryInteraction(raw);
  const context = readInteractionContext(raw);

  if (
    !interaction ||
    !context ||
    !settings.ticketCloseAdminDiscordUserIds.includes(context.userId)
  ) {
    await updateOriginalInteractionSafely(raw, message.deliveryUnauthorizedText, fetcher);
    return { status: "unauthorized" as const };
  }

  const client = createAdminSupabaseClient();
  if (!client) {
    await updateOriginalInteractionSafely(raw, message.deliveryUnavailableText, fetcher);
    return { status: "unavailable" as const };
  }

  try {
    await assertConfiguredDiscordBotIdentity(fetcher);
    await assertDiscordBotGuildAccess(context.guildId, fetcher);

    const { data, error } = await client.rpc(
      "complete_roulette_redemption_discord_delivery",
      {
        p_redemption_id: interaction.redemptionId,
        p_admin_discord_id: context.userId,
        p_channel_id: context.channelId,
      },
    );
    const row = data?.[0];
    if (error?.code === "P0013") {
      await updateOriginalInteractionSafely(raw, message.deliveryAlreadySentText, fetcher);
      return { status: "already_sent" as const };
    }
    if (error || !row) {
      if (error) {
        console.error(`[roleta:ticket:entrega] ${error.code ?? "sem código"} ${error.message}`);
      }
      await updateOriginalInteractionSafely(raw, message.deliveryUnavailableText, fetcher);
      return { status: "unavailable" as const };
    }

    await postChannelMessageSafely(
      context.channelId,
      buildRouletteDeliveryMessage(row.player_discord_id, row.item_summary, message.deliveryMessageText),
      `gwstore-roulette-delivered:${interaction.redemptionId}`,
      fetcher,
      row.player_discord_id,
    );
    await updateOriginalInteractionSafely(raw, message.deliverySuccessText, fetcher);
    return { status: "sent" as const, playerDiscordId: row.player_discord_id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[roleta:ticket:entrega] ${detail}`);
    await updateOriginalInteractionSafely(raw, message.deliveryUnavailableText, fetcher);
    return { status: "unavailable" as const };
  }
}

export function buildRouletteDeliveryMessage(
  playerDiscordId: string,
  itemSummary: string,
  deliveryMessageText: string,
) {
  return [
    `<@${playerDiscordId}>`,
    interpolateBotMessageLimited(deliveryMessageText, {}, 1_500),
    `> ${itemSummary.split("\n").join("\n> ")}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2_000);
}

function assertRedemptionId(redemptionId: string) {
  const normalized = redemptionId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error("ID do resgate inválido.");
  return normalized;
}

function readRedemptionId(customId: unknown, prefix: string) {
  if (typeof customId !== "string" || !customId.startsWith(prefix)) return null;
  const redemptionId = customId.slice(prefix.length);
  return UUID_PATTERN.test(redemptionId) ? redemptionId.toLowerCase() : null;
}

function readInteractionContext(raw: unknown) {
  if (!isObject(raw)) return null;
  const guildId = readSnowflake(raw.guild_id);
  const channelId = readSnowflake(raw.channel_id);
  const member = isObject(raw.member) ? raw.member : null;
  const userId =
    readSnowflake(isObject(member?.user) ? member.user.id : undefined) ??
    readSnowflake(isObject(raw.user) ? raw.user.id : undefined);
  return guildId && channelId && userId ? { guildId, channelId, userId } : null;
}

function readModalTextInput(raw: unknown): unknown {
  if (!isObject(raw) || !isObject(raw.data) || !Array.isArray(raw.data.components)) {
    return null;
  }
  const values: unknown[] = [];
  const collect = (entry: Record<string, unknown>) => {
    if (entry.custom_id === GAME_NICKNAME_INPUT_ID && typeof entry.value === "string") {
      values.push(entry.value);
    }
  };
  for (const entry of raw.data.components) {
    if (!isObject(entry)) continue;
    collect(entry);
    if (isObject(entry.component)) collect(entry.component);
    if (!Array.isArray(entry.components)) continue;
    for (const component of entry.components) {
      if (isObject(component)) collect(component);
    }
  }
  return values.length === 1 ? values[0] : null;
}

async function resolveModalCustomization(
  customization: BotMessageCustomization | Promise<BotMessageCustomization>,
) {
  if (!(customization instanceof Promise)) return customization;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      customization,
      new Promise<BotMessageCustomization>((resolve) => {
        timer = setTimeout(
          () => resolve(DEFAULT_BOT_MESSAGE_CUSTOMIZATION),
          MODAL_CUSTOMIZATION_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    return DEFAULT_BOT_MESSAGE_CUSTOMIZATION;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Interaction follow-ups authenticate with the webhook token, not the bot. */
async function updateOriginalInteractionSafely(
  raw: unknown,
  content: string,
  fetcher: typeof fetch,
) {
  try {
    if (!isObject(raw)) return;
    const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
    const token = typeof raw.token === "string" ? raw.token : "";
    if (
      !applicationId ||
      raw.application_id !== applicationId ||
      !INTERACTION_TOKEN_PATTERN.test(token)
    ) {
      return;
    }
    await fetcher(
      `${discordApiUrl()}/webhooks/${applicationId}/${token}/messages/@original`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: interpolateBotMessageLimited(content, {}, 2_000),
          components: [],
          allowed_mentions: { parse: [] },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[roleta:ticket:followup] ${detail}`);
  }
}

async function postChannelMessageSafely(
  channelId: string,
  content: string,
  nonceSeed: string,
  fetcher: typeof fetch,
  mentionUserId?: string,
) {
  try {
    if (!SNOWFLAKE_PATTERN.test(channelId)) return;
    await discordBotJson(
      `/channels/${channelId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          allowed_mentions: mentionUserId
            ? { parse: [], users: [mentionUserId], replied_user: false }
            : { parse: [] },
          nonce: messageNonce(nonceSeed),
          enforce_nonce: true,
        }),
      },
      fetcher,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[roleta:ticket:mensagem] ${detail}`);
  }
}

/** Discord rejects a repeated nonce, so a double click posts once. */
function messageNonce(seed: string) {
  let hash = 0n;
  for (const character of seed) {
    hash = (hash * 131n + BigInt(character.codePointAt(0) ?? 0)) % 1_000_000_007_000_000_007n;
  }
  return hash.toString().slice(0, 25);
}

function readSnowflake(value: unknown) {
  return typeof value === "string" && SNOWFLAKE_PATTERN.test(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
