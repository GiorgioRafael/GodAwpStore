import "server-only";

import { ensurePaidOrderTicket } from "@/lib/bot/discord-ticket";
import { DiscordApiError } from "@/lib/bot/discord-api";
import { getLivePixPaymentService } from "@/lib/livepix/runtime";
import type { LivePixPaymentService } from "@/lib/livepix/payment-service";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type Client = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
type Order = Database["public"]["Tables"]["orders"]["Row"];

export type PaidTicketCandidate = Pick<Order,
  | "id" | "status" | "payment_status" | "paid_at"
  | "discord_ticket_status" | "discord_ticket_channel_id"
  | "discord_ticket_closed_at" | "stock_committed_at" | "stock_released_at"
> & { payment_reference?: string | null };

type TicketPayments = Pick<LivePixPaymentService, "claimTicket" | "completeTicket" | "failTicket">;
type Dependencies = {
  payments?: TicketPayments;
  openTicket?: typeof ensurePaidOrderTicket;
};

const ORDER_STATUSES = ["paid", "processing", "delivered"] as const;
const TICKET_STATUSES = ["not_created", "failed", "creating"] as const;
const MAXIMUM_BATCH_SIZE = 15;
const MAXIMUM_BATCH_TIME_MS = 60_000;
const CLAIM_LEASE_MS = 5 * 60_000;

/** Retry fulfillment only: the existing claim owns payment, stock and lease validation. */
export async function recoverPaidOrderTicket(order: PaidTicketCandidate, dependencies: Dependencies = {}) {
  if (!isEligiblePaidOrder(order)) return "skipped" as const;

  const payments = dependencies.payments ?? getLivePixPaymentService();
  const claim = await payments.claimTicket(order.id);
  if (!claim.claimed) return "skipped" as const;

  try {
    const ticket = await (dependencies.openTicket ?? ensurePaidOrderTicket)({
      orderId: claim.orderId,
      guildId: claim.discordGuildId,
      buyerDiscordId: claim.buyerDiscordId,
      productName: claim.productName,
      quantity: claim.quantity,
      paidAmountCents: claim.paidAmountCents,
    });
    await payments.completeTicket(claim.orderId, ticket.channelId);
    return "opened" as const;
  } catch (error) {
    // ensurePaidOrderTicket recovers its channel/topic and welcome message on
    // retry, including a lost HTTP response after Discord created the channel.
    await payments.failTicket(claim.orderId).catch(() => undefined);
    throw error;
  }
}

/** Durable safety net when the payment webhook stops before creating the ticket. */
export async function reconcilePaidOrderTickets(options: Dependencies & {
  client?: Client;
  limit?: number;
  now?: () => number;
} = {}) {
  const result = { checked: 0, opened: 0, skipped: 0, failed: 0, deferred: 0 };
  const client = options.client ?? createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado para recuperar tickets pagos.");
  const now = options.now ?? Date.now;
  const startedAt = now();
  const staleClaimAt = new Date(startedAt - CLAIM_LEASE_MS).toISOString();
  const requestedLimit = options.limit ?? MAXIMUM_BATCH_SIZE;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAXIMUM_BATCH_SIZE, Math.trunc(requestedLimit)))
    : MAXIMUM_BATCH_SIZE;
  const { data, error } = await client.from("orders")
    .select("id,status,payment_status,paid_at,discord_ticket_status,discord_ticket_channel_id,discord_ticket_closed_at,stock_committed_at,stock_released_at,payment_reference")
    .eq("payment_status", "paid")
    .in("status", [...ORDER_STATUSES])
    .not("paid_at", "is", null)
    .is("discord_ticket_channel_id", null)
    .is("discord_ticket_closed_at", null)
    .is("stock_released_at", null)
    .not("stock_committed_at", "is", null)
    .in("discord_ticket_status", [...TICKET_STATUSES])
    .or("payment_reference.is.null,payment_reference.not.like.web:%")
    .or(`discord_ticket_status.neq.creating,discord_ticket_claimed_at.is.null,discord_ticket_claimed_at.lte.${staleClaimAt}`)
    .order("updated_at")
    .order("id")
    .limit(limit);
  if (error) throw new Error("Falha ao consultar pedidos pagos sem ticket.");

  const candidates = data ?? [];
  for (const order of candidates) {
    if (now() - startedAt >= MAXIMUM_BATCH_TIME_MS) break;
    result.checked += 1;
    try {
      const state = await recoverPaidOrderTicket(order, options);
      result[state] += 1;
    } catch (error) {
      result.failed += 1;
      const detail = error instanceof DiscordApiError
        ? `${error.message} [${error.method} ${error.path}; código=${error.discordCode ?? "desconhecido"}]`
        : error instanceof Error ? error.message : "erro desconhecido";
      console.error(`[paid-ticket-recovery:${order.id}] ${detail}`);
    } finally {
      // Rotate attempts without changing payment/stock. Corrupt or repeatedly
      // failing rows cannot consume every batch ahead of later paid buyers.
      const { error: rotationError } = await client.from("orders")
        .update({ updated_at: new Date(now()).toISOString() })
        .eq("id", order.id)
        .eq("payment_status", "paid")
        .in("status", [...ORDER_STATUSES])
        .in("discord_ticket_status", [...TICKET_STATUSES])
        .is("discord_ticket_channel_id", null)
        .is("discord_ticket_closed_at", null);
      if (rotationError) console.error(`[paid-ticket-recovery:${order.id}] Não foi possível registrar a tentativa.`);
    }
  }
  result.deferred = candidates.length - result.checked;
  return result;
}

function isEligiblePaidOrder(order: PaidTicketCandidate) {
  return !order.payment_reference?.startsWith("web:") && order.payment_status === "paid" && order.paid_at !== null
    && ORDER_STATUSES.some(status => status === order.status)
    && TICKET_STATUSES.some(status => status === order.discord_ticket_status)
    && order.discord_ticket_channel_id === null && order.discord_ticket_closed_at === null
    && order.stock_released_at === null && order.stock_committed_at !== null;
}
