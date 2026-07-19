import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordBotRequest,
  isDiscordUnknownChannelResponse,
} from "./discord-api";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const TICKET_CLOSE_LEASE_MS = 5 * 60 * 1_000;
const MAXIMUM_RECONCILIATION_CANDIDATES = 100;
const DEFAULT_RECONCILIATION_CONCURRENCY = 4;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type DiscordTicketCloseReconciliationCandidate = {
  orderId: string;
  discordGuildId: string;
  ticketChannelId: string;
  claimToken: string;
  claimedAt: string;
};

export type DiscordTicketCloseReconciliationResult = {
  scanned: number;
  completed: number;
  alreadyClosed: number;
  resumed: number;
  superseded: number;
  active: number;
  failed: number;
};

type DiscordTicketCloseClaimRenewal = "renewed" | "active" | "closed";

export interface DiscordTicketCloseReconciliationRepository {
  listClaims(limit: number): Promise<DiscordTicketCloseReconciliationCandidate[]>;
  renew(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<DiscordTicketCloseClaimRenewal>;
  complete(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<boolean>;
}

export class DiscordTicketCloseClaimSupersededError extends Error {
  constructor() {
    super("A reserva de fechamento do ticket foi substituída.");
    this.name = "DiscordTicketCloseClaimSupersededError";
  }
}

export class SupabaseDiscordTicketCloseReconciliationRepository
  implements DiscordTicketCloseReconciliationRepository
{
  constructor(private readonly client: AdminClient = requireAdminClient()) {}

  async listClaims(limit: number): Promise<DiscordTicketCloseReconciliationCandidate[]> {
    const { data, error } = await this.client
      .from("orders")
      .select(
        "id,guild_id,discord_ticket_channel_id,discord_ticket_close_claim_token,discord_ticket_close_claimed_at",
      )
      .eq("discord_ticket_status", "open")
      .not("discord_ticket_channel_id", "is", null)
      .not("discord_ticket_close_claim_token", "is", null)
      .not("discord_ticket_close_claimed_at", "is", null)
      .order("discord_ticket_close_claimed_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Falha ao listar fechamentos pendentes: ${error.message}`);

    const guildIds = [...new Set((data ?? []).map((row) => row.guild_id))];
    if (guildIds.length === 0) return [];
    const { data: guilds, error: guildError } = await this.client
      .from("guilds")
      .select("id,discord_guild_id")
      .in("id", guildIds);
    if (guildError) {
      throw new Error(`Falha ao carregar servidores dos tickets: ${guildError.message}`);
    }
    const discordGuildIds = new Map(
      (guilds ?? []).map((guild) => [guild.id, guild.discord_guild_id]),
    );

    return (data ?? []).map((row) => {
      const orderId = row.id;
      const discordGuildId = discordGuildIds.get(row.guild_id);
      const ticketChannelId = row.discord_ticket_channel_id;
      const claimToken = row.discord_ticket_close_claim_token;
      const claimedAt = row.discord_ticket_close_claimed_at;
      if (
        !UUID_PATTERN.test(orderId) ||
        !discordGuildId ||
        !SNOWFLAKE_PATTERN.test(discordGuildId) ||
        !ticketChannelId ||
        !SNOWFLAKE_PATTERN.test(ticketChannelId) ||
        !claimToken ||
        !UUID_PATTERN.test(claimToken) ||
        !claimedAt ||
        Number.isNaN(Date.parse(claimedAt))
      ) {
        throw new Error(`Pedido ${orderId} possui uma reserva de fechamento inválida.`);
      }
      return { orderId, discordGuildId, ticketChannelId, claimToken, claimedAt };
    });
  }

  async complete(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<boolean> {
    const { data, error } = await this.client
      .rpc("complete_discord_ticket_close", {
        p_order_id: input.orderId,
        p_ticket_channel_id: input.ticketChannelId,
        p_claim_token: input.claimToken,
        p_completion_source: "discord_close_reconciliation",
      })
      .single();
    if (error?.code === "42501") throw new DiscordTicketCloseClaimSupersededError();
    if (error) throw new Error(`Falha ao concluir fechamento pendente: ${error.message}`);
    if (
      data.completed_order_id !== input.orderId ||
      data.ticket_channel_id !== input.ticketChannelId ||
      data.ticket_status !== "closed" ||
      typeof data.was_closed !== "boolean" ||
      typeof data.closed_at !== "string" ||
      Number.isNaN(Date.parse(data.closed_at)) ||
      (data.closed_by_discord_user_id !== null &&
        (typeof data.closed_by_discord_user_id !== "string" ||
          !SNOWFLAKE_PATTERN.test(data.closed_by_discord_user_id)))
    ) {
      throw new Error("Supabase retornou uma conclusao de fechamento invalida.");
    }
    return data.was_closed;
  }

  async renew(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<DiscordTicketCloseClaimRenewal> {
    const { data, error } = await this.client
      .rpc("renew_discord_ticket_close_claim", {
        p_order_id: input.orderId,
        p_ticket_channel_id: input.ticketChannelId,
        p_claim_token: input.claimToken,
      })
      .single();
    if (error?.code === "42501") throw new DiscordTicketCloseClaimSupersededError();
    if (error) throw new Error(`Falha ao renovar fechamento pendente: ${error.message}`);
    if (
      data.renewed_order_id !== input.orderId ||
      data.ticket_channel_id !== input.ticketChannelId ||
      typeof data.renewed !== "boolean" ||
      typeof data.active !== "boolean"
    ) {
      throw new Error("Supabase retornou uma renovacao de fechamento invalida.");
    }
    const hasValidExpiration =
      typeof data.claim_expires_at === "string" &&
      !Number.isNaN(Date.parse(data.claim_expires_at));
    if (
      data.renewed &&
      !data.active &&
      data.ticket_status === "open" &&
      hasValidExpiration
    ) {
      return "renewed";
    }
    if (
      !data.renewed &&
      data.active &&
      data.ticket_status === "open" &&
      hasValidExpiration
    ) {
      return "active";
    }
    if (
      !data.renewed &&
      !data.active &&
      data.ticket_status === "closed" &&
      data.claim_expires_at === null
    ) {
      return "closed";
    }
    throw new Error("Supabase retornou uma renovacao de fechamento invalida.");
  }
}

export async function reconcileDiscordTicketCloseClaims(
  options: {
    repository?: DiscordTicketCloseReconciliationRepository;
    fetcher?: typeof fetch;
    now?: () => number;
    concurrency?: number;
    limit?: number;
  } = {},
): Promise<DiscordTicketCloseReconciliationResult> {
  const repository =
    options.repository ?? new SupabaseDiscordTicketCloseReconciliationRepository();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? MAXIMUM_RECONCILIATION_CANDIDATES), 1),
    MAXIMUM_RECONCILIATION_CANDIDATES,
  );
  const claims = await repository.listClaims(limit);
  const result = emptyResult(claims.length);
  if (claims.length === 0) return result;
  await assertConfiguredDiscordBotIdentity(fetcher);

  const concurrency = Math.min(
    Math.max(Math.trunc(options.concurrency ?? DEFAULT_RECONCILIATION_CONCURRENCY), 1),
    claims.length,
  );
  let cursor = 0;
  const guildAccessChecks = new Map<string, Promise<void>>();
  let guildAccessSequence: Promise<void> = Promise.resolve();

  function assertGuildAccessOnce(discordGuildId: string) {
    const existing = guildAccessChecks.get(discordGuildId);
    if (existing) return existing;

    const check = guildAccessSequence.then(async () => {
      await assertDiscordBotGuildAccess(discordGuildId, fetcher);
    });
    guildAccessChecks.set(discordGuildId, check);
    guildAccessSequence = check.catch(() => undefined);
    return check;
  }

  async function worker() {
    while (cursor < claims.length) {
      const claim = claims[cursor++];
      try {
        const claimedAt = Date.parse(claim.claimedAt);
        if (claimedAt > now() - TICKET_CLOSE_LEASE_MS) {
          result.active += 1;
          continue;
        }

        const renewal = await repository.renew(claim);
        if (renewal === "active") {
          result.active += 1;
          continue;
        }
        if (renewal === "closed") {
          result.alreadyClosed += 1;
          continue;
        }

        await assertGuildAccessOnce(claim.discordGuildId);
        await reconcileClaim(claim, repository, fetcher, result);
      } catch (error) {
        if (error instanceof DiscordTicketCloseClaimSupersededError) {
          result.superseded += 1;
          continue;
        }
        result.failed += 1;
        const message = error instanceof Error ? error.message : "erro desconhecido";
        console.error(`[discord-ticket-close-reconciliation:${claim.orderId}] ${message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

async function reconcileClaim(
  claim: DiscordTicketCloseReconciliationCandidate,
  repository: DiscordTicketCloseReconciliationRepository,
  fetcher: typeof fetch,
  result: DiscordTicketCloseReconciliationResult,
) {
  const channelResponse = await discordBotRequest(
    `/channels/${claim.ticketChannelId}`,
    {},
    fetcher,
  );

  if (await isDiscordUnknownChannelResponse(channelResponse)) {
    await assertDiscordBotGuildAccess(claim.discordGuildId, fetcher);
    const wasClosed = await repository.complete(claim);
    if (wasClosed) result.completed += 1;
    else result.alreadyClosed += 1;
    return;
  }

  if (!channelResponse.ok) {
    throw new Error(`Discord recusou a leitura do ticket (${channelResponse.status}).`);
  }

  const channel: unknown = await channelResponse.json();
  assertReconciliationTicketChannel(channel, claim);

  const deleteResponse = await discordBotRequest(
    `/channels/${claim.ticketChannelId}`,
    {
      method: "DELETE",
      headers: {
        "X-Audit-Log-Reason": encodeURIComponent(
          `GWStore ticket ${claim.orderId} resumed by reconciliation`,
        ),
      },
    },
    fetcher,
  );
  const channelIsMissing = await isDiscordUnknownChannelResponse(deleteResponse);
  if (!deleteResponse.ok && !channelIsMissing) {
    throw new Error(`Discord recusou o fechamento retomado (${deleteResponse.status}).`);
  }
  if (channelIsMissing) {
    await assertDiscordBotGuildAccess(claim.discordGuildId, fetcher);
  }
  if (deleteResponse.ok) {
    const deletedChannel: unknown = await deleteResponse.json().catch(() => null);
    if (!isObject(deletedChannel) || deletedChannel.id !== claim.ticketChannelId) {
      throw new Error("Discord retornou uma confirmação inválida do fechamento retomado.");
    }
  }

  result.resumed += 1;
  const wasClosed = await repository.complete(claim);
  if (wasClosed) result.completed += 1;
  else result.alreadyClosed += 1;
}

function emptyResult(scanned: number): DiscordTicketCloseReconciliationResult {
  return {
    scanned,
    completed: 0,
    alreadyClosed: 0,
    resumed: 0,
    superseded: 0,
    active: 0,
    failed: 0,
  };
}

function assertReconciliationTicketChannel(
  channel: unknown,
  claim: DiscordTicketCloseReconciliationCandidate,
) {
  const marker = `gwstore-order:${claim.orderId}`;
  if (
    !isObject(channel) ||
    channel.id !== claim.ticketChannelId ||
    channel.guild_id !== claim.discordGuildId ||
    channel.type !== 0 ||
    (channel.topic !== marker &&
      (typeof channel.topic !== "string" || !channel.topic.startsWith(`${marker};`)))
  ) {
    throw new Error("Canal Discord não corresponde ao ticket em reconciliação.");
  }
}

function requireAdminClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
