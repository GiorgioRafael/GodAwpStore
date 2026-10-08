import { after } from "next/server";

import { ensurePaidOrderTicket } from "@/lib/bot/discord-ticket";
import { DiscordApiError } from "@/lib/bot/discord-api";
import { reconcileLatePaidOrderTickets } from "@/lib/bot/late-payment-ticket";
import { synchronizeDiscordCustomerRankRole } from "@/lib/bot/discord-customer-rank";
import {
  drainDiscordStorefrontSyncQueue,
  requestDiscordStorefrontSync,
} from "@/lib/bot/discord-storefront-sync-queue";
import { getLivePixPaymentService } from "@/lib/livepix/runtime";
import { getRobuxPaymentService } from "@/lib/robux/payment-service";
import { synchronizeRobuxCustomerRankRole } from "@/lib/robux/customer-rank-role-sync";
import { getRouletteCoinPurchaseService } from "@/lib/roulette/runtime";

export async function fulfillVerifiedPayment(input: { providerPaymentId: string; providerReference: string }) {
  const payments = getLivePixPaymentService();
  try {
    let confirmation;
    let itemPaymentError: unknown;
    try {
      confirmation = await payments.reconcilePayment({
        providerPaymentId: input.providerPaymentId,
        providerReference: input.providerReference,
      });
    } catch (error) {
      // An unavailable item checkout query must not block a verified Robux
      // payment. Preserve the error if this reference is not a Robux order.
      itemPaymentError = error;
    }
    if (!confirmation) {
      const robux = await getRobuxPaymentService().reconcilePayment({
        providerPaymentId: input.providerPaymentId,
        providerReference: input.providerReference,
      });
      if (robux) {
        return await openRobuxDeliveryTicket(robux);
      }
      if (itemPaymentError) throw itemPaymentError;

      // A reference that belongs to no order is either a roulette coin purchase
      // or an event for another integration.
      const coins = await getRouletteCoinPurchaseService().reconcilePayment({
        providerPaymentId: input.providerPaymentId,
        providerReference: input.providerReference,
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

    deferRankRoleSync("customer_rank_role", () => synchronizeDiscordCustomerRankRole({
      discordGuildId: confirmation.discordGuildId,
      buyerDiscordId: confirmation.buyerDiscordId,
    }));

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

async function openRobuxDeliveryTicket(confirmation: {
  orderId: string;
  discordGuildId: string;
  buyerDiscordId: string;
  robuxQuantity: number;
  paidAmountCents: number;
  ticketStatus: string;
}) {
  const robux = getRobuxPaymentService();
  deferRankRoleSync("robux_customer_rank_role", () => synchronizeRobuxCustomerRankRole({
    discordGuildId: confirmation.discordGuildId,
    buyerDiscordId: confirmation.buyerDiscordId,
  }));
  const claim = await robux.claimTicket(confirmation.orderId);
  if (!claim.claimed) {
    if (claim.ticketStatus === "creating") {
      return Response.json({ received: false, ticket: "in_progress" }, { status: 503 });
    }
    return Response.json({ received: true, robux: "paid", ticket: claim.ticketStatus });
  }

  try {
    const ticket = await ensurePaidOrderTicket({
      orderId: claim.orderId,
      guildId: claim.discordGuildId,
      buyerDiscordId: claim.buyerDiscordId,
      productName: "Robux",
      quantity: claim.robuxQuantity,
      paidAmountCents: claim.paidAmountCents,
      controls: "robux",
    });
    await robux.completeTicket(claim.orderId, ticket.channelId);
    return Response.json({ received: true, robux: "paid", ticket: "open" });
  } catch (error) {
    try {
      await robux.failTicket(claim.orderId);
    } catch (releaseError) {
      logWebhookError("robux_ticket_release", releaseError);
    }
    throw error;
  }
}

/** Role provisioning can outlast a webhook. The paid ticket always goes first. */
function deferRankRoleSync(operation: string, synchronize: () => Promise<unknown>) {
  try {
    after(async () => {
      try {
        await synchronize();
      } catch (error) {
        logWebhookError(operation, error);
      }
    });
  } catch (error) {
    logWebhookError(operation, error);
  }
}

function logWebhookError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  const details = error instanceof DiscordApiError
    ? ` [${error.method} ${error.path}; código=${error.discordCode ?? "desconhecido"}]`
    : "";
  console.error(`[payment-webhook:${operation}] ${message}${details}`);
}
