import "server-only";
import { z } from "zod";
import { IS_GWSTORE } from "@/lib/brand";
import { getLivePixClient, type LivePixPayment } from "@/lib/livepix/client";
import { eclipseCheckoutSchema, eclipseDatabase, eclipsePayEnabled, getEclipsePayClient } from "@/lib/eclipsepay/runtime";

const referenceSchema = z.string().regex(/^ep:[0-9a-f-]{36}$/);
// Final charge amount, in integer cents (after discounts).
const LIVEPIX_MAX_AMOUNT_CENTS = 1_000;
const ECLIPSE_MAX_AMOUNT_CENTS = 100_000;

async function findEclipsePayment(reference: string): Promise<LivePixPayment | null> {
  referenceSchema.parse(reference);
  if (!IS_GWSTORE) throw new Error("Provedor não disponível nesta loja.");
  const id = z.uuid().parse(reference.slice(3));
  const db = eclipseDatabase();
  const { data: checkout, error } = await db.from("eclipsepay_checkouts")
    .select("amount_cents,operation_id,confirmed_at").eq("operation_id", id).maybeSingle();
  if (error || !checkout) throw new Error("Cobrança EclipsePay não registrada.");
  const charge = await getEclipsePayClient().getCharge(id);
  if (charge.amountCents !== Number(checkout.amount_cents)) throw new Error("Valor EclipsePay divergente do pedido.");
  if (charge.status !== "completed") return null;
  // Charge.createdAt is issuance, NOT payment time. Save the completed snapshot
  // timestamp once, then reuse it for immutable ledger reconciliation on retries.
  let confirmedAt = checkout.confirmed_at as string | null;
  if (!confirmedAt) {
    const { error: confirmationError } = await db.from("eclipsepay_checkouts")
      .update({ confirmed_at: charge.updatedAt }).eq("operation_id", id).is("confirmed_at", null);
    if (confirmationError) throw new Error("Não foi possível registrar a data da confirmação Pix.");
    const { data: canonical, error: canonicalError } = await db.from("eclipsepay_checkouts")
      .select("confirmed_at").eq("operation_id", id).single();
    if (canonicalError || !canonical?.confirmed_at) throw new Error("Data da confirmação Pix indisponível.");
    confirmedAt = canonical.confirmed_at;
  }
  return {
    id, proof: `eclipsepay:${id}`, reference,
    amountCents: charge.amountCents, currency: "BRL",
    createdAt: z.iso.datetime({ offset: true }).parse(confirmedAt),
  };
}

export function getPaymentClient() {
  return {
    async createPayment(input: { amountCents: number; redirectUrl: string }) {
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
        throw new Error("Valor Pix inválido.");
      }
      if (!eclipsePayEnabled()) return getLivePixClient().createPayment(input);
      const url = new URL(input.redirectUrl);
      const id = z.uuid().parse(url.searchParams.get("compra") ?? url.pathname.split("/").at(-1));
      const db = eclipseDatabase();
      if (input.amountCents <= LIVEPIX_MAX_AMOUNT_CENTS || input.amountCents > ECLIPSE_MAX_AMOUNT_CENTS) {
        // An EclipsePay intent may already have issued a charge before routing
        // outside its range. Never switch an uncertain retry to LivePix.
        const { data: existing, error: lookupError } = await db.from("eclipsepay_checkouts")
          .select("order_id,amount_cents").eq("order_id", id).maybeSingle();
        if (lookupError) throw new Error("Não foi possível verificar o Pix existente. Tente novamente.");
        if (!existing) return getLivePixClient().createPayment(input);
        if (Number(existing.amount_cents) !== input.amountCents) throw new Error("Valor Pix divergente do pedido.");
      }
      if (!process.env.ECLIPSEPAY_WEBHOOK_SECRET) throw new Error("Webhook EclipsePay não configurado.");
      if (input.amountCents < 80 || input.amountCents > ECLIPSE_MAX_AMOUNT_CENTS) {
        throw new Error("O Pix EclipsePay aceita até R$ 1.000,00 por pedido. Ajuste a quantidade ou fale com a loja.");
      }
      const { data, error } = await db.rpc("prepare_eclipsepay_checkout", { p_order_id: id, p_amount_cents: input.amountCents }).single();
      if (error || !data) throw new Error("Não foi possível preparar o Pix.");
      const checkout = eclipseCheckoutSchema.parse(data);
      // Both idempotency key and payload remain identical after an uncertain timeout.
      const charge = await getEclipsePayClient().createCharge(id, { amountCents: input.amountCents, description: `GWStore ${id}` });
      const { error: registrationError } = await db.rpc("register_eclipsepay_operation", {
        p_order_id: id, p_operation_id: charge.id, p_br_code: charge.brCode ?? null, p_expires_at: charge.expiresAt,
      });
      if (registrationError) throw new Error("O Pix está sendo registrado. Tente novamente em instantes.");
      return { reference: `ep:${charge.id}`, checkoutUrl: `https://gwstore.vercel.app/pagamento/pix/${checkout.checkout_token}` };
    },
    async getPaymentByReference(reference: string): Promise<LivePixPayment> {
      if (!reference.startsWith("ep:")) return getLivePixClient().getPaymentByReference(reference);
      const payment = await findEclipsePayment(reference);
      if (!payment) throw new Error("O Pix EclipsePay ainda não foi confirmado.");
      return payment;
    },
    async findPaymentByReference(reference: string): Promise<LivePixPayment | null> {
      return reference.startsWith("ep:") ? findEclipsePayment(reference) : getLivePixClient().findPaymentByReference(reference);
    },
  };
}
