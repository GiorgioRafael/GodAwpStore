import { ensurePaidOrderTicket } from "@/lib/bot/discord-ticket";
import { synchronizeDiscordCustomerRankRole } from "@/lib/bot/discord-customer-rank";
import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import { getLivePixPaymentService } from "@/lib/livepix/runtime";
import { parseLivePixPaymentWebhook } from "@/lib/livepix/webhook";

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
      return Response.json({ received: true, ignored: true });
    }

    if (!["paid", "processing", "delivered"].includes(confirmation.orderStatus)) {
      return Response.json({ received: true, ticket: "not_applicable" });
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
