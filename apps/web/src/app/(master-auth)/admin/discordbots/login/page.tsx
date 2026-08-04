import { AlertTriangle, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { MASTER_ADMIN_ROOT } from "@/lib/master-admin-auth";

export default async function MasterAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; erro?: string; next?: string }>;
}) {
  const query = await searchParams;
  const next = query.next ?? MASTER_ADMIN_ROOT;
  const authHref = `/auth/google/login?next=${encodeURIComponent(next)}`;
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
          Use a conta Google autorizada. Esta área centraliza empresas, bots, faturamento e comissões.
        </p>

        {feedback ? (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3.5">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <p className="text-xs leading-5 text-slate-300">{feedback}</p>
          </div>
        ) : null}

        <a
          href={authHref}
          className={cn(
            buttonStyles({ size: "lg" }),
            "mt-7 w-full justify-between bg-violet-500 px-4 text-white hover:bg-violet-400",
          )}
        >
          <span className="flex items-center gap-2.5">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none">
              <path fill="#fff" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
              <path fill="#fff" fillOpacity=".9" d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
              <path fill="#fff" fillOpacity=".8" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.55l3.35-2.62Z" />
              <path fill="#fff" fillOpacity=".7" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
            </svg>
            Continuar com Google
          </span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-800 bg-white/[0.02] p-3.5">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <p className="text-xs leading-5 text-slate-400">
            Somente o e-mail Google autorizado pode entrar. A validação é refeita no servidor em cada acesso.
          </p>
        </div>
      </div>
    </Card>
  );
}
