import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import { ensureRouletteRedemptionTicket } from "./discord";

/**
 * Opens the Discord ticket of a redemption under an exactly-once lease, so a
 * retry or a second worker never creates a duplicate channel. A failure is
 * recorded on the row and left for the reconciliation cron to retry.
 */
export async function openRouletteRedemptionTicket(redemptionId: string) {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");

  const { data, error } = await client
    .rpc("claim_roulette_redemption_ticket", {
      p_redemption_id: redemptionId,
      p_claim_token: crypto.randomUUID(),
    })
    .single();
  if (error) throw new Error("Falha na reserva do ticket de resgate.");
  if (!data.claim_succeeded) {
    return { claimed: false, channelId: data.claimed_channel_id };
  }

  try {
    const ticket = await ensureRouletteRedemptionTicket(
      {
        redemptionId: data.claimed_redemption_id,
        guildDiscordId: data.claimed_guild_discord_id,
        playerDiscordId: data.claimed_discord_user_id,
        itemSummary: data.claimed_item_summary,
        totalValueCents: data.claimed_total_value_cents,
      },
      { existingChannelId: data.claimed_channel_id },
    );
    // This path is allowed to create, so a refusal is impossible here; the
    // lease still has to be released rather than left claimed.
    if (!ticket.synchronized) throw new Error("O ticket do resgate não pôde ser preparado.");
    const { error: completeError } = await client.rpc(
      "complete_roulette_redemption_ticket",
      { p_redemption_id: redemptionId, p_channel_id: ticket.channelId },
    );
    if (completeError) throw new Error("Falha ao concluir o ticket de resgate.");
    return { claimed: true, channelId: ticket.channelId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao abrir o ticket.";
    await client
      .rpc("fail_roulette_redemption_ticket", {
        p_redemption_id: redemptionId,
        p_error: message,
      })
      .then(() => undefined, () => undefined);
    throw error;
  }
}

/**
 * Brings an already-open ticket's buttons up to date. The lease refuses to
 * re-claim an open ticket, so a redemption opened before the controls existed
 * — or one whose button labels changed in the bot settings — has no other way
 * back. It never touches the redemption state.
 */
export async function syncRouletteRedemptionTicketControls(redemptionId: string) {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");

  const { data, error } = await client
    .from("roulette_redemptions")
    .select(
      "id,discord_user_id,total_value_cents,discord_ticket_channel_id,guilds(discord_guild_id),roulette_redemption_items(product_name,quantity)",
    )
    .eq("id", redemptionId)
    .maybeSingle();
  if (error) throw new Error("Falha ao ler o resgate.");
  if (!data?.discord_ticket_channel_id || !data.guilds?.discord_guild_id) {
    return { synchronized: false as const };
  }

  const itemSummary = (data.roulette_redemption_items ?? [])
    .map((line) => `${line.quantity}x ${line.product_name}`)
    .join("\n");

  // Never create from here. The delivery button is bound to the stored channel
  // — complete_roulette_redemption_discord_delivery refuses any other with
  // P0017 — so a sync that opened a fresh channel would hand the player and the
  // staff a button that can never work, and report success while doing it.
  const ticket = await ensureRouletteRedemptionTicket(
    {
      redemptionId: data.id,
      guildDiscordId: data.guilds.discord_guild_id,
      playerDiscordId: data.discord_user_id,
      itemSummary: itemSummary || "Prêmio da roleta",
      totalValueCents: data.total_value_cents,
    },
    { existingChannelId: data.discord_ticket_channel_id, refuseCreate: true },
  );
  return ticket.synchronized
    ? { synchronized: true as const, channelId: ticket.channelId }
    : { synchronized: false as const, reason: ticket.reason };
}

/**
 * Retries every redemption whose ticket never opened. Called by the same cron
 * that reconciles the order and giveaway tickets.
 */
export async function reconcileRouletteRedemptionTickets() {
  const client = createAdminSupabaseClient();
  if (!client) return { attempted: 0, opened: 0, failed: 0 };

  const staleClaim = new Date(Date.now() - 2 * 60 * 1_000).toISOString();
  const { data, error } = await client
    .from("roulette_redemptions")
    .select("id,discord_ticket_status,discord_ticket_claimed_at")
    .eq("status", "pending")
    .in("discord_ticket_status", ["pending", "failed", "creating"])
    .order("created_at", { ascending: true })
    .limit(25);
  if (error || !data?.length) return { attempted: 0, opened: 0, failed: 0 };

  const pending = data.filter(
    (row) =>
      row.discord_ticket_status !== "creating" ||
      (row.discord_ticket_claimed_at ?? "") <= staleClaim,
  );

  let opened = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      const result = await openRouletteRedemptionTicket(row.id);
      if (result.claimed) opened += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[roleta:resgate:reconcile] ${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
    }
  }
  return { attempted: pending.length, opened, failed };
}
