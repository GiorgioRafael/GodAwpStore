import "server-only";

import { randomUUID } from "node:crypto";

import {
  ensureGiveawayWinnerTicket,
  publishGiveawayAnnouncement,
  publishGiveawayResultAnnouncement,
  type GiveawayPrize,
} from "@/lib/giveaways/discord";
import {
  getDiscordGuildMembership,
  type DiscordGuildMembership,
} from "@/lib/giveaways/discord-membership";
import { getGiveawayAnnouncementInput } from "@/lib/giveaways/repository";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

const MAX_REFERRALS_PER_RUN = 50;
const MAX_DRAWS_PER_RUN = 2;
const MAX_TICKETS_PER_RUN = 10;
const DRAW_RECONCILIATION_BATCH_SIZE = 200;
const DISCORD_CONCURRENCY = 4;
const DRAW_DISCORD_CONCURRENCY = 1;
const DISCORD_JOIN_TIME_TOLERANCE_MS = 1_000;
const RECONCILIATION_BUDGET_MS = 240_000;
const DRAW_BATCH_BUDGET_MS = 120_000;
const TICKET_BATCH_BUDGET_MS = 20_000;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type GiveawayReconciliationResult = {
  activated: number;
  referralsChecked: number;
  referralsValidated: number;
  referralsInvalidated: number;
  drawsCompleted: number;
  drawsWithoutWinner: number;
  drawsDeferred: number;
  resultsPublished: number;
  ticketsOpened: number;
  failures: number;
};

export async function reconcileGiveaways(
  options: { client?: AdminClient; fetcher?: typeof fetch; now?: () => number } = {},
): Promise<GiveawayReconciliationResult> {
  const client = options.client ?? requireAdminClient();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const deadline = Date.now() + RECONCILIATION_BUDGET_MS;
  const result: GiveawayReconciliationResult = {
    activated: 0,
    referralsChecked: 0,
    referralsValidated: 0,
    referralsInvalidated: 0,
    drawsCompleted: 0,
    drawsWithoutWinner: 0,
    drawsDeferred: 0,
    resultsPublished: 0,
    ticketsOpened: 0,
    failures: 0,
  };

  const activation = await client.rpc("activate_due_giveaways_v2");
  if (activation.error) throw new Error(`Falha ao ativar sorteios: ${activation.error.message}`);
  const activatedIds = (activation.data ?? []).map((row) => row.giveaway_id);
  result.activated = activatedIds.length;
  await mapConcurrent(activatedIds, DISCORD_CONCURRENCY, async (giveawayId) => {
    await refreshAnnouncement(client, giveawayId, fetcher, result);
  });

  await reconcilePendingReferrals(client, fetcher, now(), result);
  if (Date.now() < deadline) await drawDueGiveaways(client, fetcher, deadline, result);
  if (Date.now() < deadline) {
    await publishPendingResultAnnouncements(client, fetcher, result);
  }
  if (Date.now() < deadline) await openWinnerTickets(client, fetcher, deadline, result);
  return result;
}

