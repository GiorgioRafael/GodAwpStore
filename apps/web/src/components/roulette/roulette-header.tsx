import { LogOut } from "lucide-react";
import Link from "next/link";

import { logoutRoulette } from "@/app/roleta/actions";
import { BrandMark } from "@/components/layout/brand-mark";
import { STORE_NAME } from "@/lib/brand";

export function RouletteHeader({
  user,
}: {
  user?: {
    displayName: string;
    avatarUrl: string | null;
  };
}) {
  return (
    <header className="relative z-20 border-b border-brand-300/15 bg-[var(--rlt-ink-deep)]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] max-w-[1440px] items-center gap-5 px-4 sm:px-6 lg:px-10">
        <Link
          href="/roleta"
          className="flex shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none"
          aria-label={`${STORE_NAME} — roleta`}
        >
          <span className="relative grid size-11 place-items-center overflow-hidden rounded-full border border-brand-300/40 bg-black shadow-[0_0_26px_color-mix(in oklab, var(--rlt-brand-400) 22%, transparent)]">
            <BrandMark priority />
            <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/10" />
          </span>
          {/* O nome vem da loja. Escrito à mão, a roleta da segunda loja
              anunciava a primeira — no cabeçalho, em cima da roda dela. */}
          <span className="text-[17px] font-black uppercase italic tracking-[-0.035em] text-white sm:text-xl">
            <span className="text-brand-400">{STORE_NAME.slice(0, 2)}</span>
            {STORE_NAME.slice(2)}
          </span>
        </Link>

        <nav aria-label="Navegação da roleta" className="ml-3 hidden items-stretch self-stretch sm:flex">
          <Link
            href="/roleta"
            className="relative flex items-center px-4 text-sm font-semibold text-brand-300 after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-400"
          >
            Roleta
          </Link>
          <Link
            href="#inventario"
            className="flex items-center px-4 text-sm font-medium text-[var(--rlt-text-muted)] transition-colors hover:text-white"
          >
            Inventário
          </Link>
        </nav>

        <div className="ml-auto">
          {user ? (
            <div className="flex items-center gap-3">
              <span className="hidden max-w-40 truncate text-sm font-semibold text-white md:inline">
                {user.displayName}
              </span>
              {user.avatarUrl ? (
                // Discord's OAuth avatar is user-controlled, public profile media.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="size-9 rounded-full border border-brand-300/30 bg-[var(--rlt-ink-raised)] object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center rounded-full border border-brand-300/30 bg-[var(--rlt-ink-raised)] text-sm font-bold text-brand-200"
                >
                  {user.displayName.slice(0, 1).toLocaleUpperCase("pt-BR")}
                </span>
              )}
              <form action={logoutRoulette}>
                <button
                  type="submit"
                  aria-label="Sair"
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-[var(--rlt-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  <LogOut aria-hidden="true" className="size-3.5" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/auth/login?next=/roleta"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-brand-300/40 bg-brand-500 px-4 text-sm font-semibold text-white shadow-[0_10px_32px_rgba(217,70,239,.18)] transition-colors hover:bg-brand-400"
            >
              Entrar com Discord
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
