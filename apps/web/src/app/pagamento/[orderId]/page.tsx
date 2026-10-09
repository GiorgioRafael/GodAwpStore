import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  paymentReturnCopy,
  resolvePaymentReturnStatus,
} from "@/lib/livepix/payment-return";
import { IS_GWSTORE, STORE_NAME } from "@/lib/brand";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Status do pagamento",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PaymentReturnPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const status = await readPaymentStatus(orderId);
  const content = paymentReturnCopy(status);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12 text-foreground">
      <Card className="w-full max-w-xl p-7 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{STORE_NAME} · Pix</p>
        <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">{content.title}</h1>
        <p className="mt-4 text-sm leading-6 text-muted">{content.description}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <LinkButton href={`/pagamento/${encodeURIComponent(orderId)}`}>Atualizar status</LinkButton>
          <LinkButton href="/" variant="secondary">Abrir {STORE_NAME}</LinkButton>
        </div>
        <p className="mt-6 text-xs text-muted">A confirmação válida vem diretamente do provedor de pagamento.</p>
      </Card>
    </main>
  );
}

async function readPaymentStatus(orderId: string) {
  if (!UUID_PATTERN.test(orderId)) return "unknown" as const;
  const client = createAdminSupabaseClient();
  if (!client) return "unknown" as const;

  const { data, error } = await client
    .from("orders")
    .select("status,payment_status,discord_ticket_status,late_payment_detected_at,stock_commit_failure_reason,payment_reference")
    .eq("id", orderId)
    .maybeSingle();
  if (error) return "unknown" as const;
  if (data) {
    // Existing provider checkouts may still point at this historical URL.
    // The destination page authenticates the buyer before exposing the order.
    if (IS_GWSTORE && data.payment_reference?.startsWith("web:")) redirect(`/minhas-compras/${orderId}`);
    return resolvePaymentReturnStatus(data);
  }

  const { data: robux, error: robuxError } = await client
    .from("robux_orders")
    .select("status,payment_status,discord_ticket_status,discord_ticket_delivery_completed_at")
    .eq("id", orderId)
    .maybeSingle();
  if (robuxError || !robux) return "unknown" as const;
  return resolvePaymentReturnStatus({
    ...robux,
    status: robux.payment_status === "paid" && robux.discord_ticket_delivery_completed_at
      ? "delivered" : robux.status,
    late_payment_detected_at: null,
    stock_commit_failure_reason: null,
  });
}
