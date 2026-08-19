import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";

import { MasterAdminNav } from "@/components/platform/master-admin-nav";
import { MASTER_ADMIN_ROOT } from "@/lib/master-admin-auth";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AD"
  );
}

function Brand() {
  return (
    <Link
      href={MASTER_ADMIN_ROOT}
      aria-label="101Devs — visão geral dos produtos"
      className="inline-flex items-center rounded-lg text-[21px] font-semibold tracking-tight text-white focus-visible:outline-none"
    >
      <span className="font-mono font-bold tracking-[0.08em] text-violet-400">101</span>
      <span>Devs</span>
    </Link>
  );
}

export function MasterAdminShell({
  children,
  identity,
}: {
  children: ReactNode;
  identity: { displayName: string; email: string };
}) {
  return (
    <div className="min-h-screen bg-[#070b12] text-slate-50 [color-scheme:dark]">
      <a
        href="#conteudo-master"
        className="fixed left-4 top-3 z-[80] -translate-y-24 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        Ir para o conteúdo
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-800/90 bg-[#08101a] px-3 py-7 lg:flex">
        <div className="px-7">
          <Brand />
        </div>
        <MasterAdminNav variant="sidebar" />

        <div className="mx-3 rounded-xl border border-slate-800 bg-white/[0.018] p-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-violet-400/20 bg-violet-500/10 text-xs font-semibold text-violet-200">
              {initials(identity.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{identity.displayName}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{identity.email}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck aria-hidden="true" className="size-3 text-emerald-400" />
                Acesso privado
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#070b12]/90 px-4 backdrop-blur-xl lg:hidden">
          <div className="flex h-16 items-center justify-between gap-4">
            <Brand />
            <form action={`/auth/logout?next=${MASTER_ADMIN_ROOT}`} method="post">
              <button
                type="submit"
                className="grid size-9 place-items-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
                aria-label="Sair do painel"
              >
                <LogOut aria-hidden="true" className="size-4" />
              </button>
            </form>
          </div>
          <MasterAdminNav variant="mobile" />
        </header>

        <main id="conteudo-master" className="mx-auto w-full max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
