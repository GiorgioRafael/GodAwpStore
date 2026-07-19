import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readDiscordInteraction } from "./discord-context";
import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordApiUrl,
  discordBotRequest,
  isDiscordUnknownChannelResponse,
} from "./discord-api";
import type { BotRuntimeSettings } from "./message-customization-server";
import { interpolateBotMessageLimited } from "./message-customization";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_CHANNEL_MESSAGE = 4;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_UPDATE_MESSAGE = 7;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const INTERACTION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{20,500}$/;
const COMPLETE_RETRY_BUDGET_MS = 23_000;
const COMPLETE_RETRY_DELAYS_MS = [250, 750, 1_500, 3_000, 4_500, 5_500, 6_500] as const;

export const TICKET_CLOSE_INTERACTION_PREFIX = "gwstore_ticket_close:";
export const TICKET_CLOSE_CONFIRM_INTERACTION_PREFIX =
  "gwstore_ticket_close_confirm:";
export const TICKET_CLOSE_CANCEL_INTERACTION_PREFIX =
  "gwstore_ticket_close_cancel:";

export type NativeDiscordTicketCloseInteraction =
  | { kind: "request"; orderId: string }
  | { kind: "confirm"; orderId: string; response: ReturnType<typeof deferredResponse> }
  | { kind: "cancel"; orderId: string };

export type DiscordTicketCloseClaim = {
  orderId: string;
  claimed: boolean;
  alreadyClosed: boolean;
  ticketStatus: string;
  ticketChannelId: string | null;
  claimToken: string | null;
};

export interface DiscordTicketCloseRepository {
  claim(input: {
    orderId: string;
    discordGuildId: string;
    ticketChannelId: string;
    closedByDiscordUserId: string;
    claimToken: string;
  }): Promise<DiscordTicketCloseClaim>;
  complete(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<void>;
  release(input: { orderId: string; claimToken: string }): Promise<void>;
}

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export class SupabaseDiscordTicketCloseRepository
  implements DiscordTicketCloseRepository
{
  constructor(private readonly client: AdminClient = requireAdminClient()) {}

  async claim(input: {
    orderId: string;
    discordGuildId: string;
    ticketChannelId: string;
    closedByDiscordUserId: string;
    claimToken: string;
  }): Promise<DiscordTicketCloseClaim> {
    const { data, error } = await this.client
      .rpc("claim_discord_ticket_close", {
        p_order_id: input.orderId,
        p_discord_guild_id: input.discordGuildId,
        p_ticket_channel_id: input.ticketChannelId,
        p_closed_by_discord_user_id: input.closedByDiscordUserId,
        p_claim_token: input.claimToken,
      })
      .single();
    if (error) throw repositoryError(error);
    return {
      orderId: data.claimed_order_id,
      claimed: data.claimed,
      alreadyClosed: data.already_closed,
      ticketStatus: data.ticket_status,
      ticketChannelId: data.ticket_channel_id,
      claimToken: data.claim_token,
    };
  }

  async complete(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<void> {
    const { error } = await this.client.rpc("complete_discord_ticket_close", {
      p_order_id: input.orderId,
      p_ticket_channel_id: input.ticketChannelId,
      p_claim_token: input.claimToken,
    });
    if (error) throw repositoryError(error);
  }

  async release(input: { orderId: string; claimToken: string }): Promise<void> {
    const { error } = await this.client.rpc("release_discord_ticket_close", {
      p_order_id: input.orderId,
      p_claim_token: input.claimToken,
    });
    if (error) throw repositoryError(error);
  }
}

export class DiscordTicketCloseError extends Error {
  constructor(
    readonly reason: "unauthorized" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "DiscordTicketCloseError";
  }
}

export function ticketCloseInteractionId(orderId: string) {
  return buildInteractionId(TICKET_CLOSE_INTERACTION_PREFIX, orderId);
}

export function ticketCloseConfirmInteractionId(orderId: string) {
  return buildInteractionId(TICKET_CLOSE_CONFIRM_INTERACTION_PREFIX, orderId);
}

export function ticketCloseCancelInteractionId(orderId: string) {
  return buildInteractionId(TICKET_CLOSE_CANCEL_INTERACTION_PREFIX, orderId);
}

export function parseNativeDiscordTicketCloseInteraction(
  raw: unknown,
): NativeDiscordTicketCloseInteraction | null {
  if (!isObject(raw) || raw.type !== DISCORD_MESSAGE_COMPONENT || !isObject(raw.data)) {
    return null;
  }
  if (typeof raw.data.custom_id !== "string") return null;

  const candidates = [
    ["confirm", TICKET_CLOSE_CONFIRM_INTERACTION_PREFIX],
    ["cancel", TICKET_CLOSE_CANCEL_INTERACTION_PREFIX],
    ["request", TICKET_CLOSE_INTERACTION_PREFIX],
  ] as const;
  for (const [kind, prefix] of candidates) {
    const orderId = readOrderId(raw.data.custom_id, prefix);
    if (!orderId) continue;
    return kind === "confirm"
      ? { kind, orderId, response: deferredResponse() }
      : { kind, orderId };
  }
  return null;
}

export function createNativeDiscordTicketClosePrompt(
  raw: unknown,
  settings: BotRuntimeSettings,
) {
  const interaction = parseNativeDiscordTicketCloseInteraction(raw);
  const context = readCloseInteractionContext(raw);
  const message = settings.customization.ticket;
  if (
    interaction?.kind !== "request" ||
    !context ||
    !settings.ticketCloseAdminDiscordUserIds.includes(context.userId)
  ) {
    return ephemeralResponse(message.closeUnauthorizedText);
  }

  return {
    type: DISCORD_CHANNEL_MESSAGE,
    data: {
      content: interpolateBotMessageLimited(message.closeConfirmationText, {}, 1_000),
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 4,
              custom_id: ticketCloseConfirmInteractionId(interaction.orderId),
              label: interpolateBotMessageLimited(
                message.closeConfirmButtonLabel,
                {},
                80,
              ),
            },
            {
              type: 2,
              style: 2,
              custom_id: ticketCloseCancelInteractionId(interaction.orderId),
              label: interpolateBotMessageLimited(
                message.closeCancelButtonLabel,
                {},
                80,
              ),
            },
          ],
        },
      ],
    },
  };
}

