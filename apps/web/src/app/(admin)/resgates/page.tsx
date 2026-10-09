import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import {
  RouletteRedemptionManager,
  type AdminRouletteRedemption,
} from "@/components/admin/roulette-redemption-manager";
import { STORE_NAME } from "@/lib/brand";
import {
  ROULETTE_AVAILABLE,
  ROULETTE_LEGACY_SETTLEMENT_AVAILABLE,
} from "@/lib/roulette/availability";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: ROULETTE_AVAILABLE ? "Resgates da roleta" : "Prêmios pendentes",
};
export const dynamic = "force-dynamic";

export default async function RouletteRedemptionsPage() {
  if (!ROULETTE_LEGACY_SETTLEMENT_AVAILABLE) notFound();

  const redemptions = await listRouletteRedemptions();
  const pending = redemptions.filter((redemption) => redemption.status === "pending").length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={ROULETTE_AVAILABLE ? "Roleta" : "Histórico"}
        title={ROULETTE_AVAILABLE ? "Resgates" : "Prêmios pendentes"}
        description={ROULETTE_AVAILABLE
          ? `Prêmios que os jogadores pediram para receber. A entrega é feita à mão no ticket privado do Discord, como em um pedido pago da ${STORE_NAME}.`
          : `Atendimento de prêmios já solicitados na ${STORE_NAME}. Os tickets existentes continuam disponíveis para concluir a entrega.`}
      />
      <Notice>
        {ROULETTE_AVAILABLE
          ? "O resgate só abre se o item tiver estoque, então nada nesta lista nasceu impossível de entregar. A unidade sai do catálogo quando você marca como entregue — se ela tiver acabado nesse meio-tempo, a entrega é recusada e você pode cancelar, o que devolve o prêmio ao inventário do jogador."
          : "Esta página preserva os registros antigos e permite concluir o atendimento. Marcar como entregue continua verificando o estoque; cancelar devolve o prêmio ao inventário do jogador."}
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
      "id,discord_user_id,item_count,total_value_cents,status,discord_ticket_status,discord_ticket_channel_id,discord_ticket_error,game_nickname,created_at,guilds(discord_guild_id),roulette_redemption_items(prize_key,product_name,quantity,value_cents,products(stock_quantity))",
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
    itemCount: row.item_count,
    totalValueCents: row.total_value_cents,
    items: (row.roulette_redemption_items ?? []).map((line) => ({
      prizeKey: line.prize_key,
      productName: line.product_name,
      quantity: line.quantity,
      valueCents: line.value_cents,
      productStock: line.products?.stock_quantity ?? null,
    })),
    status: row.status,
    ticketStatus: row.discord_ticket_status,
    ticketChannelId: row.discord_ticket_channel_id,
    ticketError: row.discord_ticket_error,
    gameNickname: row.game_nickname,
    guildDiscordId: row.guilds?.discord_guild_id ?? null,
    createdAt: row.created_at,
  }));
}
