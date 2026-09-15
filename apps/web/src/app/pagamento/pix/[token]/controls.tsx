"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function PixControls({ code, pending }: { code: string | null; pending: boolean }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [pending, router]);
  return <div className="mt-5 space-y-3">
    {code && <>
      <label className="block text-left text-sm" htmlFor="pix-code">Pix copia e cola</label>
      <textarea id="pix-code" readOnly value={code} className="w-full rounded-xl border border-white/20 bg-black/20 p-3 text-xs" rows={3} onFocus={(event) => event.target.select()} />
      <button type="button" className="w-full rounded-xl bg-primary px-5 py-3 font-semibold text-black" onClick={async () => {
        try { await navigator.clipboard.writeText(code); setNotice("Código copiado. Cole no aplicativo do seu banco."); }
        catch { setNotice("Selecione e copie o código no campo acima."); }
      }}>Copiar código Pix</button>
    </>}
    <button type="button" className="w-full rounded-xl border border-white/20 px-5 py-3" onClick={() => router.refresh()}>Atualizar status</button>
    <p role="status" className="text-sm text-muted">{notice}</p>
  </div>;
}
