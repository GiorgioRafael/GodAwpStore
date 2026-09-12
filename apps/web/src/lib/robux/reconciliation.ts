import "server-only";

import { ROBUX_SALES_ENABLED } from "@/lib/brand";
import { ensurePaidOrderTicket } from "@/lib/bot/discord-ticket";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getRobuxPaymentService } from "./payment-service";

type Candidate = { id: string; payment_provider_reference: string | null; payment_status: string };

export async function recoverRobuxOrder(
  order: Candidate,
  payments = getRobuxPaymentService(),
  openTicket = ensurePaidOrderTicket,
) {
  if (order.payment_status !== "paid") {
    if (!order.payment_provider_reference) return "pending";
    const confirmation = await payments.reconcileStoredCheckout(order.payment_provider_reference);
    if (!confirmation) return "pending";
    if (confirmation.orderId !== order.id) throw new Error("Referência de Robux pertence a outro pedido.");
  }
  const claim = await payments.claimTicket(order.id);
  if (!claim.claimed) return "skipped";
  try {
    const ticket = await openTicket({
      orderId: claim.orderId,
      guildId: claim.discordGuildId,
      buyerDiscordId: claim.buyerDiscordId,
      productName: "Robux",
      quantity: claim.robuxQuantity,
      paidAmountCents: claim.paidAmountCents,
      controls: "robux",
    });
    await payments.completeTicket(claim.orderId, ticket.channelId);
    return "opened";
  } catch (error) {
    await payments.failTicket(claim.orderId).catch(() => undefined);
    throw error;
  }
}

export async function reconcileRobuxOrders(options: { prioritizeRecent?: boolean } = {}) {
  const result = { checked: 0, opened: 0, pending: 0, skipped: 0, failed: 0 };
  if (!ROBUX_SALES_ENABLED) return result;
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado para recuperar Robux.");
  // Paid orders take priority and are retried regardless of their age. Pending
  // checkouts rotate by updated_at so unpaid orders cannot starve later buyers.
  const [paid, pending] = await Promise.all([
    client.from("robux_orders").select("id,payment_provider_reference,payment_status")
      .eq("payment_status", "paid").is("discord_ticket_channel_id", null)
      .order("updated_at").limit(10),
    client.from("robux_orders").select("id,payment_provider_reference,payment_status")
      .eq("payment_status", "pending").not("payment_provider_reference", "is", null)
      .order(options.prioritizeRecent ? "created_at" : "updated_at", { ascending: !options.prioritizeRecent }).limit(10),
  ]);
  if (paid.error || pending.error) throw new Error("Falha ao consultar pedidos de Robux pendentes.");
  for (const order of [...paid.data, ...pending.data]) {
    result.checked++;
    try {
      const state = await recoverRobuxOrder(order);
      result[state]++;
    } catch (error) {
      result.failed++;
      console.error(`[robux-recovery:${order.id}] ${error instanceof Error ? error.message : "erro desconhecido"}`);
    } finally {
      if (order.payment_status === "pending") {
        // Only scheduling metadata; never mark a payment paid without LivePix proof.
        await client.from("robux_orders").update({ updated_at: new Date().toISOString() })
          .eq("id", order.id).eq("payment_status", "pending");
      }
    }
  }
  return result;
}
