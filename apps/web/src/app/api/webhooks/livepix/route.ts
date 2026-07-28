import { after } from "next/server";

import { ensurePaidOrderTicket } from "@/lib/bot/discord-ticket";
import { reconcileLatePaidOrderTickets } from "@/lib/bot/late-payment-ticket";
import { synchronizeDiscordCustomerRankRole } from "@/lib/bot/discord-customer-rank";
import {
  drainDiscordStorefrontSyncQueue,
  requestDiscordStorefrontSync,
} from "@/lib/bot/discord-storefront-sync-queue";
import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import { getLivePixPaymentService } from "@/lib/livepix/runtime";
import { parseLivePixPaymentWebhook } from "@/lib/livepix/webhook";
import { getRouletteCoinPurchaseService } from "@/lib/roulette/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAXIMUM_WEBHOOK_BYTES = 16 * 1024;

export async function POST(request: Request) {
  let event;
  try {
    const body = await readLimitedBody(request, MAXIMUM_WEBHOOK_BYTES);
    event = parseLivePixPaymentWebhook(body);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Payload muito grande." }, { status: 413 });
    }
    return Response.json({ error: "Webhook inválido." }, { status: 400 });
  }

  const configuredClientId = process.env.LIVEPIX_CLIENT_ID?.trim();
  if (!configuredClientId || event.clientId !== configuredClientId) {
    return Response.json({ error: "Cliente LivePix inválido." }, { status: 401 });
  }

  const payments = getLivePixPaymentService();
  try {
    const confirmation = await payments.reconcilePayment({
      providerPaymentId: event.resource.id,
      providerReference: event.resource.reference,
    });
    if (!confirmation) {
      // A reference that belongs to no order is either a roulette coin purchase
      // or an event for another integration.
      const coins = await getRouletteCoinPurchaseService().reconcilePayment({
        providerPaymentId: event.resource.id,
        providerReference: event.resource.reference,
      });
      return coins
        ? Response.json({ received: true, roulette: coins.status })
        : Response.json({ received: true, ignored: true });
    }

    if (!["paid", "processing", "delivered"].includes(confirmation.orderStatus)) {
      // The money landed on an order the deadline had already cancelled. This
      // used to return 200 and drop it: the buyer was charged, got no item and
      // had no channel to ask in. Whether they get the item or a refund is the
      // team's call — but they get somewhere to ask, always.
      after(async () => {
        try {
          const recovery = await reconcileLatePaidOrderTickets({ limit: 5 });
          if (recovery.failed > 0) {
            console.error(
              `[pagamento-atrasado] ${recovery.failed} pedido(s) sem canal de recuperação.`,
            );
          }
        } catch (error) {
          logWebhookError("late-payment", error);
        }
      });
      return Response.json({ received: true, ticket: "late_payment_recovery" });
    }

    try {
      const requested = await requestDiscordStorefrontSync(
        confirmation.orderId,
      );
      if (requested) {
        after(async () => {
          await drainDiscordStorefrontSyncQueue().catch((error) => {
            // The durable request remains pending, so a provider replay or the
            // next payment can retry without delaying this buyer's ticket.
            logWebhookError("storefront", error);
          });
        });
      }
    } catch (error) {
      // Payment and ticket delivery remain authoritative if queue persistence
      // is temporarily unavailable.
      logWebhookError("storefront_queue", error);
    }

    try {
      await synchronizeDiscordCustomerRankRole({
        discordGuildId: confirmation.discordGuildId,
        buyerDiscordId: confirmation.buyerDiscordId,
      });
    } catch (error) {
      // Payment and ticket delivery must not be rolled back by a temporary
      // Discord role failure. A webhook replay or /rank retries the sync.
      logWebhookError("customer_rank_role", error);
    }

    const claim = await payments.claimTicket(confirmation.orderId);
    if (!claim.claimed) {
      if (claim.ticketStatus === "creating") {
        return Response.json({ received: false, ticket: "in_progress" }, { status: 503 });
      }
      return Response.json({ received: true, ticket: claim.ticketStatus });
    }

    try {
      const ticket = await ensurePaidOrderTicket({
        orderId: claim.orderId,
        guildId: claim.discordGuildId,
        buyerDiscordId: claim.buyerDiscordId,
        productName: claim.productName,
        quantity: claim.quantity,
        paidAmountCents: claim.paidAmountCents,
      });
      await payments.completeTicket(claim.orderId, ticket.channelId);
      return Response.json({ received: true, ticket: "open" });
    } catch (error) {
      try {
        await payments.failTicket(claim.orderId);
      } catch (releaseError) {
        logWebhookError("ticket_release", releaseError);
      }
      throw error;
    }
  } catch (error) {
    logWebhookError("processing", error);
    return Response.json({ error: "Processamento temporariamente indisponível." }, { status: 503 });
  }
}

function logWebhookError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[livepix-webhook:${operation}] ${message}`);
}
