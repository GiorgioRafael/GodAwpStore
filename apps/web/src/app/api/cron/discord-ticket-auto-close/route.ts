import { IS_GWSTORE } from "@/lib/brand";
import { reconcileDeliveredDiscordTicketAutoCloses } from "@/lib/bot/discord-ticket-auto-close";
import { reconcileDiscordTicketCloseClaims } from "@/lib/bot/discord-ticket-close-reconciliation";
import { reconcileCompletedGwStoreItemSellingTickets } from "@/lib/bot/discord-item-selling-server";
import { shouldSkipVercelGwStoreCron } from "@/lib/railway-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Checks purchase and sale tickets every three minutes; other queues keep their cadence. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (shouldSkipVercelGwStoreCron()) {
    return Response.json({ ok: true, status: "railway-managed" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!IS_GWSTORE) {
    return Response.json({ ok: true, status: "disabled" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const outcomes = await Promise.allSettled([
      reconcileDiscordTicketCloseClaims({ gwStoreOnly: true }),
      reconcileDeliveredDiscordTicketAutoCloses({ gwStoreOnly: true }),
      reconcileCompletedGwStoreItemSellingTickets(),
    ]);
    const rejected = outcomes.find(outcome => outcome.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    const tickets = outcomes[0].status === "fulfilled" ? outcomes[0].value : null;
    const deliveredTicketAutoClose = outcomes[1].status === "fulfilled" ? outcomes[1].value : null;
    const itemSellingTicketAutoClose = outcomes[2].status === "fulfilled" ? outcomes[2].value : null;
    const failed = (tickets?.failed ?? 0) + (deliveredTicketAutoClose?.failed ?? 0) + (itemSellingTicketAutoClose?.failed ?? 0);
    if (failed || (tickets?.completed ?? 0) || (deliveredTicketAutoClose?.completed ?? 0) || (itemSellingTicketAutoClose?.completed ?? 0)) {
      console.info("[cron:discord-ticket-auto-close]", JSON.stringify({ tickets, deliveredTicketAutoClose, itemSellingTicketAutoClose }));
    }
    return Response.json({ ok: failed === 0, tickets, deliveredTicketAutoClose, itemSellingTicketAutoClose }, {
      status: failed ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[cron:discord-ticket-auto-close]", error instanceof Error ? error.message : "erro desconhecido");
    return Response.json({ ok: false, error: "Fechamento automático temporariamente indisponível." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
