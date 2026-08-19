"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CakeSlice, LayoutDashboard, Store, type LucideIcon } from "lucide-react";

import { MASTER_ADMIN_ROOT } from "@/lib/master-admin-auth";
import { MASTER_ADMIN_TABS } from "@/lib/master-admin-tabs";

/**
 * Navegação entre as abas do painel, uma por produto.
 *
 * A aba ativa sai do caminho da URL em vez de uma prop, para o destaque
 * continuar certo quando a navegação acontece pelo cliente, sem recarregar o
 * layout.
 */

const ICONS: Record<string, LucideIcon> = {
  "visao-geral": LayoutDashboard,
  gwstore: Store,
  "loja-th": Bot,
  "sobremesas-fit": CakeSlice,
};

/**
 * A visão geral é a aba padrão: responde tanto por `/admin` quanto pela URL
 * antiga `/admin/discordbots`, que continua atendida.
 */
export function activeMasterAdminTabId(pathname: string) {
  const match = MASTER_ADMIN_TABS.find(
    (tab) =>
      tab.href !== MASTER_ADMIN_ROOT &&
      (pathname === tab.href || pathname.startsWith(`${tab.href}/`)),
  );
  return match?.id ?? "visao-geral";
}

export function MasterAdminNav({ variant }: { variant: "sidebar" | "mobile" }) {
  const activeId = activeMasterAdminTabId(usePathname() ?? MASTER_ADMIN_ROOT);

  if (variant === "mobile") {
    return (
      <nav
        aria-label="Produtos da 101Devs"
        className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none]"
      >
        {MASTER_ADMIN_TABS.map((tab) => {
          const active = tab.id === activeId;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "shrink-0 rounded-lg bg-violet-500/15 px-3 py-2 text-xs font-medium text-violet-200"
                  : "shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Produtos da 101Devs" className="mt-12 flex-1 space-y-2">
      {MASTER_ADMIN_TABS.map((tab) => {
        const Icon = ICONS[tab.id] ?? LayoutDashboard;
        const active = tab.id === activeId;

        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "relative flex h-12 items-center gap-3 rounded-xl border border-violet-400/10 bg-violet-500/[0.12] px-7 text-sm font-medium text-white before:absolute before:inset-y-0 before:-left-3 before:w-1 before:rounded-r-full before:bg-violet-500"
                : "flex h-12 items-center gap-3 rounded-xl px-7 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.035] hover:text-white"
            }
          >
            <Icon
              aria-hidden="true"
              className={active ? "size-[19px] text-violet-400" : "size-[19px]"}
              strokeWidth={1.8}
            />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