export function createNativeDiscordTicketCloseCancelResponse(
  raw: unknown,
  settings: BotRuntimeSettings,
) {
  const interaction = parseNativeDiscordTicketCloseInteraction(raw);
  const context = readCloseInteractionContext(raw);
  const content =
    interaction?.kind === "cancel" && context
      ? "Fechamento cancelado."
      : settings.customization.ticket.closeUnavailableText;
  return {
    type: DISCORD_UPDATE_MESSAGE,
    data: { content, components: [], allowed_mentions: { parse: [] } },
  };
}

export async function completeDiscordTicketClose(
  raw: unknown,
  settings: BotRuntimeSettings,
  options: {
    repository?: DiscordTicketCloseRepository;
    fetcher?: typeof fetch;
    createClaimToken?: () => string;
    wait?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  } = {},
) {
  const interaction = parseNativeDiscordTicketCloseInteraction(raw);
  const context = readCloseInteractionContext(raw, true);
  const message = settings.customization.ticket;
  const fetcher = options.fetcher ?? fetch;
  if (interaction?.kind !== "confirm" || !context) {
    await updateOriginalInteractionSafely(raw, message.closeUnavailableText, fetcher);
    return { status: "unavailable" as const };
  }

  const repository = options.repository ?? new SupabaseDiscordTicketCloseRepository();
  const requestedClaimToken = (options.createClaimToken ?? randomUUID)();
  let activeClaim: { orderId: string; ticketChannelId: string; claimToken: string } | null = null;
  let deletionOutcome: "not_attempted" | "not_removed" | "ambiguous" | "removed" =
    "not_attempted";

  try {
    const claim = await repository.claim({
      orderId: interaction.orderId,
      discordGuildId: context.guildId,
      ticketChannelId: context.channelId,
      closedByDiscordUserId: context.userId,
      claimToken: requestedClaimToken,
    });
    if (claim.alreadyClosed) {
      await updateOriginalInteractionSafely(raw, message.closeSuccessText, fetcher);
      return { status: "closed" as const };
    }
    if (!claim.claimed) {
      await updateOriginalInteractionSafely(raw, message.closeInProgressText, fetcher);
      return { status: "in_progress" as const };
    }
    if (
      claim.orderId !== interaction.orderId ||
      claim.ticketChannelId !== context.channelId ||
      claim.claimToken !== requestedClaimToken ||
      !SNOWFLAKE_PATTERN.test(claim.ticketChannelId)
    ) {
      throw new DiscordTicketCloseError(
        "unavailable",
        "A reserva de fechamento não corresponde ao ticket.",
      );
    }
    activeClaim = {
      orderId: claim.orderId,
      ticketChannelId: claim.ticketChannelId,
      claimToken: claim.claimToken,
    };

    await assertConfiguredDiscordBotIdentity(fetcher);
    await assertDiscordBotGuildAccess(context.guildId, fetcher);
    await updateOriginalInteractionSafely(raw, message.closeInProgressText, fetcher);
    const channelResponse = await discordBotRequest(
      `/channels/${activeClaim.ticketChannelId}`,
      {},
      fetcher,
    );
    if (await isDiscordUnknownChannelResponse(channelResponse)) {
      await assertDiscordBotGuildAccess(context.guildId, fetcher);
      deletionOutcome = "removed";
    } else {
      if (!channelResponse.ok) {
        if (channelResponse.status === 404) deletionOutcome = "ambiguous";
        throw new Error(`Discord recusou a leitura do ticket (${channelResponse.status}).`);
      }
      const channel = (await channelResponse.json()) as {
        id: string;
        guild_id?: string;
        type: number;
        topic?: string | null;
      };
      assertStoredTicketChannel(
        channel,
        activeClaim.orderId,
        context.guildId,
        activeClaim.ticketChannelId,
      );

      let deleteResponse: Response;
      deletionOutcome = "ambiguous";
      try {
        deleteResponse = await discordBotRequest(
          `/channels/${activeClaim.ticketChannelId}`,
          {
            method: "DELETE",
            headers: {
              "X-Audit-Log-Reason": encodeURIComponent(
                `GWStore ticket ${activeClaim.orderId} closed by ${context.userId}`,
              ),
            },
          },
          fetcher,
        );
      } catch (error) {
        throw new Error("Resultado do fechamento do canal Discord é incerto.", {
          cause: error,
        });
      }
      const channelIsMissing = await isDiscordUnknownChannelResponse(deleteResponse);
      if (!deleteResponse.ok && !channelIsMissing) {
        if (
          deleteResponse.status < 500 &&
          deleteResponse.status !== 429 &&
          deleteResponse.status !== 404
        ) {
          deletionOutcome = "not_removed";
        }
        throw new Error(`Discord recusou o fechamento do ticket (${deleteResponse.status}).`);
      }
      if (channelIsMissing) {
        await assertDiscordBotGuildAccess(context.guildId, fetcher);
      }
      deletionOutcome = "removed";
      if (deleteResponse.ok) {
        const deletedChannel: unknown = await deleteResponse.json().catch(() => null);
        if (!isObject(deletedChannel) || deletedChannel.id !== activeClaim.ticketChannelId) {
          throw new Error("Discord retornou uma confirmação de canal inválida após o fechamento.");
        }
      }
    }

    await completeClaimWithRetry(repository, activeClaim, {
      wait: options.wait,
      now: options.now,
    });
    await updateOriginalInteractionSafely(raw, message.closeSuccessText, fetcher);
    return { status: "closed" as const, channelId: activeClaim.ticketChannelId };
  } catch (error) {
    if (
      activeClaim &&
      (deletionOutcome === "not_attempted" || deletionOutcome === "not_removed")
    ) {
      try {
        await repository.release({
          orderId: activeClaim.orderId,
          claimToken: activeClaim.claimToken,
        });
      } catch (releaseError) {
        logCloseError("release", releaseError);
      }
    }
    const content =
      error instanceof DiscordTicketCloseError && error.reason === "unauthorized"
        ? message.closeUnauthorizedText
        : message.closeUnavailableText;
    await updateOriginalInteractionSafely(raw, content, fetcher);
    logCloseError("completion", error);
    return {
      status:
        error instanceof DiscordTicketCloseError && error.reason === "unauthorized"
          ? ("unauthorized" as const)
          : ("unavailable" as const),
    };
  }
}

