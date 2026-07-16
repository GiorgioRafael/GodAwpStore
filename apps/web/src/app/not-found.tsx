import { Compass, Home } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Brand } from "@/components/layout/brand";

export default function NotFound() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-12 text-center">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(212,166,74,.1),transparent_32%)]" />
      <div className="relative max-w-md">
        <div className="mb-10 flex justify-center">
          <Brand />
        </div>
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-gold/20 bg-gold/[0.07] text-gold-bright shadow-gold">
          <Compass aria-hidden="true" className="size-6" />
        </span>
        <p className="mt-6 font-mono text-sm font-semibold tracking-[0.18em] text-gold">ERRO 404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Página não encontrada</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          O endereço pode ter mudado ou não fazer parte deste painel administrativo.
        </p>
        <LinkButton href="/" className="mt-7">
          <Home aria-hidden="true" className="size-4" />
          Voltar ao painel
        </LinkButton>
      </div>
    </main>
  );
}
