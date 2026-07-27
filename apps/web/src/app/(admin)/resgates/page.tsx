import type { Metadata } from "next";

import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import {
  RouletteRedemptionManager,
  type AdminRouletteRedemption,
} from "@/components/admin/roulette-redemption-manager";
import { STORE_NAME } from "@/lib/brand";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Resgates da roleta" };
export const dynamic = "force-dynamic";

export default async function RouletteRedemptionsPage() {
  const redemptions = await listRouletteRedemptions();
  const pending = redemptions.filter((redemption) => redemption.status === "pending").length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Roleta"
        title="Resgates"
        description={`Prêmios que os jogadores pediram para receber. A entrega é feita à mão no ticket privado do Discord, como em um pedido pago da ${STORE_NAME}.`}
      />
      <Notice>
        O resgate não desconta o estoque do catálogo: a roleta pode sortear um item que está
        zerado. A coluna <strong>Estoque</strong> mostra a quantidade disponível agora para a
        equipe saber o que consegue entregar.
        {pending > 0 ? ` Há ${pending} resgate(s) aguardando entrega.` : ""}
      </Notice>
      <RouletteRedemptionManager redemptions={redemptions} />
    </div>
  );
}

async function listRouletteRedemptions(): Promise<AdminRouletteRedemption[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("roulette_redemptions")
    .select(
      "id,discord_user_id,product_name,value_cents,status,discord_ticket_status,discord_ticket_channel_id,discord_ticket_error,created_at,guilds(discord_guild_id),products(stock_quantity)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) {
    if (error) console.error(`[admin:resgates] ${error.message}`);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    discordUserId: row.discord_user_id,
    productName: row.product_name,
    valueCents: row.value_cents,
    status: row.status,
    ticketStatus: row.discord_ticket_status,
    ticketChannelId: row.discord_ticket_channel_id,
    ticketError: row.discord_ticket_error,
    guildDiscordId: row.guilds?.discord_guild_id ?? null,
    productStock: row.products?.stock_quantity ?? null,
    createdAt: row.created_at,
  }));
}