async function reconcilePendingReferrals(
  client: AdminClient,
  fetcher: typeof fetch,
  now: number,
  result: GiveawayReconciliationResult,
) {
  const { data: referrals, error } = await client
    .from("giveaway_referrals")
    .select("id,giveaway_id,invitee_discord_user_id,joined_at")
    .eq("status", "pending")
    .not("join_completed_at", "is", null)
    .order("joined_at")
    .limit(MAX_REFERRALS_PER_RUN);
  if (error) throw new Error(`Falha ao listar indicações pendentes: ${error.message}`);
  if (!referrals?.length) return;

  const giveawayIds = [...new Set(referrals.map((referral) => referral.giveaway_id))];
  const { data: giveaways, error: giveawayError } = await client
    .from("giveaways")
    .select("id,guild_id,status,minimum_stay_minutes,ends_at")
    .in("id", giveawayIds)
    .in("status", ["active", "drawing"]);
  if (giveawayError) throw new Error(`Falha ao carregar sorteios ativos: ${giveawayError.message}`);
  const guildIds = [...new Set((giveaways ?? []).map((giveaway) => giveaway.guild_id))];
  const { data: guilds, error: guildError } = guildIds.length
    ? await client.from("guilds").select("id,discord_guild_id").in("id", guildIds)
    : { data: [], error: null };
  if (guildError) throw new Error(`Falha ao carregar servidores: ${guildError.message}`);
  const giveawayMap = new Map((giveaways ?? []).map((giveaway) => [giveaway.id, giveaway]));
  const guildMap = new Map((guilds ?? []).map((guild) => [guild.id, guild.discord_guild_id]));

  await mapConcurrent(referrals, DISCORD_CONCURRENCY, async (referral) => {
    const giveaway = giveawayMap.get(referral.giveaway_id);
    if (!giveaway) return;
    const validationCutoff = Math.min(now, Date.parse(giveaway.ends_at));
    if (Date.parse(referral.joined_at) + giveaway.minimum_stay_minutes * 60_000 > validationCutoff) return;
    const discordGuildId = guildMap.get(giveaway.guild_id);
    if (!discordGuildId) return;
    try {
      const membership = await getDiscordGuildMembership(
        discordGuildId,
        referral.invitee_discord_user_id,
        fetcher,
      );
      result.referralsChecked += 1;
      const decision = evaluateReferralMembership(
        referral.joined_at,
        membership,
        giveaway.minimum_stay_minutes,
        validationCutoff,
        false,
      );
      if (decision.status !== "pending") {
        await setReferralStatus(client, referral.id, decision.status, decision.reason);
        if (decision.status === "valid") result.referralsValidated += 1;
        else result.referralsInvalidated += 1;
      }
    } catch (error) {
      result.failures += 1;
      console.error(`[giveaway:referral:${referral.id}] ${errorMessage(error)}`);
    }
  });
}

async function drawDueGiveaways(
  client: AdminClient,
  fetcher: typeof fetch,
  deadline: number,
  result: GiveawayReconciliationResult,
) {
  for (let index = 0; index < MAX_DRAWS_PER_RUN; index += 1) {
    if (Date.now() + DRAW_BATCH_BUDGET_MS >= deadline) return;
    const claimToken = randomUUID();
    const { data: claim, error } = await client
      .rpc("claim_due_giveaway_v2", { p_claim_token: claimToken })
      .maybeSingle();
    if (error) throw new Error(`Falha ao reservar sorteio: ${error.message}`);
    if (!claim) return;

    try {
      if (!await hasPotentiallyEligibleEntry(client, claim)) {
        const completed = await completeGiveawayDraw(
          client,
          claim.giveaway_id,
          claimToken,
          null,
        );
        result.drawsWithoutWinner += 1;
        await refreshAnnouncement(client, completed.completed_giveaway_id, fetcher, result);
        continue;
      }
      const referralsReady = await revalidateGiveawayReferralBatch(
        client,
        claim,
        claimToken,
        fetcher,
        Date.parse(claim.ends_at),
        result,
      );
      if (!referralsReady) {
        result.drawsDeferred += 1;
        continue;
      }
      const entriesReady = await revalidateGiveawayEntryBatch(
        client,
        claim,
        claimToken,
        fetcher,
        result,
      );
      if (!entriesReady) {
        result.drawsDeferred += 1;
        continue;
      }
      const { data: winner, error: winnerError } = await client
        .rpc("pick_giveaway_winner", {
          p_giveaway_id: claim.giveaway_id,
          p_claim_token: claimToken,
        })
        .maybeSingle();
      if (winnerError) throw new Error(winnerError.message);
      const completed = await completeGiveawayDraw(
        client,
        claim.giveaway_id,
        claimToken,
        winner?.entry_id ?? null,
      );
      if (completed.resulting_status === "completed") result.drawsCompleted += 1;
      else result.drawsWithoutWinner += 1;
      await refreshAnnouncement(client, claim.giveaway_id, fetcher, result);
      if (completed.resulting_status === "completed") {
        await publishResultAnnouncement(client, claim.giveaway_id, fetcher, result);
      }
    } catch (error) {
      result.failures += 1;
      console.error(`[giveaway:draw:${claim.giveaway_id}] ${errorMessage(error)}`);
    }
  }
}

