import "server-only";

import { ROBUX_SALES_ENABLED } from "@/lib/brand";
import { DiscordApiError } from "@/lib/bot/discord-api";
import { synchronizeDiscordCustomerRankRole } from "@/lib/bot/discord-customer-rank";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

/** Refresh a buyer's role (or acknowledge their absence) for purchases already paid. */
export async function synchronizeRobuxCustomerRankRole(
  input: { guildId?: string; discordGuildId: string; buyerDiscordId: string },
  client: AdminClient = requireClient(),
  synchronize = synchronizeDiscordCustomerRankRole,
) {
  const startedAt = new Date().toISOString();
  let guildId = input.guildId;
  if (!guildId) {
    const guild = await client.from("guilds").select("id")
      .eq("discord_guild_id", input.discordGuildId)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    if (guild.error || !guild.data) throw new Error("Servidor do comprador de Robux não encontrado.");
    guildId = guild.data.id;
  }
  await synchronize({
    guildId,
    discordGuildId: input.discordGuildId,
    buyerDiscordId: input.buyerDiscordId,
  });
  const { error } = await client.from("robux_orders").update({
    customer_rank_role_synced_at: new Date().toISOString(),
  }).eq("guild_id", guildId)
    .eq("buyer_discord_id", input.buyerDiscordId)
    .eq("payment_status", "paid")
    .eq("status", "paid")
    .is("customer_rank_role_synced_at", null)
    .lte("paid_at", startedAt);
  if (error) throw new Error("Falha ao registrar sincronização do cargo de Robux.");
}

/** The existing five-minute cron also repairs paid buyers from before this fix. */
export async function reconcileRobuxCustomerRankRoles(
  client: AdminClient = requireClient(),
  synchronize = synchronizeRobuxCustomerRankRole,
) {
  const result = { checked: 0, synced: 0, failed: 0 };
  if (!ROBUX_SALES_ENABLED) return result;
  const retryBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await client.from("robux_orders")
    .select("id,guild_id,buyer_discord_id,guilds!inner(discord_guild_id)")
    .eq("payment_status", "paid")
    .eq("status", "paid")
    .is("customer_rank_role_synced_at", null)
    .or(`customer_rank_role_sync_attempted_at.is.null,customer_rank_role_sync_attempted_at.lt.${retryBefore}`)
    .order("customer_rank_role_sync_attempted_at", { ascending: true, nullsFirst: true })
    .limit(15);
  if (error) throw new Error("Falha ao consultar cargos de compradores de Robux.");

  const seen = new Set<string>();
  for (const order of data ?? []) {
    const key = `${order.guild_id}:${order.buyer_discord_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.checked++;
    const attempt = await client.from("robux_orders").update({
      customer_rank_role_sync_attempted_at: new Date().toISOString(),
    }).eq("id", order.id).is("customer_rank_role_synced_at", null);
    if (attempt.error) {
      result.failed++;
      continue;
    }
    try {
      const guild = Array.isArray(order.guilds) ? order.guilds[0] : order.guilds;
      if (!guild?.discord_guild_id) throw new Error("Servidor Discord não encontrado.");
      await synchronize({
        guildId: order.guild_id,
        discordGuildId: guild.discord_guild_id,
        buyerDiscordId: order.buyer_discord_id,
      }, client);
      result.synced++;
    } catch (syncError) {
      result.failed++;
      const details = syncError instanceof DiscordApiError
        ? ` [${syncError.method} ${syncError.path}; código=${syncError.discordCode ?? "desconhecido"}]`
        : "";
      console.error(`[robux-rank:${order.id}] ${syncError instanceof Error ? syncError.message : "erro desconhecido"}${details}`);
    }
  }
  return result;
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado para cargos de Robux.");
  return client;
}
