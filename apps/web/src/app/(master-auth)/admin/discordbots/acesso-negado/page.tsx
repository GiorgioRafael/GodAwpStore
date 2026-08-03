import { ArrowLeft, Ban, ShieldAlert } from "lucide-react";

import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MASTER_ADMIN_LOGIN, MASTER_ADMIN_ROOT } from "@/lib/master-admin-auth";

export default function MasterAdminAccessDeniedPage() {
  return (
    <Card className="overflow-hidden border-rose-400/20 bg-[#0b121c]/95 shadow-[0_28px_90px_rgba(0,0,0,.52)]">
      <div className="h-px bg-gradient-to-r from-transparent via-rose-400/70 to-transparent" />
      <div className="p-6 text-center sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-rose-400/25 bg-rose-400/[0.08] text-rose-300">
          <Ban aria-hidden="true" className="size-6" />
        </span>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.17em] text-rose-300">
          Administração 101Devs
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white">Acesso não autorizado</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">
          O Discord foi autenticado, mas este ID não está na lista privada de administradores da 101Devs.
        </p>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-800 bg-white/[0.02] p-3.5 text-left">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <p className="text-xs leading-5 text-slate-400">
            Entre com a conta Discord cadastrada para administrar as empresas e os bots.
          </p>
        </div>

        <LinkButton
          href={`${MASTER_ADMIN_LOGIN}?next=${encodeURIComponent(MASTER_ADMIN_ROOT)}`}
          variant="secondary"
          className="mt-5 w-full border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Voltar para o login da 101Devs
        </LinkButton>
      </div>
    </Card>
  );
}
