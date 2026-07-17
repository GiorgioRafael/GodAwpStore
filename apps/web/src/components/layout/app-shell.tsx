"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LockKeyhole, LogOut, Menu, MoreHorizontal, X } from "lucide-react";
import { Brand } from "./brand";
import {
  getCurrentPageLabel,
  isNavigationItemActive,
  mobileNavigation,
  navigationGroups,
} from "./navigation";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";

type ShellIdentity = {
  displayName: string;
  discordId: string;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AD";
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação principal" className="space-y-6">
      {navigationGroups.map((group, index) => (
        <div key={group.label ?? "overview"}>
          {group.label ? (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/75">
              {group.label}
            </p>
          ) : null}
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = isNavigationItemActive(pathname, item.href);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                      active
                        ? "bg-gold/[0.1] font-medium text-gold-bright"
                        : "text-muted hover:bg-white/[0.04] hover:text-foreground",
                    )}
                  >
                    {active ? (
                      <span className="absolute -left-[13px] h-5 w-0.5 rounded-full bg-gold shadow-[0_0_10px_rgba(212,166,74,.7)]" />
                    ) : null}
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "size-[17px] shrink-0 transition-colors",
                        active ? "text-gold" : "text-muted group-hover:text-muted-strong",
                      )}
                      strokeWidth={1.8}
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {index === 0 ? <div className="mx-3 mt-5 h-px bg-border/80" /> : null}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({ identity }: { identity: ShellIdentity }) {
  return (
    <div className="rounded-2xl border border-border bg-white/[0.018] p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.07] text-xs font-semibold text-gold-bright">
          {initials(identity.displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{identity.displayName}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
            <LockKeyhole aria-hidden="true" className="size-3 text-success" />
            Sessão protegida
          </p>
        </div>
        <ChevronDown aria-hidden="true" className="size-4 text-muted" />
      </div>
    </div>
  );
}

export function AppShell({ children, identity }: { children: ReactNode; identity: ShellIdentity }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#conteudo-principal"
        className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-[#171208] transition-transform focus:translate-y-0"
      >
        Ir para o conteúdo
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-border bg-[#0b0b09]/95 px-4 py-5 backdrop-blur-xl lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <div className="my-6 h-px bg-gradient-to-r from-transparent via-border-strong to-transparent" />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-6 [scrollbar-width:thin]">
          <Navigation />
        </div>
        <SidebarFooter identity={identity} />
      </aside>

      <div className="min-h-screen lg:pl-72">
        <header className="sticky top-0 z-30 flex h-[72px] items-center border-b border-border bg-background/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
              aria-controls="menu-mobile"
              onClick={() => setMenuOpen(true)}
            >
              <Menu aria-hidden="true" className="size-5" />
            </Button>
            <div className="lg:hidden">
              <Brand compact />
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                Administração
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                {getCurrentPageLabel(pathname)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden items-center gap-2 rounded-full border border-success/20 bg-success/[0.06] px-3 py-1.5 text-xs text-muted-strong md:flex">
              <span className="size-1.5 rounded-full bg-success shadow-[0_0_8px_rgba(101,201,139,.8)]" />
              Painel interno
            </div>
            <form action="/auth/logout" method="post">
              <Button
                type="submit"
                variant="danger"
                size="sm"
                aria-label={`Sair da conta ${identity.displayName}`}
                title={`Sair da conta ${identity.displayName}`}
              >
                <LogOut aria-hidden="true" className="size-4" strokeWidth={1.8} />
                <span>Sair</span>
              </Button>
            </form>
          </div>
        </header>

        <main
          id="conteudo-principal"
          className="mx-auto w-full max-w-[1600px] px-4 py-6 pb-28 sm:px-6 sm:py-8 lg:px-8 lg:pb-10"
        >
          {children}
        </main>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm transition-opacity lg:hidden",
          menuOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!menuOpen}
        onClick={() => setMenuOpen(false)}
      />
      <aside
        id="menu-mobile"
        aria-label="Menu móvel"
        aria-hidden={!menuOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-[60] flex w-[min(88vw,21rem)] flex-col border-r border-border bg-[#0b0b09] px-4 py-5 shadow-[20px_0_60px_rgba(0,0,0,.5)] transition-transform duration-200 lg:hidden",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-2">
          <Brand />
          <Button variant="ghost" size="icon" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}>
            <X aria-hidden="true" className="size-5" />
          </Button>
        </div>
        <div className="my-6 h-px bg-border" />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-6">
          <Navigation onNavigate={() => setMenuOpen(false)} />
        </div>
        <SidebarFooter identity={identity} />
      </aside>

      <nav
        aria-label="Atalhos móveis"
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-border-strong bg-[#12120f]/95 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.55)] backdrop-blur-xl lg:hidden"
      >
        {mobileNavigation.map((item) => {
          const Icon = item.icon;
          const active = isNavigationItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] transition-colors",
                active ? "bg-gold/[0.1] text-gold-bright" : "text-muted",
              )}
            >
              <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
          aria-label="Ver todas as áreas"
        >
          <MoreHorizontal aria-hidden="true" className="size-[18px]" />
          <span>Mais</span>
        </button>
      </nav>
    </div>
  );
}
