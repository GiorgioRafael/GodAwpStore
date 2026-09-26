import "server-only";

import { IS_GWSTORE } from "@/lib/brand";
import { eclipseDatabase, eclipsePaymentLinkSchema, getEclipsePayClient } from "./runtime";

/** Webhook-triggered and cron-driven, always verifies the charge with EclipsePay. */
export async function reconcileEclipsePaymentLinks(limit = 3) {
  const result = { processed: 0, failed: 0 };
  if (!IS_GWSTORE || !process.env.ECLIPSEPAY_API_KEY) return result;
  const db = eclipseDatabase();
  for (let index = 0; index < Math.min(limit, 10); index++) {
    const lease = crypto.randomUUID();
    const { data: link, error: claimError } = await db
      .rpc("claim_eclipsepay_payment_link_reconciliation", { p_token: lease })
      .maybeSingle();
    if (claimError) throw new Error("Fila de links Pix indisponível.");
    if (!link) break;
    const row = eclipsePaymentLinkSchema.parse(link);
    try {
      if (!row.operation_id) throw new Error("Operação não registrada.");
      const charge = await getEclipsePayClient().getCharge(row.operation_id);
      if (charge.amountCents !== row.amount_cents) {
        throw new Error("Valor da cobrança divergente do link.");
      }
      const { data: events, error: eventError } = await db.from("eclipsepay_webhook_inbox")
        .select("event_id,amount_cents")
        .eq("operation_id", charge.id)
        .is("processed_at", null);
      if (eventError || (events ?? []).some((event) => Number(event.amount_cents) !== charge.amountCents)) {
        throw new Error("Notificação Pix divergente.");
      }
      const { error: updateError } = await db.from("eclipsepay_payment_links").update({
        operation_status: charge.status,
        br_code: charge.status === "pending" ? charge.brCode ?? null : null,
        expires_at: charge.expiresAt,
        fee_cents: charge.feeCents ?? null,
        net_cents: charge.netCents ?? null,
        provider_updated_at: charge.updatedAt,
        confirmed_at: row.confirmed_at ?? (charge.status === "completed" ? charge.updatedAt : null),
        next_check_at: new Date(Date.now() + 60_000).toISOString(),
        lease_token: null,
        lease_until: null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id).eq("lease_token", lease);
      if (updateError) throw new Error("Não foi possível registrar o pagamento Pix.");
      if (events?.length) {
        const { error: inboxError } = await db.from("eclipsepay_webhook_inbox")
          .update({ processed_at: new Date().toISOString() })
          .in("event_id", events.map((event) => event.event_id));
        if (inboxError) throw new Error("Notificação Pix será reprocessada.");
      }
      result.processed++;
    } catch (error) {
      result.failed++;
      await db.from("eclipsepay_payment_links").update({
        lease_token: null,
        lease_until: null,
        next_check_at: new Date(Date.now() + 60_000).toISOString(),
      }).eq("id", row.id).eq("lease_token", lease);
      console.error(`[eclipsepay:payment-link:${row.id}] ${error instanceof Error ? error.message : "erro desconhecido"}`);
    }
  }
  return result;
}
