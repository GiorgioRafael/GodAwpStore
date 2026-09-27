"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";

export function PublicPaymentLink({ url }: { url: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="space-y-2">
      <input
        aria-label="Link público para receber Pix"
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={copyLink} size="sm">
          {copyState === "copied" ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {copyState === "copied" ? "Link copiado" : "Copiar link para compradores"}
        </Button>
        <LinkButton href="/pagar" target="_blank" rel="noopener noreferrer" size="sm" variant="secondary">
          <ExternalLink aria-hidden="true" className="size-4" />
          Conferir página pública
        </LinkButton>
      </div>
      {copyState === "failed" && <p role="status" className="text-xs text-warning">Não foi possível copiar automaticamente. Selecione o endereço acima para copiá-lo.</p>}
    </div>
  );
}
