import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import {
  DiscordTicketChannelMissingError,
  synchronizeOpenDiscordTicketControls,
} from "./discord-ticket-controls";
import {
  loadBotRuntimeSettingsStrict,
  type BotRuntimeSettings,
} from "./message-customization-server";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

type OpenTicketRow = {
  id: string;
  guild_id: string;
  buyer_discord_id: string;
  discord_ticket_channel_id: string | null;
};

export type OpenDiscordTicketControlsSyncResult = {
  processed: number;
  synchronized: number;
  missingChannelsClosed: number;
  failed: number;
  permissionsUpdated: number;
  welcomeMessagesUpdated: number;
};

const OPEN_TICKET_SYNC_PAGE_SIZE = 500;
const DEFAULT_SYNC_CONCURRENCY = 4;

/**
 * Repairs permissions and action buttons on tickets that were already open
 * when the close-admin list or close-message customization changed.
 */
export async function synchronizeAllOpenDiscordTicketControls(
  options: {
    client?: AdminClient | null;
    fetcher?: typeof fetch;
    concurrency?: number;
    settings?: BotRuntimeSettings;
  } = {},
): Promise<OpenDiscordTicketControlsSyncResult> {
  const client = options.client ?? createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");

  const [settings, firstPage] = await Promise.all([
    options.settings
      ? Promise.resolve(options.settings)
      : loadBotRuntimeSettingsStrict(client),
    loadOpenTicketPage(client, null),
  ]);
  const result = emptyResult();
  let page = firstPage;
  let lastOrderId: string | null = null;

  while (page.length > 0) {
    await synchronizeOpenTicketPage(client, page, settings, result, {
      concurrency: options.concurrency,
      fetcher: options.fetcher,
    });

    if (page.length < OPEN_TICKET_SYNC_PAGE_SIZE) break;
    const nextOrderId = page[page.length - 1]?.id;
    if (!nextOrderId || (lastOrderId !== null && nextOrderId <= lastOrderId)) {
      throw new Error("A paginação dos tickets abertos retornou um cursor inválido.");
    }
    lastOrderId = nextOrderId;
    page = await loadOpenTicketPage(client, lastOrderId);
  }

  return result;
}

async function loadOpenTicketPage(
  client: AdminClient,
  afterOrderId: string | null,
): Promise<OpenTicketRow[]> {
  let query = client
    .from("orders")
    .select("id,guild_id,buyer_discord_id,discord_ticket_channel_id")
    .eq("discord_ticket_status", "open")
    .not("discord_ticket_channel_id", "is", null);
  if (afterOrderId) query = query.gt("id", afterOrderId);

  const { data, error } = await query
    .order("id", { ascending: true })
    .limit(OPEN_TICKET_SYNC_PAGE_SIZE);
  if (error) {
    throw new Error(`Não foi possível carregar os tickets abertos: ${error.message}`);
  }
  return (data ?? []) as OpenTicketRow[];
}

async function synchronizeOpenTicketPage(
  client: AdminClient,
  orders: OpenTicketRow[],
  settings: BotRuntimeSettings,
  result: OpenDiscordTicketControlsSyncResult,
  options: { concurrency?: number; fetcher?: typeof fetch },
) {
  const guildIds = [...new Set(orders.map((order) => order.guild_id))];
  const { data: guildData, error: guildError } = await client
    .from("guilds")
    .select("id,discord_guild_id")
    .in("id", guildIds);
  if (guildError) {
    throw new Error(`Não foi possível carregar os servidores dos tickets: ${guildError.message}`);
  }

  const discordGuildIds = new Map(
    (guildData ?? []).map((guild) => [guild.id, guild.discord_guild_id]),
  );
  result.processed += orders.length;
  let cursor = 0;
  const concurrency = Math.min(
    Math.max(Math.trunc(options.concurrency ?? DEFAULT_SYNC_CONCURRENCY), 1),
    orders.length,
  );

  async function worker() {
    while (cursor < orders.length) {
      const order = orders[cursor++];
      const guildId = discordGuildIds.get(order.guild_id);
      const channelId = order.discord_ticket_channel_id;
      if (!guildId || !channelId) {
        result.failed += 1;
        continue;
      }

      try {
        const repaired = await synchronizeOpenDiscordTicketControls(
          {
            orderId: order.id,
            guildId,
            buyerDiscordId: order.buyer_discord_id,
            channelId,
            settings,
          },
          { fetcher: options.fetcher },
        );
        result.synchronized += 1;
        if (repaired.permissionsUpdated) result.permissionsUpdated += 1;
        if (repaired.welcomeMessageUpdated) result.welcomeMessagesUpdated += 1;
      } catch (error) {
        if (
          error instanceof DiscordTicketChannelMissingError &&
          error.orderId === order.id &&
          error.channelId === channelId
        ) {
          try {
            const wasClosed = await reconcileMissingDiscordTicket(
              client,
              order.id,
              channelId,
            );
            if (wasClosed) result.missingChannelsClosed += 1;
          } catch (reconciliationError) {
            result.failed += 1;
            logTicketSyncError(order.id, reconciliationError);
          }
          continue;
        }
        result.failed += 1;
        logTicketSyncError(order.id, error);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function reconcileMissingDiscordTicket(
  client: AdminClient,
  orderId: string,
  channelId: string,
) {
  const { data, error } = await client
    .rpc("reconcile_missing_discord_ticket", {
      p_order_id: orderId,
      p_ticket_channel_id: channelId,
    })
    .single();
  if (error) {
    throw new Error(`Não foi possível reconciliar o ticket ausente: ${error.message}`);
  }
  if (
    !isObject(data) ||
    data.reconciled_order_id !== orderId ||
    typeof data.was_closed !== "boolean" ||
    data.ticket_status !== "closed" ||
    data.ticket_channel_id !== channelId ||
    typeof data.closed_at !== "string" ||
    Number.isNaN(Date.parse(data.closed_at)) ||
    (data.closed_by_discord_user_id !== null &&
      typeof data.closed_by_discord_user_id !== "string")
  ) {
    throw new Error("Supabase retornou uma reconciliação de ticket inválida.");
  }
  return data.was_closed;
}

function logTicketSyncError(orderId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-ticket-controls-sync:${orderId}] ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emptyResult(): OpenDiscordTicketControlsSyncResult {
  return {
    processed: 0,
    synchronized: 0,
    missingChannelsClosed: 0,
    failed: 0,
    permissionsUpdated: 0,
    welcomeMessagesUpdated: 0,
  };
}
