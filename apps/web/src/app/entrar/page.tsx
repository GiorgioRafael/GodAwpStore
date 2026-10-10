import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { CustomerAuthForm } from "@/components/auth/customer-auth-form";
import { BrandMark } from "@/components/layout/brand-mark";
import { IS_GWSTORE, STORE_NAME } from "@/lib/brand";
import { redirectCustomerAuthToLoginHost } from "@/lib/customer-auth-origin";
import { getSiteUrl } from "@/lib/env";
import { safeGwStoreCustomerNext } from "@/lib/gwstore-customer-auth";
import { customerEmailAuth } from "./actions";

export const metadata: Metadata = {
  title: "Entrar na loja",
  description: "Entre com Google, Discord ou email para comprar e acompanhar seu pedido pelo site.",
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; erro?: string | string[]; setup?: string | string[]; mode?: string | string[] }>;
}) {
  if (!IS_GWSTORE) notFound();
  const query = await searchParams;
  const siteOrigin = getSiteUrl();
  const next = safeGwStoreCustomerNext(typeof query.next === "string" ? query.next : null, siteOrigin);
  await redirectCustomerAuthToLoginHost(next, {
    mode: typeof query.mode === "string" ? query.mode : undefined,
    erro: typeof query.erro === "string" ? query.erro : undefined,
    setup: typeof query.setup === "string" ? query.setup : undefined,
  });
  const isCheckout = new URL(next, siteOrigin).searchParams.get("checkout") === "1";
  const authHref = `/auth/login?${new URLSearchParams({ next }).toString()}`;
  const googleHref = `/auth/google/login?${new URLSearchParams({ next, customer: "1" }).toString()}`;
  const initialMode = query.mode === "signup" || query.mode === "forgot" || query.mode === "reset" ? query.mode : "login";
  const feedback = query.setup
    ? "O login está temporariamente indisponível. Tente novamente em alguns instantes."
    : query.erro
      ? isCheckout
        ? "Não foi possível entrar. Seu carrinho foi preservado; tente novamente."
        : "Não foi possível entrar. Tente novamente para continuar."
      : null;

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#080609] px-5 py-12 text-white sm:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(217,70,239,.13),transparent_65%)]" />
      <section className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#110c14] p-6 shadow-[0_24px_100px_rgba(0,0,0,.45)] sm:p-8">
        <Link href="/" aria-label={`${STORE_NAME} — início`} className="mx-auto mb-4 block size-14 overflow-hidden rounded-2xl border border-fuchsia-400/30 bg-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fuchsia-300">
          <BrandMark priority />
        </Link>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.17em] text-fuchsia-300">{STORE_NAME}</p>
        <CustomerAuthForm next={next} discordHref={authHref} googleHref={googleHref} emailAction={customerEmailAuth}
          isCheckout={isCheckout} feedback={feedback} initialMode={initialMode} />
        <p className="mt-5 flex items-start gap-2.5 text-xs leading-5 text-white/45"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fuchsia-300" />Sua conta identifica o comprador. O pedido e a conversa com a loja ficam neste site.</p>
        <Link href={next} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-fuchsia-300"><ArrowLeft aria-hidden="true" className="size-4" />Voltar à loja</Link>
      </section>
    </main>
  );
}
