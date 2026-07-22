import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  CustomerRankLevel,
  CustomerRankProgress,
} from "./customer-rank";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type CustomerRankRoleBinding = {
  rankCode: string;
  discordRoleId: string;
};

export class SupabaseCustomerRankRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async getProgress(
    guildId: string,
    buyerDiscordId: string,
  ): Promise<CustomerRankProgress> {
    const { data, error } = await this.client
      .rpc("get_customer_rank_progress", {
        p_guild_id: guildId,
        p_buyer_discord_id: buyerDiscordId,
      })
      .single();
    assertQuery(error, "progresso do ranking");

    return {
      guildId: data.guild_id,
      buyerDiscordId: data.buyer_discord_id,
      totalSpentCents: safeInteger(data.total_spent_cents),
      currentRank: readRankLevel(data, "current_rank"),
      nextRank: readRankLevel(data, "next_rank"),
      amountToNextRankCents: safeInteger(data.amount_to_next_rank_cents),
    };
  }

  async findGuildId(discordGuildId: string) {
    const { data, error } = await this.client
      .from("guilds")
      .select("id")
      .eq("discord_guild_id", discordGuildId)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    assertQuery(error, "servidor do ranking");
    return data?.id ?? null;
  }

  async listLevels(): Promise<CustomerRankLevel[]> {
    const { data, error } = await this.client
      .from("customer_rank_levels")
      .select("code,name,role_name,minimum_spend_cents,discount_bps,color,sort_order")
      .order("sort_order");
    assertQuery(error, "níveis do ranking");
    return (data ?? []).map((row) => ({
      code: row.code,
      name: row.name,
      roleName: row.role_name,
      minimumSpendCents: safeInteger(row.minimum_spend_cents),
      discountBps: safeInteger(row.discount_bps),
      color: safeInteger(row.color),
      sortOrder: safeInteger(row.sort_order),
    }));
  }

  async listRoleBindings(guildId: string): Promise<CustomerRankRoleBinding[]> {
    const { data, error } = await this.client
      .from("guild_customer_rank_roles")
      .select("rank_code,discord_role_id")
      .eq("guild_id", guildId);
    assertQuery(error, "cargos registrados do ranking");
    return (data ?? []).map((row) => ({
      rankCode: row.rank_code,
      discordRoleId: row.discord_role_id,
    }));
  }

  async saveRoleBinding(
    guildId: string,
    rankCode: string,
    discordRoleId: string,
  ) {
    const { error } = await this.client.from("guild_customer_rank_roles").upsert(
      {
        guild_id: guildId,
        rank_code: rankCode,
        discord_role_id: discordRoleId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id,rank_code" },
    );
    assertQuery(error, "registro do cargo de ranking");
  }

  async claimRoleSync(guildId: string, claimToken: string) {
    const { data, error } = await this.client.rpc("claim_customer_rank_role_sync", {
      p_guild_id: guildId,
      p_claim_token: claimToken,
    });
    assertQuery(error, "reserva da sincronização dos cargos de ranking");
    return data === true;
  }

  async releaseRoleSync(
    guildId: string,
    claimToken: string,
    succeeded: boolean,
    errorMessage: string | null,
  ) {
    const { data, error } = await this.client.rpc("release_customer_rank_role_sync", {
      p_guild_id: guildId,
      p_claim_token: claimToken,
      p_succeeded: succeeded,
      p_error: errorMessage,
    });
    assertQuery(error, "liberação da sincronização dos cargos de ranking");
    if (data !== true) {
      throw new Error("A reserva da sincronização dos cargos de ranking expirou.");
    }
  }
}

function readRankLevel(
  row: Record<string, unknown>,
  prefix: "current_rank" | "next_rank",
): CustomerRankLevel | null {
  const code = row[`${prefix}_code`];
  const name = row[`${prefix}_name`];
  const roleName = row[`${prefix}_role_name`];
  if (
    typeof code !== "string" ||
    typeof name !== "string" ||
    typeof roleName !== "string"
  ) {
    return null;
  }

  return {
    code,
    name,
    roleName,
    minimumSpendCents: safeInteger(row[`${prefix}_minimum_spend_cents`]),
    discountBps: safeInteger(row[`${prefix}_discount_bps`]),
    color: safeInteger(row[`${prefix}_color`]),
    sortOrder: safeInteger(row[`${prefix}_sort_order`]),
  };
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function assertQuery(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) throw new Error(`Falha ao consultar ${operation}.`);
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}
