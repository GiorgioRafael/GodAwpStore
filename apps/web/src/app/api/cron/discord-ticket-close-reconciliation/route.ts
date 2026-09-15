import { reconcileDeliveredDiscordTicketAutoCloses } from "@/lib/bot/discord-ticket-auto-close";
import { reconcileDiscordTicketCloseClaims } from "@/lib/bot/discord-ticket-close-reconciliation";
import { reconcileGiveaways } from "@/lib/giveaways/reconciliation";
import { reconcileLeadRecoveryOffers } from "@/lib/bot/lead-recovery";
import { reconcileLatePaidOrderTickets } from "@/lib/bot/late-payment-ticket";
import { reconcileRouletteRedemptionTickets } from "@/lib/roulette/redemptions";
import { reconcileRobuxOrders } from "@/lib/robux/reconciliation";
import { reconcileEclipsePayments } from "@/lib/eclipsepay/reconciliation";

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
    const outcomes = await Promise.allSettled([
      reconcileDiscordTicketCloseClaims(),
      reconcileDeliveredDiscordTicketAutoCloses(),
      reconcileGiveaways(),
      reconcileLeadRecoveryOffers(),
      reconcileRouletteRedemptionTickets(),
      reconcileLatePaidOrderTickets(),
      reconcileRobuxOrders(),
      reconcileEclipsePayments(10),
    ]);
    // Finish independent recovery work before returning, even if another queue fails.
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const [
      tickets,
      deliveredTicketAutoClose,
      giveaways,
      leadRecovery,
      rouletteRedemptions,
      latePayments,
      robux,
      eclipsepay,
    ] = outcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value : null);
    return Response.json(
      {
        ok: true,
        tickets,
        deliveredTicketAutoClose,
        giveaways,
        leadRecovery,
        rouletteRedemptions,
        latePayments,
        robux,
        eclipsepay,
      },
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
