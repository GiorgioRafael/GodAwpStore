import "server-only";

import { createHash } from "node:crypto";

import { readDiscordInteraction } from "./discord-context";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  interpolateBotMessageLimited,
  type BotMessageCustomization,
} from "./message-customization";
import { createAdminSupabaseClient } from "../supabase/admin";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_MODAL_SUBMIT = 5;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_MODAL_RESPONSE = 9;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const DISCORD_LABEL_COMPONENT = 18;
const DISCORD_TEXT_INPUT_COMPONENT = 4;
const DISCORD_SHORT_TEXT_INPUT = 1;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const INTERACTION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{20,500}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MODAL_CUSTOMIZATION_TIMEOUT_MS = 1_000;

export const GAME_NICKNAME_INTERACTION_PREFIX = "gwstore_game_nickname:";
export const GAME_NICKNAME_INPUT_ID = "game_nickname";
export const GAME_NICKNAME_MINIMUM_LENGTH = 2;
export const GAME_NICKNAME_MAXIMUM_LENGTH = 64;

export type NativeDiscordGameNicknameInteraction =
  | { kind: "open"; orderId: string }
  | {
      kind: "submit";
      orderId: string;
      response: {
        type: typeof DISCORD_DEFERRED_CHANNEL_MESSAGE;
        data: { flags: typeof DISCORD_EPHEMERAL_FLAG };
      };
    };

export type GameNicknameSubmission = {
  orderId: string;
  nickname: string;
  wasChanged: boolean;
  wasCreated: boolean;
};

export type GameNicknameSubmissionInput = {
  orderId: string;
  buyerDiscordId: string;
  discordGuildId: string;
  ticketChannelId: string;
  nickname: string;
};

export interface GameNicknameRepository {
  submit(input: GameNicknameSubmissionInput): Promise<GameNicknameSubmission>;
}

export class GameNicknameSubmissionError extends Error {
  constructor(
    readonly reason: "invalid" | "unauthorized" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "GameNicknameSubmissionError";
  }
}

export class SupabaseGameNicknameRepository implements GameNicknameRepository {
  async submit(input: GameNicknameSubmissionInput): Promise<GameNicknameSubmission> {
    const client = createAdminSupabaseClient();
    if (!client) {
      throw new GameNicknameSubmissionError(
        "unavailable",
        "Supabase server-only não configurado.",
      );
    }

    const { data, error } = await client
      .rpc("submit_paid_order_game_nickname", {
        p_order_id: input.orderId,
        p_buyer_discord_id: input.buyerDiscordId,
        p_discord_guild_id: input.discordGuildId,
        p_ticket_channel_id: input.ticketChannelId,
        p_game_nickname: input.nickname,
      })
      .single();

    if (error) {
      if (error.code === "42501") {
        throw new GameNicknameSubmissionError("unauthorized", error.message);
      }
      if (error.code === "22023") {
        throw new GameNicknameSubmissionError("invalid", error.message);
      }
      throw new GameNicknameSubmissionError("unavailable", error.message);
    }
    if (!data) {
      throw new GameNicknameSubmissionError(
        "unavailable",
        "Supabase não retornou a confirmação do nick.",
      );
    }

    return {
      orderId: data.order_id,
      nickname: data.game_nickname,
      wasChanged: data.was_changed,
      wasCreated: data.was_created,
    };
  }
}

export function gameNicknameInteractionId(orderId: string) {
  const normalizedOrderId = orderId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedOrderId)) {
    throw new Error("ID do pedido inválido para o formulário de nick.");
  }
  return `${GAME_NICKNAME_INTERACTION_PREFIX}${normalizedOrderId}`;
}

