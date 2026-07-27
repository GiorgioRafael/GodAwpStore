import { reconcileDiscordTicketCloseClaims } from "@/lib/bot/discord-ticket-close-reconciliation";
import { reconcileGiveaways } from "@/lib/giveaways/reconciliation";
import { reconcileLeadRecoveryOffers } from "@/lib/bot/lead-recovery";
import { reconcileRouletteRedemptionTickets } from "@/lib/roulette/redemptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const [tickets, giveaways, leadRecovery, rouletteRedemptions] = await Promise.all([
      reconcileDiscordTicketCloseClaims(),
      reconcileGiveaways(),
      reconcileLeadRecoveryOffers(),
      reconcileRouletteRedemptionTickets(),
    ]);
    return Response.json(
      { ok: true, tickets, giveaways, leadRecovery, rouletteRedemptions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[cron:discord-ticket-close-reconciliation] ${message}`);
    return Response.json(
      { ok: false, error: "Reconciliação temporariamente indisponível." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