type DrawClaim = {
  giveaway_id: string;
  discord_guild_id: string;
  required_valid_invites: number;
  minimum_stay_minutes: number;
  ends_at: string;
};

async function hasPotentiallyEligibleEntry(
  client: AdminClient,
  claim: DrawClaim,
) {
  const { data, error } = await client
    .from("giveaway_entries")
    .select("id")
    .eq("giveaway_id", claim.giveaway_id)
    .gte("valid_invite_count", claim.required_valid_invites)
    .limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

async function completeGiveawayDraw(
  client: AdminClient,
  giveawayId: string,
  claimToken: string,
  winnerEntryId: string | null,
) {
  const { data, error } = await client
    .rpc("complete_giveaway_draw_v2", {
      p_giveaway_id: giveawayId,
      p_claim_token: claimToken,
      p_winner_entry_id: winnerEntryId,
    })
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Sorteio não retornou resultado.");
  }
  return data;
}

async function revalidateGiveawayReferralBatch(
  client: AdminClient,
  claim: DrawClaim,
  claimToken: string,
  fetcher: typeof fetch,
  now: number,
  result: GiveawayReconciliationResult,
) {
  const staleFilter = `draw_checked_at.is.null,draw_checked_at.lt.${claim.ends_at}`;
  const { data: referrals, error } = await client
    .from("giveaway_referrals")
    .select("id,invitee_discord_user_id,status,joined_at")
    .eq("giveaway_id", claim.giveaway_id)
    .in("status", ["pending", "valid"])
    .not("join_completed_at", "is", null)
    .or(staleFilter)
    .order("id")
    .limit(DRAW_RECONCILIATION_BATCH_SIZE);
  if (error) throw new Error(error.message);
  await mapConcurrent(referrals ?? [], DRAW_DISCORD_CONCURRENCY, async (referral) => {
    try {
      const membership = await getDiscordGuildMembership(
        claim.discord_guild_id,
        referral.invitee_discord_user_id,
        fetcher,
      );
      result.referralsChecked += 1;
      const decision = evaluateReferralMembership(
        referral.joined_at,
        membership,
        claim.minimum_stay_minutes,
        now,
        true,
      );
      const isValid = decision.status === "valid";
      const { data, error: updateError } = await client.rpc(
        "mark_giveaway_referral_draw_status",
        {
          p_giveaway_id: claim.giveaway_id,
          p_claim_token: claimToken,
          p_referral_id: referral.id,
          p_is_valid: isValid,
          p_invalid_reason: decision.reason,
        },
      );
      if (updateError || !data) {
        throw new Error(updateError?.message || "Reserva do sorteio substituída.");
      }
      if (decision.status === "valid" && referral.status !== "valid") {
        result.referralsValidated += 1;
      } else if (decision.status === "invalid" && referral.status !== "invalid") {
        result.referralsInvalidated += 1;
      }
    } catch (error) {
      result.failures += 1;
      console.error(`[giveaway:referral:${referral.id}] ${errorMessage(error)}`);
    }
  });

  const { data: remaining, error: remainingError } = await client
    .from("giveaway_referrals")
    .select("id")
    .eq("giveaway_id", claim.giveaway_id)
    .in("status", ["pending", "valid"])
    .not("join_completed_at", "is", null)
    .or(staleFilter)
    .limit(1);
  if (remainingError) throw new Error(remainingError.message);
  return !remaining?.length;
}

