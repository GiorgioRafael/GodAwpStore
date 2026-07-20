"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-field";

export function ReferralLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input value={url} readOnly aria-label="Seu link de indicação" />
      <Button type="button" variant="secondary" onClick={copy}>
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
        {copied ? "Copiado" : "Copiar link"}
      </Button>
    </div>
  );
}
