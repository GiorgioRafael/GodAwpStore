import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Diamond, MessagesSquare, QrCode, ShieldCheck, ShoppingBag } from "lucide-react";

import { CustomerAuthForm } from "@/components/auth/customer-auth-form";
import { BrandMark } from "@/components/layout/brand-mark";
import { IS_GWSTORE, STORE_NAME } from "@/lib/brand";
import { redirectCustomerAuthToLoginHost } from "@/lib/customer-auth-origin";
import { getCustomerAuthProviders } from "@/lib/customer-auth-providers";
import { getSiteUrl } from "@/lib/env";
import { safeGwStoreCustomerNext } from "@/lib/gwstore-customer-auth";
import { customerEmailAuth } from "./actions";

export const metadata: Metadata = {
  title: "Entrar na loja",
  description: "Acesse sua conta para comprar e acompanhar seu pedido pelo site.",
};

const display = "font-[family-name:var(--font-shop-display)]";
// `!` beats the unlayered `* { border-color }`, `:focus-visible` and `::selection` rules in globals.css.
const focusRing = "focus-visible:outline-2 focus-visible:outline-[#ff9be3]!";
const perks = [
  { icon: QrCode, text: "Pagamento via Pix" },
  { icon: MessagesSquare, text: "Chat privado com a equipe no site" },
  { icon: ShoppingBag, text: "Seu carrinho continua salvo ao entrar" },
];

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
  const providers = await getCustomerAuthProviders();
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
    <main className="relative min-h-dvh bg-[#07050a] text-white [color-scheme:dark] selection:bg-[#ec009c]/40! selection:text-white! lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(460px,1fr)]">
      <div className="relative h-[200px] overflow-hidden sm:h-[260px] lg:sticky lg:top-0 lg:h-dvh">
        <Image src="/brands/gwstore-shop-hero.webp" alt="" fill preload sizes="(min-width: 1024px) 240vh, 100vw"
          className="object-cover object-[76%_30%] lg:object-[68%_30%]" />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,#07050a_0%,rgba(7,5,10,.6)_35%,rgba(7,5,10,0)_70%)] lg:bg-[linear-gradient(90deg,rgba(7,5,10,0)_40%,rgba(7,5,10,.75)_85%,#07050a_100%),linear-gradient(0deg,rgba(7,5,10,.94)_0%,rgba(7,5,10,.55)_36%,rgba(7,5,10,0)_58%)]" />
        <div className="absolute inset-x-12 bottom-14 hidden max-w-lg lg:block">
          <p className={`${display} text-5xl font-bold uppercase leading-[.95] 2xl:text-6xl`}>Seu próximo upgrade{" "}
            <span className="block w-fit bg-[linear-gradient(90deg,#ff4fc4,#ec009c_45%,#b84dff)] bg-clip-text text-transparent">começa aqui.</span></p>
          <ul className="mt-6 space-y-2 text-sm text-white/80">
            {perks.map(({ icon: Icon, text }) => <li key={text} className="flex items-center gap-3">
              <span aria-hidden="true" className="relative grid size-8 shrink-0 place-items-center before:absolute before:inset-1 before:rotate-45 before:rounded-md before:border before:border-[#ff4fc4]/45 before:bg-[#ec009c]/15 before:content-['']">
                <Icon aria-hidden="true" className="relative size-4 text-[#ff9be3]" /></span>{text}</li>)}
          </ul>
        </div>
      </div>
      <div className="relative z-10 -mt-16 px-4 pb-12 sm:px-8 lg:mt-0 lg:grid lg:place-items-center lg:bg-[radial-gradient(60%_50%_at_50%_0%,rgba(236,0,156,.12),transparent_70%)] lg:py-8">
        <section className="relative mx-auto w-full max-w-[440px] rounded-[24px] border border-white/10! bg-[#120c18]/95 p-5 shadow-[0_30px_100px_-20px_rgba(0,0,0,.9),0_0_0_1px_rgba(236,0,156,.12)] sm:p-8">
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,#ff4fc4,transparent)]" />
          <Link href="/" aria-label={`${STORE_NAME} — início`} className={`mx-auto mb-4 block size-16 overflow-hidden rounded-full shadow-[0_0_30px_-6px_rgba(236,0,156,.7)] ring-2 ring-[#ec009c]/60 ring-offset-4 ring-offset-[#120c18] ${focusRing} focus-visible:outline-offset-4!`}>
            <BrandMark priority />
          </Link>
          <p className={`${display} flex items-center justify-center gap-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[#ff9be3]`}>
            <Diamond aria-hidden="true" fill="currentColor" className="size-2" />{STORE_NAME}<Diamond aria-hidden="true" fill="currentColor" className="size-2" /></p>
          {isCheckout ? <p className="mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full bg-[#6fe0a8]/10 px-3 py-1 text-xs font-semibold text-[#6fe0a8]">
            <ShoppingBag aria-hidden="true" className="size-3.5" />Seu carrinho está salvo</p> : null}
          <CustomerAuthForm next={next} discordHref={authHref} googleHref={googleHref} emailAction={customerEmailAuth}
            providers={providers} isCheckout={isCheckout} feedback={feedback} initialMode={initialMode} />
          <p className="mt-5 flex items-start gap-2.5 border-t border-white/[.08]! pt-5 text-xs leading-5 text-white/60">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#ff9be3]" />Sua conta identifica o comprador. O pedido e a conversa com a loja ficam neste site.</p>
          <Link href={next} className={`mt-3 -ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-white/70 transition-colors hover:text-white ${focusRing}`}>
            <ArrowLeft aria-hidden="true" className="size-4" />Voltar à loja</Link>
        </section>
      </div>
    </main>
  );
}
