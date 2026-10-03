import { reconcileDeliveredDiscordTicketAutoCloses } from "@/lib/bot/discord-ticket-auto-close";
import { reconcileDiscordTicketCloseClaims } from "@/lib/bot/discord-ticket-close-reconciliation";
import { reconcileGiveaways } from "@/lib/giveaways/reconciliation";
import { reconcileLeadRecoveryOffers } from "@/lib/bot/lead-recovery";
import { reconcileLatePaidOrderTickets } from "@/lib/bot/late-payment-ticket";
import { reconcileRouletteRedemptionTickets } from "@/lib/roulette/redemptions";
import { reconcileRobuxOrders } from "@/lib/robux/reconciliation";
import { reconcileRobuxCustomerRankRoles } from "@/lib/robux/customer-rank-role-sync";
import { reconcileEclipsePayments } from "@/lib/eclipsepay/reconciliation";
import { reconcileEclipsePaymentLinks } from "@/lib/eclipsepay/payment-link-reconciliation";
import { synchronizeGwStoreTopSpenders } from "@/lib/bot/discord-top-spenders";

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
    const recoveryOutcomes = await Promise.allSettled([
      reconcileDiscordTicketCloseClaims(),
      reconcileDeliveredDiscordTicketAutoCloses(),
      reconcileGiveaways(),
      reconcileLeadRecoveryOffers(),
      reconcileRouletteRedemptionTickets(),
      reconcileLatePaidOrderTickets(),
      reconcileRobuxOrders(),
      reconcileRobuxCustomerRankRoles(),
      reconcileEclipsePayments(10),
      reconcileEclipsePaymentLinks(5),
    ]);
    // Rank paid purchases after reconciliation and role workers release the
    // guild lease, so this pass includes payments confirmed in the same run.
    const [topSpendersOutcome] = await Promise.allSettled([synchronizeGwStoreTopSpenders()]);
    const outcomes = [...recoveryOutcomes, topSpendersOutcome];
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
      robuxRanks,
      eclipsepay,
      eclipsepayLinks,
      topSpenders,
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
        robuxRanks,
        eclipsepay,
        eclipsepayLinks,
        topSpenders,
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
