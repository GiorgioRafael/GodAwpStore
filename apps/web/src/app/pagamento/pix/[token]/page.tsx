import type { Metadata } from "next";
import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { IS_GWSTORE } from "@/lib/brand";
import { eclipseDatabase } from "@/lib/eclipsepay/runtime";
import { reconcileEclipsePayments } from "@/lib/eclipsepay/reconciliation";
import { ROULETTE_AVAILABLE } from "@/lib/roulette/availability";
import { PixControls } from "./controls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pagamento Pix · GWStore", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function EclipseCheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!IS_GWSTORE || !/^[a-f0-9]{64}$/.test(token)) notFound();
  const database = eclipseDatabase();
  const { data: checkout, error } = await database.from("eclipsepay_checkouts")
    .select("order_id,amount_cents,operation_status,order_kind,br_code,expires_at,processed_at")
    .eq("checkout_token", token).maybeSingle();
  if (error) throw new Error("Pagamento temporariamente indisponível. Atualize a página.");
  if (!checkout) notFound();
  if (checkout.order_kind === "items") {
    const { data: order, error: orderError } = await database.from("orders")
      .select("payment_reference").eq("id", checkout.order_id).maybeSingle();
    if (orderError || !order) throw new Error("Pedido temporariamente indisponível. Atualize a página.");
    // Web payments stay in the authenticated order workspace, including links
    // already issued before private delivery moved from Discord to the site.
    if (order.payment_reference?.startsWith("web:")) redirect(`/minhas-compras/${checkout.order_id}`);
  }
  const status = checkout.operation_status as string;
  const expired = isExpired(checkout.expires_at);
  const pending = status === "pending";
  const code = pending && !expired ? checkout.br_code as string | null : null;
  const qr = code ? await QRCode.toDataURL(code, { width: 280, margin: 2, errorCorrectionLevel: "M" }) : null;
  if (pending) after(async () => { await reconcileEclipsePayments(1).catch(() => undefined); });
  const title = status === "completed" ? "Pagamento confirmado" : status === "refunded" ? "Pagamento estornado" : status === "failed" || expired ? "Pix não concluído" : "Pague com Pix";
  return <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-surface p-7 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">GWStore · EclipsePay</p>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-3xl font-bold">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(checkout.amount_cents) / 100)}</p>
      {qr && <>
        <p className="mt-4 text-sm text-muted">Abra o aplicativo do banco e escaneie o QR Code ou copie o código abaixo. Confira o valor antes de pagar.</p>
        {/* Local data URL: the Pix is never sent to a third-party QR service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mx-auto mt-5 rounded-xl" src={qr} alt="QR Code do pagamento Pix" width={280} height={280} />
      </>}
      {pending && !code && !expired && <p className="mt-5 text-sm">Preparando seu código Pix. Esta página atualiza automaticamente.</p>}
      {status === "completed" && <p className="mt-5 text-sm">{!checkout.processed_at ? "Seu Pix foi confirmado. Estamos finalizando o pedido; não pague novamente." : checkout.order_kind === "coins" ? ROULETTE_AVAILABLE ? "Suas moedas foram creditadas. Volte à roleta." : "Seu pagamento anterior foi confirmado. Fale com a equipe da GWStore para conferir o saldo ou solicitar atendimento." : "Volte ao Discord para acompanhar seu ticket privado de entrega."}</p>}
      {(status === "failed" || expired) && status !== "completed" && <p className="mt-5 text-sm">Não pague um código vencido. Se já pagou, aguarde a confirmação ou fale com a equipe no Discord.</p>}
      {status === "refunded" && <p className="mt-5 text-sm">A EclipsePay informou um estorno. Fale com a equipe da GWStore antes de tentar novamente.</p>}
      <PixControls code={code} pending={pending || status === "completed" && !checkout.processed_at} />
      {ROULETTE_AVAILABLE && checkout.order_kind === "coins" && status === "completed" && <a className="mt-4 block text-primary underline" href="/roleta">Voltar à roleta</a>}
      <p className="mt-4 text-xs text-muted">Nunca envie comprovantes com dados sensíveis no chat público. A confirmação é feita diretamente com o provedor.</p>
    </section>
  </main>;
}

// Evaluated on the server for each dynamic request, never from the browser clock.
function isExpired(expiresAt: string | null) {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}
