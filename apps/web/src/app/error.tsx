"use client";

import { AlertOctagon, RotateCcw } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Brand } from "@/components/layout/brand";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-12 text-center">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(239,111,108,.09),transparent_32%)]" />
      <div className="relative max-w-md">
        <div className="mb-10 flex justify-center">
          <Brand />
        </div>
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-danger/25 bg-danger/[0.08] text-danger">
          <AlertOctagon aria-hidden="true" className="size-6" />
        </span>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.17em] text-danger">Falha inesperada</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Não foi possível carregar</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          A operação foi interrompida com segurança. Tente novamente; nenhuma alteração incompleta deve ser confirmada.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-muted/70">Referência: {error.digest}</p>
        ) : null}
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={() => unstable_retry()}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Tentar novamente
          </Button>
          <LinkButton href="/" variant="secondary">Voltar ao painel</LinkButton>
        </div>
      </div>
    </main>
  );
}