export function parseNativeDiscordGameNicknameInteraction(
  raw: unknown,
): NativeDiscordGameNicknameInteraction | null {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.type !== "number") return null;
  if (typeof raw.data.custom_id !== "string") return null;

  const orderId = readOrderId(raw.data.custom_id);
  if (!orderId) return null;

  if (raw.type === DISCORD_MESSAGE_COMPONENT) {
    return { kind: "open", orderId };
  }

  if (raw.type === DISCORD_MODAL_SUBMIT) {
    return {
      kind: "submit",
      orderId,
      response: {
        type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
        data: { flags: DISCORD_EPHEMERAL_FLAG },
      },
    };
  }

  return null;
}

export async function createNativeDiscordGameNicknameResponse(
  orderId: string,
  customization: BotMessageCustomization | Promise<BotMessageCustomization> =
    DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const resolvedCustomization = await resolveModalCustomization(customization);
  const message = resolvedCustomization.ticket;

  return {
    type: DISCORD_MODAL_RESPONSE,
    data: {
      custom_id: gameNicknameInteractionId(orderId),
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

export async function completeDiscordGameNicknameSubmission(
  raw: unknown,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  options: {
    repository?: GameNicknameRepository;
    fetcher?: typeof fetch;
  } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  let confirmationText = customization.ticket.nicknameUnavailableText;
  let publicConfirmation: {
    channelId: string;
    orderId: string;
    nickname: string;
    content: string;
  } | null = null;

  try {
    const native = parseNativeDiscordGameNicknameInteraction(raw);
    const context = readDiscordInteraction(raw, "");
    readDiscordFollowupContext(raw);
    const channelId = readSnowflakeProperty(raw, "channel_id");
    const nickname = normalizeGameNickname(readNicknameModalValue(raw));

    if (
      native?.kind !== "submit" ||
      !context.interactionId ||
      !context.guildId ||
      !context.userId ||
      !channelId
    ) {
      confirmationText = customization.ticket.nicknameUnavailableText;
    } else if (!nickname) {
      confirmationText = customization.ticket.nicknameInvalidText;
    } else {
      const repository = options.repository ?? new SupabaseGameNicknameRepository();
      const result = await repository.submit({
        orderId: native.orderId,
        buyerDiscordId: context.userId,
        discordGuildId: context.guildId,
        ticketChannelId: channelId,
        nickname,
      });
      const template =
        result.wasCreated || !result.wasChanged
          ? customization.ticket.nicknameSavedText
          : customization.ticket.nicknameUpdatedText;
      confirmationText = interpolateBotMessageLimited(
        template,
        { game_nickname: escapeDiscordMarkdown(result.nickname) },
        1_000,
      );
      publicConfirmation = {
        channelId,
        orderId: result.orderId,
        nickname: result.nickname,
        content: confirmationText,
      };
    }
  } catch (error) {
    if (error instanceof GameNicknameSubmissionError) {
      confirmationText =
        error.reason === "invalid"
          ? customization.ticket.nicknameInvalidText
          : error.reason === "unauthorized"
            ? customization.ticket.nicknameUnauthorizedText
            : customization.ticket.nicknameUnavailableText;
    } else {
      confirmationText = customization.ticket.nicknameUnavailableText;
    }
    logNicknameError(error);
  }

  let privateConfirmationError: unknown = null;
  try {
    await updateDiscordOriginalInteraction(raw, confirmationText, fetcher);
  } catch (error) {
    privateConfirmationError = error;
    logNicknameError(error, "private_confirmation");
  }
  if (publicConfirmation) {
    try {
      await postDiscordChannelConfirmation(publicConfirmation, fetcher);
    } catch (error) {
      logNicknameError(error, "public_confirmation");
    }
  }
  if (privateConfirmationError) throw privateConfirmationError;
}

function readOrderId(customId: string) {
  if (!customId.startsWith(GAME_NICKNAME_INTERACTION_PREFIX)) return null;
  const orderId = customId.slice(GAME_NICKNAME_INTERACTION_PREFIX.length);
  return UUID_PATTERN.test(orderId) ? orderId.toLowerCase() : null;
}

function readNicknameModalValue(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.data) || !Array.isArray(raw.data.components)) return null;

  const values: string[] = [];
  let invalidCandidate = false;
  const collect = (component: Record<string, unknown>) => {
    if (component.custom_id !== GAME_NICKNAME_INPUT_ID) return;
    if (component.type !== DISCORD_TEXT_INPUT_COMPONENT || typeof component.value !== "string") {
      invalidCandidate = true;
      return;
    }
    values.push(component.value);
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
  return !invalidCandidate && values.length === 1 ? values[0] : null;
}

export function normalizeGameNickname(value: unknown) {
  if (typeof value !== "string") return null;
  const nickname = value.trim();
  const length = Array.from(nickname).length;
  if (
    length < GAME_NICKNAME_MINIMUM_LENGTH ||
    length > GAME_NICKNAME_MAXIMUM_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(nickname)
  ) {
    return null;
  }
  return nickname;
}

function escapeDiscordMarkdown(value: string) {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");
}

function readSnowflakeProperty(raw: unknown, key: string) {
  if (!isObject(raw)) return null;
  const value = raw[key];
  return typeof value === "string" && SNOWFLAKE_PATTERN.test(value) ? value : null;
}

function readDiscordFollowupContext(raw: unknown) {
  if (!isObject(raw)) throw new Error("Interação Discord inválida.");
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const applicationId = typeof raw.application_id === "string" ? raw.application_id : "";
  const token = typeof raw.token === "string" ? raw.token : "";
  if (
    !configuredApplicationId ||
    applicationId !== configuredApplicationId ||
    !SNOWFLAKE_PATTERN.test(applicationId) ||
    !INTERACTION_TOKEN_PATTERN.test(token)
  ) {
    throw new Error("Interação Discord incompleta.");
  }
  return { applicationId, token };
}

async function postDiscordChannelConfirmation(
  confirmation: {
    channelId: string;
    orderId: string;
    nickname: string;
    content: string;
  },
  fetcher: typeof fetch,
) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN não configurado.");
  if (!SNOWFLAKE_PATTERN.test(confirmation.channelId)) {
    throw new Error("Canal Discord inválido para confirmação do nick.");
  }
  const response = await fetcher(
    `${discordApiUrl()}/channels/${confirmation.channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: confirmation.content,
        allowed_mentions: { parse: [] },
        nonce: nicknameConfirmationNonce(
          confirmation.orderId,
          confirmation.nickname,
        ),
        enforce_nonce: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord recusou a confirmação pública do nick (${response.status}).`);
  }
}

