import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import { assertConfiguredDiscordBotIdentity, assertDiscordBotGuildAccess } from "./discord-api";
import {
  DiscordTicketCloseClaimSupersededError,
  SupabaseDiscordTicketCloseReconciliationRepository,
  closeClaimedDiscordTicket,
  type DiscordTicketCloseReconciliationCandidate,
} from "./discord-ticket-close-reconciliation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const MAXIMUM_AUTO_CLOSE_CANDIDATES = 100;
const DEFAULT_AUTO_CLOSE_CONCURRENCY = 4;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type DiscordTicketAutoCloseResult = {
  claimed: number;
  completed: number;
  alreadyClosed: number;
  removed: number;
  superseded: number;
  failed: number;
};

export interface DiscordTicketAutoCloseRepository {
  claimDue(limit: number): Promise<DiscordTicketCloseReconciliationCandidate[]>;
  complete(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }): Promise<boolean>;
}

export class SupabaseDiscordTicketAutoCloseRepository
  implements DiscordTicketAutoCloseRepository
{
  private readonly closeRepository: SupabaseDiscordTicketCloseReconciliationRepository;

  constructor(private readonly client: AdminClient = requireAdminClient()) {
    this.closeRepository = new SupabaseDiscordTicketCloseReconciliationRepository(client);
  }

  async claimDue(limit: number): Promise<DiscordTicketCloseReconciliationCandidate[]> {
    const { data, error } = await this.client.rpc(
      "claim_due_delivered_discord_ticket_closes",
      { p_limit: limit },
    );
    if (error) {
      throw new Error(`Falha ao reservar tickets entregues para fechamento: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      if (
        !UUID_PATTERN.test(row.claimed_order_id) ||
        !SNOWFLAKE_PATTERN.test(row.discord_guild_id) ||
        !SNOWFLAKE_PATTERN.test(row.ticket_channel_id) ||
        !UUID_PATTERN.test(row.claim_token) ||
        typeof row.claimed_at !== "string" ||
        Number.isNaN(Date.parse(row.claimed_at))
      ) {
        throw new Error("Supabase retornou uma reserva automática de fechamento inválida.");
      }
      return {
        orderId: row.claimed_order_id,
        discordGuildId: row.discord_guild_id,
        ticketChannelId: row.ticket_channel_id,
        claimToken: row.claim_token,
        claimedAt: row.claimed_at,
      };
    });
  }

  complete(input: {
    orderId: string;
    ticketChannelId: string;
    claimToken: string;
  }) {
    return this.closeRepository.complete(input);
  }
}

export async function reconcileDeliveredDiscordTicketAutoCloses(
  options: {
    repository?: DiscordTicketAutoCloseRepository;
    fetcher?: typeof fetch;
    concurrency?: number;
    limit?: number;
  } = {},
): Promise<DiscordTicketAutoCloseResult> {
  const repository = options.repository ?? new SupabaseDiscordTicketAutoCloseRepository();
  const fetcher = options.fetcher ?? fetch;
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? MAXIMUM_AUTO_CLOSE_CANDIDATES), 1),
    MAXIMUM_AUTO_CLOSE_CANDIDATES,
  );
  const claims = await repository.claimDue(limit);
  const result = emptyResult(claims.length);
  if (claims.length === 0) return result;

  await assertConfiguredDiscordBotIdentity(fetcher);
  const concurrency = Math.min(
    Math.max(Math.trunc(options.concurrency ?? DEFAULT_AUTO_CLOSE_CONCURRENCY), 1),
    claims.length,
  );
  const guildAccessChecks = new Map<string, Promise<void>>();
  let guildAccessSequence: Promise<void> = Promise.resolve();
  let cursor = 0;

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
        await assertGuildAccessOnce(claim.discordGuildId);
        const outcome = await closeClaimedDiscordTicket(claim, repository, fetcher, {
          onChannelRemoved: () => {
            result.removed += 1;
          },
        });
        if (outcome.wasClosed) result.completed += 1;
        else result.alreadyClosed += 1;
      } catch (error) {
        if (error instanceof DiscordTicketCloseClaimSupersededError) {
          result.superseded += 1;
          continue;
        }
        result.failed += 1;
        const message = error instanceof Error ? error.message : "erro desconhecido";
        console.error(`[discord-ticket-auto-close:${claim.orderId}] ${message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

function emptyResult(claimed: number): DiscordTicketAutoCloseResult {
  return {
    claimed,
    completed: 0,
    alreadyClosed: 0,
    removed: 0,
    superseded: 0,
    failed: 0,
  };
}

function requireAdminClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}
