import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { GWSTORE_RANKING_GUILD_ID, type PaidCustomerPurchase } from "./customer-top-spenders";
import { SupabaseCustomerRankRepository } from "./customer-rank-repository";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
export type RankingGuild = { id: string; configuration: Json; updated_at: string };
export type TopSpendersRepository = {
  findGuild(): Promise<RankingGuild | null>;
  listPaidPurchases(guildId: string): Promise<PaidCustomerPurchase[]>;
  claim(guildId: string, token: string): Promise<boolean>;
  release(guildId: string, token: string, succeeded: boolean): Promise<void>;
  saveMessage(guild: RankingGuild, messageId: string): Promise<void>;
};

export class SupabaseTopSpendersRepository implements TopSpendersRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async findGuild() {
    const { data, error } = await this.client.from("guilds")
      .select("id,configuration,updated_at")
      .eq("discord_guild_id", GWSTORE_RANKING_GUILD_ID)
      .eq("status", "active").is("archived_at", null).maybeSingle();
    if (error) throw new Error("Não foi possível consultar o servidor do Top 5.");
    return data;
  }

  async listPaidPurchases(guildId: string) {
    const through = new Date().toISOString();
    const read = async (source: "product" | "robux"): Promise<PaidCustomerPurchase[]> => {
      const purchases: PaidCustomerPurchase[] = [];
      let afterId: string | null = null;
      while (true) {
        const query = source === "product"
          ? this.client.from("orders").select("id,guild_id,buyer_discord_id,sale_price_cents,paid_at")
            .in("status", ["paid", "processing", "delivered"])
          : this.client.from("robux_orders").select("id,guild_id,buyer_discord_id,amount_cents,paid_at")
            .eq("status", "paid");
        // The same confirmed-payment criteria used by customer rank progress.
        let pageQuery = query.eq("guild_id", guildId)
          .in("payment_provider", ["livepix", "eclipsepay"])
          .eq("payment_status", "paid").not("paid_at", "is", null)
          .lte("paid_at", through).order("id", { ascending: true }).limit(1_000);
        if (afterId) pageQuery = pageQuery.gt("id", afterId);
        const { data, error }: { data: Array<{
          id: string; guild_id: string; buyer_discord_id: string; paid_at: string | null;
          sale_price_cents?: number; amount_cents?: number;
        }> | null; error: { message: string } | null } = await pageQuery;
        if (error) throw new Error("Não foi possível consultar os pagamentos do Top 5.");
        for (const row of data ?? []) purchases.push({
          source, id: row.id, guildId: row.guild_id, buyerDiscordId: row.buyer_discord_id,
          amountCents: source === "product" ? row.sale_price_cents! : row.amount_cents!,
          paidAt: row.paid_at!,
        });
        if (!data || data.length < 1_000) return purchases;
        afterId = data.at(-1)!.id;
      }
    };
    const [products, robux] = await Promise.all([read("product"), read("robux")]);
    return [...products, ...robux];
  }

  // Share the existing guild rank lease so overlapping cron/build workers
  // cannot create duplicate messages. This requires no new database migration.
  claim(guildId: string, token: string) {
    return new SupabaseCustomerRankRepository(this.client).claimRoleSync(guildId, token);
  }

  release(guildId: string, token: string, succeeded: boolean) {
    return new SupabaseCustomerRankRepository(this.client)
      .releaseRoleSync(guildId, token, succeeded, succeeded ? null : "Falha ao atualizar Top 5.");
  }

  async saveMessage(guild: RankingGuild, messageId: string) {
    const configuration = typeof guild.configuration === "object" &&
      guild.configuration !== null && !Array.isArray(guild.configuration) ? guild.configuration : {};
    const { data, error } = await this.client.from("guilds").update({
      configuration: { ...configuration, customer_top_spenders_message_id: messageId },
    }).eq("id", guild.id).eq("updated_at", guild.updated_at).select("id").maybeSingle();
    if (error || !data) throw new Error("A configuração do servidor mudou. O Top 5 será retomado na próxima atualização.");
  }
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado para o Top 5.");
  return client;
}
