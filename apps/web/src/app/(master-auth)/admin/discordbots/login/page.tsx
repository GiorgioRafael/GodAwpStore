import { AlertTriangle, ArrowRight, LockKeyhole, MessageCircleMore, ShieldCheck } from "lucide-react";

import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MASTER_ADMIN_ROOT } from "@/lib/master-admin-auth";

export default async function MasterAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; erro?: string; next?: string }>;
}) {
  const query = await searchParams;
  const next = query.next ?? MASTER_ADMIN_ROOT;
  const authHref = `/auth/login?next=${encodeURIComponent(next)}`;
  const feedback = query.setup
    ? "O login administrativo ainda não está configurado neste ambiente."
    : query.erro
      ? "Não foi possível concluir o login com o Discord. Tente novamente."
      : null;

  return (
    <Card className="overflow-hidden border-slate-700/80 bg-[#0b121c]/95 shadow-[0_28px_90px_rgba(0,0,0,.52)] backdrop-blur-xl">
      <div className="h-px bg-gradient-to-r from-transparent via-violet-400/80 to-transparent" />
      <div className="p-6 sm:p-8">
        <div className="mb-6 grid size-12 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-300 shadow-[0_0_28px_rgba(139,92,246,.15)]">
          <LockKeyhole aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-violet-300">
          Administração 101Devs
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white">
          Entre no painel mestre
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Use seu Discord autorizado. Esta área centraliza empresas, bots, faturamento e comissões.
        </p>

        {feedback ? (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3.5">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <p className="text-xs leading-5 text-slate-300">{feedback}</p>
          </div>
        ) : null}

        <LinkButton href={authHref} size="lg" className="mt-7 w-full justify-between bg-violet-500 px-4 text-white hover:bg-violet-400">
          <span className="flex items-center gap-2.5">
            <MessageCircleMore aria-hidden="true" className="size-[18px]" />
            Continuar com Discord
          </span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </LinkButton>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-800 bg-white/[0.02] p-3.5">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <p className="text-xs leading-5 text-slate-400">
            A conta é autenticada pelo Discord e validada contra a lista privada de administradores.
          </p>
        </div>
      </div>
    </Card>
  );
}