async function completeClaimWithRetry(
  repository: DiscordTicketCloseRepository,
  claim: { orderId: string; ticketChannelId: string; claimToken: string },
  options: {
    wait?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  } = {},
) {
  const wait = options.wait ?? delay;
  const now = options.now ?? Date.now;
  const deadline = now() + COMPLETE_RETRY_BUDGET_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= COMPLETE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0 && now() >= deadline) break;
    try {
      await repository.complete(claim);
      return;
    } catch (error) {
      lastError = error;
      const retryDelay = COMPLETE_RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined) break;
      const remainingBudget = deadline - now();
      if (remainingBudget <= 0) break;
      await wait(Math.min(retryDelay, remainingBudget));
    }
  }
  throw lastError ?? new Error("Falha desconhecida ao concluir o fechamento do ticket.");
}

function readCloseInteractionContext(raw: unknown, requireFollowup = false) {
  const context = readDiscordInteraction(raw, "");
  if (!isObject(raw)) return null;
  const applicationId = typeof raw.application_id === "string" ? raw.application_id : "";
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const channelId = typeof raw.channel_id === "string" ? raw.channel_id : "";
  const token = typeof raw.token === "string" ? raw.token : "";
  if (
    !context.interactionId ||
    !context.guildId ||
    !context.userId ||
    !SNOWFLAKE_PATTERN.test(channelId) ||
    !configuredApplicationId ||
    applicationId !== configuredApplicationId ||
    !SNOWFLAKE_PATTERN.test(applicationId) ||
    (requireFollowup && !INTERACTION_TOKEN_PATTERN.test(token))
  ) {
    return null;
  }
  return {
    interactionId: context.interactionId,
    guildId: context.guildId,
    userId: context.userId,
    channelId,
    applicationId,
    token,
  };
}