async function revalidateGiveawayEntryBatch(
  client: AdminClient,
  claim: DrawClaim,
  claimToken: string,
  fetcher: typeof fetch,
  result: GiveawayReconciliationResult,
) {
  const staleFilter = `membership_checked_at.is.null,membership_checked_at.lt.${claim.ends_at}`;
  const { data: entries, error } = await client
    .from("giveaway_entries")
    .select("id,discord_user_id")
    .eq("giveaway_id", claim.giveaway_id)
    .gte("valid_invite_count", claim.required_valid_invites)
    .or(staleFilter)
    .order("id")
    .limit(DRAW_RECONCILIATION_BATCH_SIZE);
  if (error) throw new Error(error.message);

  await mapConcurrent(entries ?? [], DRAW_DISCORD_CONCURRENCY, async (entry) => {
    try {
      const membership = await getDiscordGuildMembership(
        claim.discord_guild_id,
        entry.discord_user_id,
        fetcher,
      );
      const isValid = membership.exists && !membership.pending;
      const { data, error: updateError } = await client.rpc(
        "mark_giveaway_entry_membership",
        {
          p_giveaway_id: claim.giveaway_id,
          p_claim_token: claimToken,
          p_entry_id: entry.id,
          p_is_valid: isValid,
          p_invalid_reason: isValid
            ? null
            : membership.exists
              ? "Não concluiu a verificação do servidor."
              : "Não faz mais parte do servidor.",
        },
      );
      if (updateError || !data) throw new Error(updateError?.message || "Reserva do sorteio substituída.");
    } catch (error) {
      result.failures += 1;
      console.error(`[giveaway:entry:${entry.id}] ${errorMessage(error)}`);
    }
  });

  const { data: remaining, error: remainingError } = await client
    .from("giveaway_entries")
    .select("id")
    .eq("giveaway_id", claim.giveaway_id)
    .gte("valid_invite_count", claim.required_valid_invites)
    .or(staleFilter)
    .limit(1);
  if (remainingError) throw new Error(remainingError.message);
  return !remaining?.length;
}

async function openWinnerTickets(
  client: AdminClient,
  fetcher: typeof fetch,
  deadline: number,
  result: GiveawayReconciliationResult,
) {
  for (let index = 0; index < MAX_TICKETS_PER_RUN; index += 1) {
    if (Date.now() + TICKET_BATCH_BUDGET_MS >= deadline) return;
    const claimToken = randomUUID();
    const { data: claim, error } = await client
      .rpc("claim_giveaway_winner_ticket", { p_claim_token: claimToken })
      .maybeSingle();
    if (error) throw new Error(`Falha ao reservar ticket de sorteio: ${error.message}`);
    if (!claim) return;
    try {
      const prizes = parsePrizes(claim.prizes);
      const ticket = await ensureGiveawayWinnerTicket(
        {
          giveawayId: claim.giveaway_id,
          winnerId: claim.winner_id,
          guildId: claim.discord_guild_id,
          winnerDiscordUserId: claim.winner_discord_user_id,
          winnerDisplayName: claim.winner_display_name,
          title: claim.giveaway_title,
          parentChannelId: claim.ticket_category_id,
          prizes,
        },
        { fetcher },
      );
      const { data: completed, error: completionError } = await client.rpc(
        "complete_giveaway_winner_ticket",
        {
          p_winner_id: claim.winner_id,
          p_claim_token: claimToken,
          p_channel_id: ticket.channelId,
        },
      );
      if (completionError || !completed) throw new Error(completionError?.message || "Reserva de ticket substituída.");
      result.ticketsOpened += 1;
      await refreshAnnouncement(client, claim.giveaway_id, fetcher, result);
    } catch (error) {
      result.failures += 1;
      const message = errorMessage(error);
      await client.rpc("fail_giveaway_winner_ticket", {
        p_winner_id: claim.winner_id,
        p_claim_token: claimToken,
        p_error: message,
      });
      console.error(`[giveaway:ticket:${claim.giveaway_id}:${claim.winner_id}] ${message}`);
      return;
    }
  }
}

async function refreshAnnouncement(
  client: AdminClient,
  giveawayId: string,
  fetcher: typeof fetch,
  result: GiveawayReconciliationResult,
) {
  try {
    const input = await getGiveawayAnnouncementInput(giveawayId);
    const publication = await publishGiveawayAnnouncement(input, { fetcher });
    await client.rpc("record_giveaway_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: publication.messageId,
      p_error: null,
    });
  } catch (error) {
    result.failures += 1;
    const message = errorMessage(error);
    await client.rpc("record_giveaway_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: null,
      p_error: message,
    });
  }
}

