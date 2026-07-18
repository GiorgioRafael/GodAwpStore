import type { Metadata } from "next";

import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  paymentReturnCopy,
  resolvePaymentReturnStatus,
} from "@/lib/livepix/payment-return";
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
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">GWStore · LivePix</p>
        <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">{content.title}</h1>
        <p className="mt-4 text-sm leading-6 text-muted">{content.description}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <LinkButton href={`/pagamento/${encodeURIComponent(orderId)}`}>Atualizar status</LinkButton>
          <LinkButton href="/" variant="secondary">Abrir GWStore</LinkButton>
        </div>
        <p className="mt-6 text-xs text-muted">A confirmação válida vem diretamente da LivePix.</p>
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
    .select("status,payment_status,discord_ticket_status,late_payment_detected_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return "unknown" as const;
  return resolvePaymentReturnStatus(data);
}
