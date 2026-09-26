"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { startPaymentLink, type PaymentLinkResult } from "@/app/cobrar/actions";
import styles from "./payment-link.module.css";

export function PublicPaymentForm({ intentId }: { intentId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<PaymentLinkResult, FormData>(
    startPaymentLink.bind(null, intentId),
    { ok: false, message: "" },
  );
  useEffect(() => {
    if (state.ok) router.replace(`/cobrar/${state.token}`);
  }, [state, router]);
  return <form action={action} className={styles.form}>
    <div className={styles.field}>
      <label className={styles.label} htmlFor="payer-name">Seu nome</label>
      <input id="payer-name" name="name" required minLength={2} maxLength={80}
        autoComplete="name" placeholder="Como você quer ser identificado"
        className={styles.input} />
    </div>
    <div className={styles.field}>
      <label className={styles.label} htmlFor="payment-amount">Valor em reais</label>
      <div className={styles.amountWrap}>
        <span className={styles.amountPrefix} aria-hidden="true">R$</span>
        <input id="payment-amount" name="amount" required inputMode="decimal"
          placeholder="Ex.: 25,00" aria-describedby="payment-limits"
          className={`${styles.input} ${styles.amountInput}`} />
      </div>
      <p id="payment-limits" className={styles.hint}>Escolha um valor entre R$ 0,80 e R$ 1.000,00.</p>
    </div>
    <div className={styles.field}>
      <label className={styles.label} htmlFor="payment-details">Detalhes ou mensagem <span className={styles.optional}>(opcional)</span></label>
      <textarea id="payment-details" name="details" maxLength={500} rows={3}
        placeholder="O que é este pagamento?" className={styles.textarea} />
    </div>
    {!state.ok && state.message && <p role="alert" className={styles.error}>{state.message}</p>}
    <button disabled={pending} className={styles.primaryButton}>
      <QrCode aria-hidden="true" size={20} strokeWidth={2.2} />
      {pending ? "Gerando Pix…" : "Gerar QR Code Pix"}
    </button>
  </form>;
}
