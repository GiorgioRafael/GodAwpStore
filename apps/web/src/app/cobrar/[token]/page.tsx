import type { Metadata } from "next";
import Image from "next/image";
import { after } from "next/server";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { IS_GWSTORE } from "@/lib/brand";
import { eclipseDatabase } from "@/lib/eclipsepay/runtime";
import { reconcileEclipsePaymentLinks } from "@/lib/eclipsepay/payment-link-reconciliation";
import { PixControls } from "@/app/pagamento/pix/[token]/controls";
import { retryPaymentLink } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pagamento Pix · GWStore",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PaymentLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!IS_GWSTORE || !/^[0-9a-f]{64}$/.test(token)) notFound();
  const { data: link, error } = await eclipseDatabase().from("eclipsepay_payment_links")
    .select("amount_cents,operation_id,operation_status,br_code,expires_at")
    .eq("link_token", token).maybeSingle();
  if (error) throw new Error("Link Pix temporariamente indisponível.");
  if (!link) notFound();

  const status = link.operation_status as string;
  const pending = status === "pending";
  const expired = isExpired(link.expires_at);
  const brCode = pending && !expired ? link.br_code as string | null : null;
  const qr = brCode ? await QRCode.toDataURL(brCode, { width: 280, margin: 2, errorCorrectionLevel: "M" }) : null;
  if (pending && link.operation_id) {
    after(async () => { await reconcileEclipsePaymentLinks(1).catch(() => undefined); });
  }
  return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
    <section className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-panel sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">GWStore · Pix</p>
      <h1 className="mt-3 text-2xl font-semibold">
        {status === "completed" ? "Pagamento confirmado" : status === "refunded" ? "Pagamento estornado" : pending ? "Pague com Pix" : "Link indisponível"}
      </h1>
      {pending && !link.operation_id && <>
        <p className="mt-2 text-sm text-muted">A cobrança ainda está sendo preparada. Você pode tentar novamente sem gerar outra cobrança.</p>
        <form action={retryPaymentLink.bind(null, token)} className="mt-4">
          <button className="w-full rounded-xl bg-primary px-5 py-3 font-semibold text-black">Tentar gerar o Pix novamente</button>
        </form>
      </>}
      <p className="mt-4 text-3xl font-bold">{money(link.amount_cents)}</p>
      {pending && link.operation_id && <>
        {qr && <>
          <p className="mt-4 text-sm text-muted">Escaneie o QR Code com seu banco ou copie o código Pix. Confira o valor antes de pagar.</p>
          <Image className="mx-auto mt-5 rounded-xl" unoptimized src={qr} alt="QR Code do pagamento Pix" width={280} height={280} />
        </>}
        {!qr && !expired && <p className="mt-4 text-sm text-muted">Preparando seu código Pix. A página atualiza automaticamente.</p>}
        {expired && <p className="mt-4 text-sm text-red-400">Este código Pix venceu. Peça um novo link à loja; não pague um código vencido.</p>}
        <PixControls code={brCode} pending={!expired} />
      </>}
      {status === "completed" && <p className="mt-4 text-sm text-muted">Recebemos a confirmação do provedor. Obrigado pelo pagamento.</p>}
      {status === "refunded" && <p className="mt-4 text-sm text-muted">O provedor informou estorno desta cobrança. Fale com a loja se precisar de ajuda.</p>}
      {status === "failed" && <p className="mt-4 text-sm text-muted">Este Pix não pode mais ser pago. Abra o link público novamente para gerar outro.</p>}
      <p className="mt-6 text-xs leading-5 text-muted">A confirmação depende do estado da cobrança na EclipsePay. Não envie comprovantes ou dados bancários por mensagem.</p>
    </section>
  </main>;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
}

function isExpired(value: string | null) {
  return value !== null && Date.parse(value) <= Date.now();
}
