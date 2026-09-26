"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw } from "lucide-react";

import styles from "@/app/pagar/payment-link.module.css";

export function PublicPixControls({ code, pending }: { code: string | null; pending: boolean }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [pending, router]);

  return <div>
    {code && <>
      <label className={styles.codeLabel} htmlFor="public-pix-code">Pix copia e cola</label>
      <textarea id="public-pix-code" className={styles.code} readOnly value={code} rows={3}
        onFocus={(event) => event.currentTarget.select()} />
    </>}
    <div className={styles.receiptActions}>
      {code && <button type="button" className={styles.primaryButton} onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setNotice("Código copiado. Cole no aplicativo do seu banco.");
        } catch {
          setNotice("Selecione e copie o código no campo acima.");
        }
      }}><Copy aria-hidden="true" size={18} /> Copiar código Pix</button>}
      <button type="button" className={styles.secondaryButton} onClick={() => router.refresh()}>
        <RefreshCw aria-hidden="true" size={18} /> Atualizar status
      </button>
    </div>
    <p role="status" className={styles.notice}>{notice}</p>
  </div>;
}
