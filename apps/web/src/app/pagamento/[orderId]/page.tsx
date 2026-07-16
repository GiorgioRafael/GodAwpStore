import type { Metadata } from "next";

import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const content = paymentCopy(status);

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
    .select("status,payment_status,discord_ticket_status")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return "unknown" as const;
  if (data.discord_ticket_status === "open") return "ticket_open" as const;
  if (["paid", "processing", "delivered"].includes(data.status)) return "paid" as const;
  if (data.payment_status === "failed" || data.status === "failed") return "failed" as const;
  return "pending" as const;
}

function paymentCopy(status: Awaited<ReturnType<typeof readPaymentStatus>>) {
  if (status === "ticket_open") {
    return {
      title: "Pagamento confirmado",
      description: "Seu ticket privado já foi criado no Discord. Volte ao servidor para receber o atendimento.",
    };
  }
  if (status === "paid") {
    return {
      title: "Pagamento confirmado",
      description: "Recebemos a confirmação e estamos abrindo seu ticket privado no Discord.",
    };
  }
  if (status === "failed") {
    return {
      title: "Não foi possível confirmar",
      description: "A cobrança não foi confirmada. Volte ao Discord e tente novamente ou fale com um administrador.",
    };
  }
  if (status === "pending") {
    return {
      title: "Aguardando confirmação",
      description: "Se você concluiu o Pix, aguarde alguns instantes enquanto a LivePix confirma o pagamento.",
    };
  }
  return {
    title: "Status indisponível",
    description: "Não encontramos esse retorno de pagamento. Volte ao Discord e confira o pedido.",
  };
}
