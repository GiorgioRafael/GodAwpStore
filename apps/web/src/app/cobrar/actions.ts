"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { IS_GWSTORE } from "@/lib/brand";
import { eclipseDatabase, eclipsePaymentLinkSchema, getEclipsePayClient } from "@/lib/eclipsepay/runtime";
import { parseBrlCents } from "@/lib/eclipsepay/payment-link-validation";

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const payerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  details: z.string().trim().max(500),
});

export type PaymentLinkResult = { ok: true; token: string } | { ok: false; message: string };

/** The reusable page creates a separate, idempotent intent per visitor. */
export async function startPaymentLink(
  intentId: string,
  _previous: PaymentLinkResult,
  formData: FormData,
): Promise<PaymentLinkResult> {
  if (!IS_GWSTORE || !z.uuid().safeParse(intentId).success) {
    return { ok: false, message: "Sessão de pagamento inválida. Atualize a página." };
  }
  if (!process.env.ECLIPSEPAY_API_KEY || !process.env.ECLIPSEPAY_WEBHOOK_SECRET) {
    return { ok: false, message: "Pagamento indisponível no momento." };
  }
  const payer = payerSchema.safeParse({ name: formData.get("name"), details: formData.get("details") });
  const amountCents = parseBrlCents(formData.get("amount"));
  if (!payer.success || amountCents === null) {
    return { ok: false, message: "Confira o nome, o valor (R$ 0,80 a R$ 1.000,00) e os detalhes." };
  }

  const { data, error } = await eclipseDatabase().rpc("prepare_eclipsepay_payment_link", {
    p_intent_id: intentId,
    p_token: randomBytes(32).toString("hex"),
    p_payer_name: payer.data.name,
    p_payer_details: payer.data.details,
    p_amount_cents: amountCents,
  }).single();
  if (error || !data) {
    return { ok: false, message: "Não foi possível criar o Pix. O limite temporário de cobranças pode ter sido atingido; tente mais tarde." };
  }
  const link = eclipsePaymentLinkSchema.safeParse(data);
  if (!link.success) {
    return { ok: false, message: "Não foi possível abrir a página do Pix." };
  }
  try {
    if (link.data.operation_status === "pending") await issueCharge(link.data);
  } catch (issueError) {
    // The intent is durable. The receipt page retries this exact UUID/payload.
    console.error(`[payment-link:${link.data.id}] ${issueError instanceof Error ? issueError.message : "erro desconhecido"}`);
  }
  revalidatePath(`/cobrar/${link.data.link_token}`);
  return { ok: true, token: link.data.link_token };
}

export async function retryPaymentLink(token: string): Promise<void> {
  if (!IS_GWSTORE || !tokenSchema.safeParse(token).success) return;
  const { data, error } = await eclipseDatabase().from("eclipsepay_payment_links")
    .select("id,amount_cents,operation_id,operation_status")
    .eq("link_token", token).maybeSingle();
  if (error || !data || data.operation_status !== "pending") return;
  try {
    await issueCharge(data);
    revalidatePath(`/cobrar/${token}`);
  } catch (issueError) {
    console.error(`[payment-link:retry:${data.id}] ${issueError instanceof Error ? issueError.message : "erro desconhecido"}`);
  }
}

async function issueCharge(data: { id: string; amount_cents: number; operation_id: string | null }) {
  const charge = data.operation_id
    ? await getEclipsePayClient().getCharge(data.operation_id)
    : await getEclipsePayClient().createCharge(data.id, {
        amountCents: Number(data.amount_cents),
        // The buyer's private message is stored only in our database.
        description: `GWStore pagamento ${data.id}`,
      });
  if (charge.amountCents !== Number(data.amount_cents)) throw new Error("Valor da cobrança divergente.");
  if (data.operation_id && charge.id !== data.operation_id) throw new Error("Operação divergente.");
  const { error } = await eclipseDatabase().from("eclipsepay_payment_links").update({
    operation_id: charge.id,
    operation_status: charge.status,
    br_code: charge.status === "pending" ? charge.brCode ?? null : null,
    expires_at: charge.expiresAt,
    fee_cents: charge.feeCents ?? null,
    net_cents: charge.netCents ?? null,
    provider_updated_at: charge.updatedAt,
    confirmed_at: charge.status === "completed" ? charge.updatedAt : null,
    next_check_at: new Date(Date.now() + 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", data.id).eq("operation_status", "pending");
  if (error) throw new Error("Não foi possível registrar o Pix gerado.");
}
