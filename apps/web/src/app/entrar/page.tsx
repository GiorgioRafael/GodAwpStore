import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, MessageCircleMore, ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { IS_GWSTORE, STORE_NAME } from "@/lib/brand";
import { getSiteUrl } from "@/lib/env";
import { safeGwStoreCustomerNext } from "@/lib/gwstore-customer-auth";

export const metadata: Metadata = {
  title: "Entrar na loja",
  description: "Entre com o Discord para comprar e acompanhar seu pedido pelo site.",
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; erro?: string | string[]; setup?: string | string[] }>;
}) {
  if (!IS_GWSTORE) notFound();
  const query = await searchParams;
  const siteOrigin = getSiteUrl();
  const next = safeGwStoreCustomerNext(typeof query.next === "string" ? query.next : null, siteOrigin);
  const isCheckout = new URL(next, siteOrigin).searchParams.get("checkout") === "1";
  const authHref = `/auth/login?${new URLSearchParams({ next }).toString()}`;
  const feedback = query.setup
    ? "O login está temporariamente indisponível. Tente novamente em alguns instantes."
    : query.erro
      ? isCheckout
        ? "Não foi possível entrar com o Discord. Seu carrinho foi preservado; tente novamente."
        : "Não foi possível entrar com o Discord. Tente novamente para continuar."
      : null;

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#080609] px-5 py-12 text-white sm:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(217,70,239,.13),transparent_65%)]" />
      <section className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#110c14] p-7 shadow-[0_24px_100px_rgba(0,0,0,.45)] sm:p-9">
        <Link href="/" aria-label={`${STORE_NAME} — início`} className="mx-auto mb-7 block size-20 overflow-hidden rounded-2xl border border-fuchsia-400/30 bg-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fuchsia-300">
          <BrandMark priority />
        </Link>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.17em] text-fuchsia-300">{STORE_NAME}</p>
        <h1 className="mt-3 text-center text-2xl font-semibold tracking-tight">{isCheckout ? "Entre para concluir a compra" : "Entre na sua conta"}</h1>
        <p className="mt-4 text-center text-sm leading-6 text-white/60">
          {isCheckout
            ? "Use sua conta Discord para concluir a compra e acompanhar o atendimento por aqui."
            : "Use sua conta Discord para acompanhar seus pedidos e conversar com a loja por aqui."}
        </p>
        {feedback ? (
          <p role="alert" className="mt-5 rounded-xl border border-fuchsia-400/25 bg-fuchsia-400/5 p-4 text-sm leading-6 text-white/80">{feedback}</p>
        ) : null}
        <Link href={authHref} className="mt-7 flex min-h-12 items-center justify-between gap-3 rounded-xl bg-fuchsia-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-fuchsia-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fuchsia-300">
          <span className="flex items-center gap-2.5"><MessageCircleMore aria-hidden="true" className="size-5" />Continuar com Discord</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <p className="mt-5 flex items-start gap-2.5 text-xs leading-5 text-white/45"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fuchsia-300" />Sua conta identifica o comprador. O pedido e a conversa com a loja ficam neste site.</p>
        <Link href={next} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-fuchsia-300"><ArrowLeft aria-hidden="true" className="size-4" />Voltar à loja</Link>
      </section>
    </main>
  );
}
