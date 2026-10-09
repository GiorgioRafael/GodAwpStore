import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import DashboardPage from "@/app/(admin)/dashboard/page";
import { AppShell } from "@/components/layout/app-shell";
import { BrandMark } from "@/components/layout/brand-mark";
import { requireAdmin } from "@/lib/auth";
import { IS_GWSTORE, STORE_NAME } from "@/lib/brand";

export const metadata: Metadata = IS_GWSTORE
  ? { title: { absolute: STORE_NAME }, description: `A nova loja da ${STORE_NAME} está em preparação.` }
  : { title: "Visão geral" };

export default async function HomePage() {
  // Other deployments continue to use the authenticated dashboard as their home.
  if (!IS_GWSTORE) {
    const identity = await requireAdmin();
    return <AppShell identity={identity}>{await DashboardPage()}</AppShell>;
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#080609] px-6 text-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,color-mix(in_oklab,var(--rlt-brand-400)_12%,transparent),transparent_65%)]" />
      <section className="relative mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center py-16">
        <div className="relative mb-7 grid size-24 place-items-center overflow-hidden rounded-3xl border border-brand-400/30 bg-black shadow-[0_0_55px_color-mix(in_oklab,var(--rlt-brand-400)_18%,transparent)]">
          <BrandMark priority />
        </div>
        <p className="text-sm font-semibold tracking-[0.12em] text-brand-300">{STORE_NAME}</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Nova loja em preparação</h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-white/55 sm:text-base">Em breve, você poderá encontrar nossos produtos e comprar por aqui.</p>
      </section>
      <footer className="relative pb-7 text-xs text-white/35">
        <Link href="/admin" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 transition-colors hover:text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300">
          Área administrativa <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
      </footer>
    </main>
  );
}
