import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import { discordBotRequest } from "./discord-api";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const TICKET_CLOSE_LEASE_MS = 5 * 60 * 1_000;
const MAXIMUM_RECONCILIATION_CANDIDATES = 100;
const DEFAULT_RECONCILIATION_CONCURRENCY = 4;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type DiscordTicketCloseReconciliationCandidate = {
  orderId: string;
  ticketChannelId: string;
  claimToken: string;
  claimedAt: string;
};

export type DiscordTicketCloseReconciliationResult = {
  scanned: number;
  completed: number;
  alreadyClosed: number;
  released: number;
  superseded: number;
  active: number;
  failed: number;
};

export interface DiscordTicketCloseReconciliationRepository {
  listClaims(limit: number): Promise<DiscordTicketCloseReconciliationCandidate[]>;
  complete(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<boolean>;
  release(input: { orderId: string; claimToken: string }): Promise<boolean>;
}

export class SupabaseDiscordTicketCloseReconciliationRepository
  implements DiscordTicketCloseReconciliationRepository
{
  constructor(private readonly client: AdminClient = requireAdminClient()) {}

  async listClaims(limit: number): Promise<DiscordTicketCloseReconciliationCandidate[]> {
    const { data, error } = await this.client
      .from("orders")
      .select(
        "id,discord_ticket_channel_id,discord_ticket_close_claim_token,discord_ticket_close_claimed_at",
      )
      .eq("discord_ticket_status", "open")
      .not("discord_ticket_channel_id", "is", null)
      .not("discord_ticket_close_claim_token", "is", null)
      .not("discord_ticket_close_claimed_at", "is", null)
      .order("discord_ticket_close_claimed_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Falha ao listar fechamentos pendentes: ${error.message}`);

    return (data ?? []).map((row) => {
      const orderId = row.id;
      const ticketChannelId = row.discord_ticket_channel_id;
      const claimToken = row.discord_ticket_close_claim_token;
      const claimedAt = row.discord_ticket_close_claimed_at;
      if (
        !UUID_PATTERN.test(orderId) ||
        !ticketChannelId ||
        !SNOWFLAKE_PATTERN.test(ticketChannelId) ||
        !claimToken ||
        !UUID_PATTERN.test(claimToken) ||
        !claimedAt ||
        Number.isNaN(Date.parse(claimedAt))
      ) {
        throw new Error(`Pedido ${orderId} possui uma reserva de fechamento inválida.`);
      }
      return { orderId, ticketChannelId, claimToken, claimedAt };
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
      })
      .single();
    if (error) throw new Error(`Falha ao concluir fechamento pendente: ${error.message}`);
    return data.was_closed;
  }

  async release(input: { orderId: string; claimToken: string }): Promise<boolean> {
    const { data, error } = await this.client
      .rpc("release_discord_ticket_close", {
        p_order_id: input.orderId,
        p_claim_token: input.claimToken,
      })
      .single();
    if (error) throw new Error(`Falha ao liberar fechamento pendente: ${error.message}`);
    return data.released;
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

  const concurrency = Math.min(
    Math.max(Math.trunc(options.concurrency ?? DEFAULT_RECONCILIATION_CONCURRENCY), 1),
    claims.length,
  );
  let cursor = 0;

  async function worker() {
    while (cursor < claims.length) {
      const claim = claims[cursor++];
      try {
        await reconcileClaim(claim, repository, fetcher, now(), result);
      } catch (error) {
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
  observedAt: number,
  result: DiscordTicketCloseReconciliationResult,
) {
  const channelResponse = await discordBotRequest(
    `/channels/${claim.ticketChannelId}`,
    {},
    fetcher,
  );

  if (channelResponse.status === 404) {
    const wasClosed = await repository.complete(claim);
    if (wasClosed) result.completed += 1;
    else result.alreadyClosed += 1;
    return;
  }

  if (!channelResponse.ok) {
    throw new Error(`Discord recusou a leitura do ticket (${channelResponse.status}).`);
  }

  const channel: unknown = await channelResponse.json();
  if (!isObject(channel) || channel.id !== claim.ticketChannelId) {
    throw new Error("Discord retornou outro canal durante a reconciliação.");
  }

  const claimedAt = Date.parse(claim.claimedAt);
  if (claimedAt > observedAt - TICKET_CLOSE_LEASE_MS) {
    result.active += 1;
    return;
  }

  const released = await repository.release({
    orderId: claim.orderId,
    claimToken: claim.claimToken,
  });
  if (released) result.released += 1;
  else result.superseded += 1;
}

function emptyResult(scanned: number): DiscordTicketCloseReconciliationResult {
  return {
    scanned,
    completed: 0,
    alreadyClosed: 0,
    released: 0,
    superseded: 0,
    active: 0,
    failed: 0,
  };
}

function requireAdminClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
