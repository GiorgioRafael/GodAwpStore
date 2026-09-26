import type { Metadata } from "next";
import Image from "next/image";
import { after } from "next/server";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CircleAlert, CircleCheck, Clock3, LockKeyhole } from "lucide-react";

import { IS_GWSTORE } from "@/lib/brand";
import { eclipseDatabase } from "@/lib/eclipsepay/runtime";
import { reconcileEclipsePaymentLinks } from "@/lib/eclipsepay/payment-link-reconciliation";
import { PaymentBrand } from "@/app/pagar/payment-brand";
import styles from "@/app/pagar/payment-link.module.css";
import { retryPaymentLink } from "../actions";
import { PublicPixControls } from "./controls";

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
  const expired = pending && isExpired(link.expires_at);
  const brCode = pending && !expired ? link.br_code as string | null : null;
  const qr = brCode ? await QRCode.toDataURL(brCode, { width: 280, margin: 2, errorCorrectionLevel: "M" }) : null;
  if (pending && link.operation_id) {
    after(async () => { await reconcileEclipsePaymentLinks(1).catch(() => undefined); });
  }
  return <main className={styles.page}>
    <section className={styles.card}>
      <PaymentBrand />
      <p className={`${styles.status} ${status === "completed" ? styles.statusSuccess : ""} ${expired || status === "failed" || status === "refunded" ? styles.statusError : ""}`}>
        {status === "completed" ? <CircleCheck aria-hidden="true" size={16} /> : expired || status === "failed" || status === "refunded" ? <CircleAlert aria-hidden="true" size={16} /> : <Clock3 aria-hidden="true" size={16} />}
        {status === "completed" ? "Confirmado" : status === "refunded" ? "Estornado" : expired ? "Código vencido" : pending ? "Aguardando pagamento" : "Não concluído"}
      </p>
      <h1 className={styles.title}>
        {status === "completed" ? "Pagamento confirmado" : status === "refunded" ? "Pagamento estornado" : expired ? "Código Pix vencido" : pending ? "Pague com Pix" : "Link indisponível"}
      </h1>
      <p className={styles.amount}>{money(link.amount_cents)}</p>
      {pending && !link.operation_id && <>
        <p className={styles.description}>A cobrança ainda está sendo preparada. Você pode tentar novamente sem gerar outra cobrança.</p>
        <form action={retryPaymentLink.bind(null, token)} className={styles.receiptActions}>
          <button className={styles.primaryButton}>Tentar gerar o Pix novamente</button>
        </form>
      </>}
      {pending && link.operation_id && <div className={styles.receiptBody}>
        {qr && <>
          <p className={styles.description}>Escaneie o QR Code com seu banco ou copie o código Pix. Confira o valor antes de pagar.</p>
          <div className={styles.qrFrame}><Image unoptimized src={qr} alt="QR Code do pagamento Pix" width={280} height={280} /></div>
        </>}
        {!qr && !expired && <p className={styles.description}>Preparando seu código Pix. A página atualiza automaticamente.</p>}
        {expired && <p className={styles.error}>Este código Pix venceu. Peça um novo link à loja; não pague um código vencido.</p>}
        <PublicPixControls code={brCode} pending={!expired} />
      </div>}
      {status === "completed" && <p className={styles.description}>Recebemos a confirmação do provedor. Obrigado pelo pagamento.</p>}
      {status === "refunded" && <p className={styles.description}>O provedor informou estorno desta cobrança. Fale com a loja se precisar de ajuda.</p>}
      {status === "failed" && <p className={styles.description}>Este Pix não pode mais ser pago. Abra o link público novamente para gerar outro.</p>}
      <p className={styles.receiptNote}><LockKeyhole aria-hidden="true" size={16} className={styles.finePrintIcon} /> A confirmação depende do estado da cobrança na EclipsePay. Não envie comprovantes ou dados bancários por mensagem.</p>
    </section>
  </main>;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
}

function isExpired(value: string | null) {
  return value !== null && Date.parse(value) <= Date.now();
}