function nicknameConfirmationNonce(orderId: string, nickname: string) {
  return createHash("sha256")
    .update(`gwstore-nickname:${orderId}:${nickname}`)
    .digest("hex")
    .slice(0, 25);
}

function resolveModalCustomization(
  customization: BotMessageCustomization | Promise<BotMessageCustomization>,
) {
  if (!(customization instanceof Promise)) return Promise.resolve(customization);

  return new Promise<BotMessageCustomization>((resolve) => {
    const timeout = setTimeout(
      () => resolve(DEFAULT_BOT_MESSAGE_CUSTOMIZATION),
      MODAL_CUSTOMIZATION_TIMEOUT_MS,
    );
    customization.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        resolve(DEFAULT_BOT_MESSAGE_CUSTOMIZATION);
      },
    );
  });
}

async function updateDiscordOriginalInteraction(
  raw: unknown,
  content: string,
  fetcher: typeof fetch,
) {
  const interaction = readDiscordFollowupContext(raw);
  const response = await fetcher(
    `${discordApiUrl()}/webhooks/${interaction.applicationId}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord recusou a confirmação privada do nick (${response.status}).`);
  }
}

function discordApiUrl() {
  return (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(
    /\/$/,
    "",
  );
}

function logNicknameError(error: unknown, operation = "submission") {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-game-nickname:${operation}] ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
