import type { Metadata } from "next";
import { ArrowLeft, Ban, ShieldAlert, Sparkles } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { STORE_SLUG } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Acesso negado",
};

export default function AccessDeniedPage() {
  return (
    <Card className="overflow-hidden border-danger/20 bg-surface/95 shadow-[0_28px_90px_rgba(0,0,0,.48)]">
      <div className="h-px bg-gradient-to-r from-transparent via-danger/70 to-transparent" />
      <div className="p-6 text-center sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-danger/25 bg-danger/[0.08] text-danger">
          <Ban aria-hidden="true" className="size-6" />
        </span>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.17em] text-danger">Permissão insuficiente</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">Acesso não autorizado</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted">
          Sua conta Discord foi autenticada, mas o ID não está na lista de administradores deste painel.
        </p>

        {/* Sem isto a página é um beco sem saída: a raiz do site é o painel, e
            um jogador que entra por ela autentica, é recusado aqui, e a única
            saída o devolve ao login do painel. A roleta é o que ele veio usar. */}
        {STORE_SLUG === "gwstore" ? (
          <>
            <LinkButton href="/roleta" size="lg" className="mt-7 w-full">
              <Sparkles aria-hidden="true" className="size-4" />
              Ir para a roleta
            </LinkButton>
            <p className="mt-3 text-xs leading-5 text-muted">
              A roleta é aberta a qualquer conta do Discord — você já está logado.
            </p>
          </>
        ) : null}

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-3.5 text-left">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs leading-5 text-muted">
            Se você deveria ter acesso, confirme o Discord ID configurado com o responsável pela plataforma.
          </p>
        </div>

        <LinkButton href="/login" variant="secondary" className="mt-4 w-full">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Voltar para o login
        </LinkButton>
      </div>
    </Card>
  );
}
