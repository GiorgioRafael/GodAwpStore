"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { startPaymentLink, type PaymentLinkResult } from "@/app/cobrar/actions";

export function PublicPaymentForm({ intentId }: { intentId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<PaymentLinkResult, FormData>(
    startPaymentLink.bind(null, intentId),
    { ok: false, message: "" },
  );
  useEffect(() => {
    if (state.ok) router.replace(`/cobrar/${state.token}`);
  }, [state, router]);
  return <form action={action} className="mt-6 space-y-4 text-left">
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor="payer-name">Seu nome</label>
      <input id="payer-name" name="name" required minLength={2} maxLength={80}
        autoComplete="name" placeholder="Como você quer ser identificado"
        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
    </div>
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor="payment-amount">Valor em reais</label>
      <input id="payment-amount" name="amount" required inputMode="decimal"
        placeholder="Ex.: 25,00" aria-describedby="payment-limits"
        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
      <p id="payment-limits" className="mt-1 text-xs text-muted">De R$ 0,80 a R$ 1.000,00 por cobrança.</p>
    </div>
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor="payment-details">Detalhes ou mensagem</label>
      <textarea id="payment-details" name="details" maxLength={500} rows={3}
        placeholder="O que é este pagamento?" className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
    </div>
    {!state.ok && state.message && <p role="alert" className="text-sm text-red-400">{state.message}</p>}
    <button disabled={pending} className="w-full rounded-xl bg-primary px-5 py-3 font-semibold text-black disabled:opacity-60">
      {pending ? "Gerando Pix…" : "Gerar QR Code Pix"}
    </button>
    <p className="text-xs leading-5 text-muted">O nome e a mensagem são informados por você e ficam visíveis apenas para a equipe da loja. O pagamento só é confirmado após a resposta do provedor.</p>
  </form>;
}
