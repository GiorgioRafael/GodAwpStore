import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, LockKeyhole, MessageCircleMore, ShieldCheck } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Entrar",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; erro?: string }>;
}) {
  const query = await searchParams;
  const feedback = query.setup
    ? "O login ainda precisa das variáveis do Supabase e do Discord neste ambiente."
    : query.erro
      ? "Não foi possível concluir o login com o Discord. Tente novamente ou revise a configuração do OAuth."
      : null;

  return (
    <Card className="overflow-hidden border-border-strong bg-surface/95 shadow-[0_28px_90px_rgba(0,0,0,.48)] backdrop-blur-xl">
      <div className="h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
      <div className="p-6 sm:p-8">
        <div className="mb-6 grid size-12 place-items-center rounded-2xl border border-gold/25 bg-gold/[0.08] text-gold-bright shadow-gold">
          <LockKeyhole aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-gold">Acesso administrativo</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-foreground">
          Entre no painel
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Use sua conta Discord. Apenas IDs autorizados na configuração administrativa poderão continuar.
        </p>

        {feedback ? (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/[0.07] p-3.5 text-left">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-xs leading-5 text-muted-strong">{feedback}</p>
          </div>
        ) : null}

        <LinkButton href="/auth/login?next=/" size="lg" className="mt-7 w-full justify-between px-4">
          <span className="flex items-center gap-2.5">
            <MessageCircleMore aria-hidden="true" className="size-[18px]" />
            Continuar com Discord
          </span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </LinkButton>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-3.5">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          <p className="text-xs leading-5 text-muted">
            A autenticação confirma sua identidade; permissões administrativas são verificadas separadamente no servidor.
          </p>
        </div>
      </div>
    </Card>
  );
}