async function updateOriginalInteraction(
  raw: unknown,
  content: string,
  fetcher: typeof fetch,
) {
  const context = readCloseInteractionContext(raw, true);
  if (!context) throw new Error("Interação Discord incompleta para fechamento.");
  const response = await fetcher(
    `${discordApiUrl()}/webhooks/${context.applicationId}/${context.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, components: [], allowed_mentions: { parse: [] } }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord recusou a atualização do fechamento (${response.status}).`);
  }
}

async function updateOriginalInteractionSafely(
  raw: unknown,
  content: string,
  fetcher: typeof fetch,
) {
  try {
    await updateOriginalInteraction(raw, content, fetcher);
  } catch (error) {
    logCloseError("interaction_update", error);
  }
}

function deferredResponse() {
  return {
    type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
    data: { flags: DISCORD_EPHEMERAL_FLAG },
  } as const;
}

function ephemeralResponse(content: string) {
  return {
    type: DISCORD_CHANNEL_MESSAGE,
    data: {
      content: interpolateBotMessageLimited(content, {}, 1_000),
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
      components: [],
    },
  };
}

function buildInteractionId(prefix: string, orderId: string) {
  const normalized = orderId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error("ID do pedido inválido.");
  return `${prefix}${normalized}`;
}

function readOrderId(customId: string, prefix: string) {
  if (!customId.startsWith(prefix)) return null;
  const orderId = customId.slice(prefix.length);
  return UUID_PATTERN.test(orderId) ? orderId.toLowerCase() : null;
}

function repositoryError(error: { code?: string; message: string }) {
  return error.code === "42501"
    ? new DiscordTicketCloseError("unauthorized", error.message)
    : new DiscordTicketCloseError("unavailable", error.message);
}

function assertStoredTicketChannel(
  channel: { id: string; guild_id?: string; type: number; topic?: string | null },
  orderId: string,
  guildId: string,
  channelId: string,
) {
  const marker = `gwstore-order:${orderId}`;
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

function requireAdminClient() {
  const client = createAdminSupabaseClient();
  if (!client) {
    throw new DiscordTicketCloseError("unavailable", "Supabase server-only não configurado.");
  }
  return client;
}

function logCloseError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-ticket-close:${operation}] ${message}`);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