async function publishPendingResultAnnouncements(
  client: AdminClient,
  fetcher: typeof fetch,
  result: GiveawayReconciliationResult,
) {
  const { data: giveaways, error } = await client
    .from("giveaways")
    .select("id")
    .eq("status", "completed")
    .is("result_message_id", null)
    .order("drawn_at")
    .limit(10);
  if (error) throw new Error(`Falha ao listar resultados pendentes: ${error.message}`);
  for (const giveaway of giveaways ?? []) {
    await publishResultAnnouncement(client, giveaway.id, fetcher, result);
  }
}

async function publishResultAnnouncement(
  client: AdminClient,
  giveawayId: string,
  fetcher: typeof fetch,
  result: GiveawayReconciliationResult,
) {
  try {
    const input = await getGiveawayAnnouncementInput(giveawayId);
    const publication = await publishGiveawayResultAnnouncement(input, { fetcher });
    const { error } = await client.rpc("record_giveaway_result_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: publication.messageId,
      p_error: null,
    });
    if (error) throw new Error(error.message);
    result.resultsPublished += 1;
  } catch (error) {
    result.failures += 1;
    const message = errorMessage(error);
    await client.rpc("record_giveaway_result_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: null,
      p_error: message,
    });
    console.error(`[giveaway:result:${giveawayId}] ${message}`);
  }
}

async function setReferralStatus(
  client: AdminClient,
  referralId: string,
  status: "pending" | "valid" | "invalid",
  invalidReason: string | null,
) {
  const { error } = await client.rpc("set_giveaway_referral_status", {
    p_referral_id: referralId,
    p_status: status,
    p_invalid_reason: invalidReason,
  });
  if (error) throw new Error(error.message);
}

function parsePrizes(value: Json): GiveawayPrize[] {
  if (!Array.isArray(value)) throw new Error("Pacote do ticket é inválido.");
  const prizes = value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof item.product_name !== "string" ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      throw new Error("Item do pacote é inválido.");
    }
    return { productName: item.product_name, quantity: item.quantity };
  });
  if (!prizes.length) throw new Error("Pacote do ticket está vazio.");
  return prizes;
}

export function evaluateReferralMembership(
  recordedJoinedAt: string,
  membership: DiscordGuildMembership,
  minimumStayMinutes: number,
  now: number,
  finalCheck: boolean,
): { status: "pending" | "valid" | "invalid"; reason: string | null } {
  if (!membership.exists) {
    return { status: "invalid", reason: "Não permaneceu no servidor até o sorteio." };
  }
  if (!membership.joinedAt) {
    return { status: "invalid", reason: "Discord não confirmou a data de entrada no servidor." };
  }

  const recordedJoin = Date.parse(recordedJoinedAt);
  const currentJoin = Date.parse(membership.joinedAt);
  if (!Number.isFinite(recordedJoin) || !Number.isFinite(currentJoin)) {
    return { status: "invalid", reason: "Data de entrada no servidor inválida." };
  }
  if (currentJoin > recordedJoin + DISCORD_JOIN_TIME_TOLERANCE_MS) {
    return { status: "invalid", reason: "Saiu e entrou novamente após usar o convite." };
  }
  if (membership.pending) {
    return finalCheck
      ? { status: "invalid", reason: "Não concluiu a verificação do servidor." }
      : { status: "pending", reason: null };
  }
  if (currentJoin + minimumStayMinutes * 60_000 > now) {
    return finalCheck
      ? { status: "invalid", reason: "Não completou o tempo mínimo no servidor." }
      : { status: "pending", reason: null };
  }
  return { status: "valid", reason: null };
}

async function mapConcurrent<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
) {
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const value = values[cursor++];
      await operation(value);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
}

function requireAdminClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "erro desconhecido";
}
