import "server-only";

import { randomInt, randomUUID } from "node:crypto";

import { publishGiveawayAnnouncement, ensureGiveawayWinnerTicket, type GiveawayPrize } from "@/lib/giveaways/discord";
import { getDiscordGuildMembership } from "@/lib/giveaways/discord-membership";
import { getGiveawayAnnouncementInput } from "@/lib/giveaways/repository";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

const MAX_REFERRALS_PER_RUN = 250;
const MAX_DRAWS_PER_RUN = 10;
const MAX_TICKETS_PER_RUN = 10;
const DISCORD_CONCURRENCY = 4;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type GiveawayReconciliationResult = {
  activated: number;
  referralsChecked: number;
  referralsValidated: number;
  referralsInvalidated: number;
  drawsCompleted: number;
  drawsWithoutWinner: number;
  ticketsOpened: number;
  failures: number;
};

export async function reconcileGiveaways(
  options: { client?: AdminClient; fetcher?: typeof fetch; now?: () => number } = {},
): Promise<GiveawayReconciliationResult> {
  const client = options.client ?? requireAdminClient();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const result: GiveawayReconciliationResult = {
    activated: 0,
    referralsChecked: 0,
    referralsValidated: 0,
    referralsInvalidated: 0,
    drawsCompleted: 0,
    drawsWithoutWinner: 0,
    ticketsOpened: 0,
    failures: 0,
  };

  const activation = await client.rpc("activate_due_giveaways");
  if (activation.error) throw new Error(`Falha ao ativar sorteios: ${activation.error.message}`);
  result.activated = Number(activation.data ?? 0);

  await reconcilePendingReferrals(client, fetcher, now(), result);
  await drawDueGiveaways(client, fetcher, result);
  await openWinnerTickets(client, fetcher, result);
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
    .order("joined_at")
    .limit(MAX_REFERRALS_PER_RUN);
  if (error) throw new Error(`Falha ao listar indicações pendentes: ${error.message}`);
  if (!referrals?.length) return;

  const giveawayIds = [...new Set(referrals.map((referral) => referral.giveaway_id))];
  const { data: giveaways, error: giveawayError } = await client
    .from("giveaways")
    .select("id,guild_id,status,minimum_stay_minutes")
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
    if (Date.parse(referral.joined_at) + giveaway.minimum_stay_minutes * 60_000 > now) return;
    const discordGuildId = guildMap.get(giveaway.guild_id);
    if (!discordGuildId) return;
    try {
      const membership = await getDiscordGuildMembership(
        discordGuildId,
        referral.invitee_discord_user_id,
        fetcher,
      );
      result.referralsChecked += 1;
      if (!membership.exists) {
        await setReferralStatus(client, referral.id, "invalid", "Saiu do servidor antes da validação.");
        result.referralsInvalidated += 1;
      } else if (!membership.pending) {
        await setReferralStatus(client, referral.id, "valid", null);
        result.referralsValidated += 1;
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
  result: GiveawayReconciliationResult,
) {
  for (let index = 0; index < MAX_DRAWS_PER_RUN; index += 1) {
    const claimToken = randomUUID();
    const { data: claim, error } = await client
      .rpc("claim_due_giveaway", { p_claim_token: claimToken })
      .maybeSingle();
    if (error) throw new Error(`Falha ao reservar sorteio: ${error.message}`);
    if (!claim) return;

    try {
      await revalidateGiveawayReferrals(
        client,
        claim.giveaway_id,
        claim.discord_guild_id,
        fetcher,
        result,
      );
      const { data: entries, error: entryError } = await client
        .from("giveaway_entries")
        .select("id,discord_user_id")
        .eq("giveaway_id", claim.giveaway_id)
        .gte("valid_invite_count", claim.required_valid_invites)
        .order("id")
        .limit(2_000);
      if (entryError) throw new Error(entryError.message);

      const eligible: Array<{ id: string; discord_user_id: string }> = [];
      await mapConcurrent(entries ?? [], DISCORD_CONCURRENCY, async (entry) => {
        const membership = await getDiscordGuildMembership(
          claim.discord_guild_id,
          entry.discord_user_id,
          fetcher,
        );
        if (membership.exists && !membership.pending) eligible.push(entry);
      });
      const winner = eligible.length ? eligible[randomInt(eligible.length)] : null;
      const { data: completed, error: completionError } = await client
        .rpc("complete_giveaway_draw", {
          p_giveaway_id: claim.giveaway_id,
          p_claim_token: claimToken,
          p_winner_entry_id: winner?.id ?? null,
        })
        .single();
      if (completionError || !completed) {
        throw new Error(completionError?.message || "Sorteio não retornou resultado.");
      }
      if (completed.resulting_status === "completed") result.drawsCompleted += 1;
      else result.drawsWithoutWinner += 1;
      await refreshAnnouncement(client, claim.giveaway_id, fetcher, result);
    } catch (error) {
      result.failures += 1;
      console.error(`[giveaway:draw:${claim.giveaway_id}] ${errorMessage(error)}`);
    }
  }
}

async function revalidateGiveawayReferrals(
  client: AdminClient,
  giveawayId: string,
  discordGuildId: string,
  fetcher: typeof fetch,
  result: GiveawayReconciliationResult,
) {
  const [{ data: giveaway, error: giveawayError }, { data: referrals, error }] = await Promise.all([
    client
      .from("giveaways")
      .select("minimum_stay_minutes")
      .eq("id", giveawayId)
      .single(),
    client
    .from("giveaway_referrals")
    .select("id,invitee_discord_user_id,status,joined_at")
    .eq("giveaway_id", giveawayId)
    .in("status", ["pending", "valid"])
    .limit(5_000),
  ]);
  if (giveawayError || !giveaway) throw new Error(giveawayError?.message || "Sorteio não encontrado.");
  if (error) throw new Error(error.message);
  const now = Date.now();
  await mapConcurrent(referrals ?? [], DISCORD_CONCURRENCY, async (referral) => {
    const membership = await getDiscordGuildMembership(
      discordGuildId,
      referral.invitee_discord_user_id,
      fetcher,
    );
    result.referralsChecked += 1;
    if (!membership.exists || membership.pending && referral.status === "valid") {
      await setReferralStatus(
        client,
        referral.id,
        "invalid",
        membership.exists
          ? "Não concluiu a verificação do servidor."
          : "Não permaneceu no servidor até o sorteio.",
      );
      result.referralsInvalidated += 1;
    } else if (
      !membership.pending &&
      referral.status === "pending" &&
      Date.parse(referral.joined_at) + giveaway.minimum_stay_minutes * 60_000 <= now
    ) {
      await setReferralStatus(client, referral.id, "valid", null);
      result.referralsValidated += 1;
    }
  });
}

async function openWinnerTickets(
  client: AdminClient,
  fetcher: typeof fetch,
  result: GiveawayReconciliationResult,
) {
  for (let index = 0; index < MAX_TICKETS_PER_RUN; index += 1) {
    const claimToken = randomUUID();
    const { data: claim, error } = await client
      .rpc("claim_giveaway_ticket", { p_claim_token: claimToken })
      .maybeSingle();
    if (error) throw new Error(`Falha ao reservar ticket de sorteio: ${error.message}`);
    if (!claim) return;
    try {
      const prizes = parsePrizes(claim.prizes);
      const ticket = await ensureGiveawayWinnerTicket(
        {
          giveawayId: claim.giveaway_id,
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
        "complete_giveaway_ticket",
        {
          p_giveaway_id: claim.giveaway_id,
          p_claim_token: claimToken,
          p_channel_id: ticket.channelId,
        },
      );
      if (completionError || !completed) throw new Error(completionError?.message || "Reserva de ticket substituída.");
      result.ticketsOpened += 1;
    } catch (error) {
      result.failures += 1;
      const message = errorMessage(error);
      await client.rpc("fail_giveaway_ticket", {
        p_giveaway_id: claim.giveaway_id,
        p_claim_token: claimToken,
        p_error: message,
      });
      console.error(`[giveaway:ticket:${claim.giveaway_id}] ${message}`);
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
