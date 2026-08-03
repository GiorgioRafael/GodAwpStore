import type { ReactNode } from "react";
import Link from "next/link";
import {
  Bot,
  Building2,
  ChartNoAxesCombined,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
} from "lucide-react";

const navigation = [
  { label: "Visão geral", href: "#visao-geral", icon: LayoutDashboard },
  { label: "Empresas", href: "#empresas", icon: Building2 },
  { label: "Bots", href: "#empresas", icon: Bot },
  { label: "Financeiro", href: "#financeiro", icon: ChartNoAxesCombined },
  { label: "Configurações", href: "#comissao", icon: Settings2 },
];

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
      href="/admin/discordbots"
      aria-label="101Devs — visão geral dos bots"
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
        <nav aria-label="Navegação do painel 101Devs" className="mt-12 flex-1 space-y-2">
          {navigation.map((item, index) => {
            const Icon = item.icon;
            return (
              <a
                key={item.label}
                href={item.href}
                aria-current={index === 0 ? "page" : undefined}
                className={
                  index === 0
                    ? "relative flex h-12 items-center gap-3 rounded-xl border border-violet-400/10 bg-violet-500/[0.12] px-7 text-sm font-medium text-white before:absolute before:inset-y-0 before:-left-3 before:w-1 before:rounded-r-full before:bg-violet-500"
                    : "flex h-12 items-center gap-3 rounded-xl px-7 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.035] hover:text-white"
                }
              >
                <Icon
                  aria-hidden="true"
                  className={index === 0 ? "size-[19px] text-violet-400" : "size-[19px]"}
                  strokeWidth={1.8}
                />
                {item.label}
              </a>
            );
          })}
        </nav>

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
            <form action="/auth/logout?next=/admin/discordbots" method="post">
              <button
                type="submit"
                className="grid size-9 place-items-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
                aria-label="Sair do painel"
              >
                <LogOut aria-hidden="true" className="size-4" />
              </button>
            </form>
          </div>
          <nav aria-label="Atalhos do painel" className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none]">
            {navigation.map((item, index) => (
              <a
                key={item.label}
                href={item.href}
                className={
                  index === 0
                    ? "shrink-0 rounded-lg bg-violet-500/15 px-3 py-2 text-xs font-medium text-violet-200"
                    : "shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-slate-400"
                }
              >
                {item.label}
              </a>
            ))}
          </nav>
        </header>

        <main id="conteudo-master" className="mx-auto w-full max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
