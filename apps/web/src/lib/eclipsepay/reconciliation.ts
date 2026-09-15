import "server-only";
import { eclipseCheckoutSchema, eclipseDatabase, getEclipsePayClient } from "./runtime";
import { IS_GWSTORE } from "@/lib/brand";
import { fulfillVerifiedPayment } from "@/lib/payments/fulfillment";

/** Durable queue: webhook wakes it immediately; the existing cron retries failures. */
export async function reconcileEclipsePayments(limit = 3) {
  if (!IS_GWSTORE || !process.env.ECLIPSEPAY_API_KEY) return { processed: 0, failed: 0 };
  const db = eclipseDatabase();
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(limit, 10); index++) {
    const token = crypto.randomUUID();
    const { data, error } = await db.rpc("claim_eclipsepay_reconciliation", { p_token: token }).maybeSingle();
    if (error) throw new Error("Fila EclipsePay indisponível.");
    if (!data) break;
    const row = eclipseCheckoutSchema.parse(data);
    try {
      const { data: events, error: eventError } = await db.from("eclipsepay_webhook_inbox")
        .select("event_id,amount_cents,resource_version").eq("operation_id", row.operation_id).is("processed_at", null);
      if (eventError) throw new Error("Eventos EclipsePay indisponíveis.");
      if ((events ?? []).some((event) => Number(event.amount_cents) !== Number(row.amount_cents))) {
        throw new Error("Valor do evento EclipsePay divergente.");
      }
      if (!row.operation_id) throw new Error("Operação EclipsePay não registrada.");
      const charge = await getEclipsePayClient().getCharge(row.operation_id);
      if (charge.amountCents !== Number(row.amount_cents)) throw new Error("Valor da operação EclipsePay divergente.");
      if (charge.status === "completed") {
        const { error: paidStatusError } = await db.from("eclipsepay_checkouts").update({
          operation_status: "completed", br_code: null, provider_updated_at: charge.updatedAt,
          fee_cents: charge.feeCents ?? null, net_cents: charge.netCents ?? null,
        }).eq("order_id", row.order_id).eq("lease_token", token);
        if (paidStatusError) throw new Error("Confirmação Pix será repetida.");
        const result = await fulfillVerifiedPayment({ providerPaymentId: charge.id, providerReference: `ep:${charge.id}` });
        if (!result.ok) throw new Error("Entrega EclipsePay será repetida.");
        const outcome = await result.json();
        // The webhook can win the race against checkout registration. Retry it.
        if (outcome.ignored) throw new Error("Registro do checkout EclipsePay pendente.");
      }
      const terminal = charge.status !== "pending";
      const { error: updateError } = await db.from("eclipsepay_checkouts").update({
        operation_status: charge.status, provider_updated_at: charge.updatedAt,
        fee_cents: charge.feeCents ?? null, net_cents: charge.netCents ?? null,
        br_code: charge.status === "pending" ? charge.brCode ?? null : null, expires_at: charge.expiresAt,
        processed_at: terminal ? new Date().toISOString() : null,
        review_required: charge.status === "refunded",
        next_check_at: new Date(Date.now() + 60_000).toISOString(),
        lease_token: null, lease_until: null,
      }).eq("order_id", row.order_id).eq("lease_token", token);
      if (updateError) throw new Error("Não foi possível salvar a conciliação EclipsePay.");
      if (terminal && events?.length) {
        const { error: inboxError } = await db.from("eclipsepay_webhook_inbox")
          .update({ processed_at: new Date().toISOString() }).in("event_id", events.map((event) => event.event_id));
        if (inboxError) throw new Error("Não foi possível concluir o evento EclipsePay.");
      }
      // Refunds are recorded for explicit review, never auto-credit or re-deliver.
      if (charge.status === "refunded") console.error(`[eclipsepay:refund] Revisar estorno do pedido ${row.order_id}.`);
      processed++;
    } catch {
      failed++;
      await db.from("eclipsepay_checkouts").update({
        lease_token: null, lease_until: null, next_check_at: new Date(Date.now() + 60_000).toISOString(),
      }).eq("order_id", row.order_id).eq("lease_token", token);
      console.error(`[eclipsepay:reconciliation] Pedido ${row.order_id} será reprocessado.`);
    }
  }
  return { processed, failed };
}
