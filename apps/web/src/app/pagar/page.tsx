import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IS_GWSTORE } from "@/lib/brand";
import { PublicPaymentForm } from "./payment-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pagar com Pix · GWStore",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ i?: string }>;
}) {
  if (!IS_GWSTORE) redirect("/");
  const { i } = await searchParams;
  // The shareable URL is /pagar. The per-visitor URL keeps the same financial
  // intent across refreshes and uncertain provider responses.
  if (!i) redirect(`/pagar?i=${crypto.randomUUID()}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(i)) {
    redirect(`/pagar?i=${crypto.randomUUID()}`);
  }
  return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
    <section className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-panel sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">GWStore · Pix</p>
      <h1 className="mt-3 text-2xl font-semibold">Pague com Pix</h1>
      <p className="mt-2 text-sm leading-6 text-muted">Informe o valor e uma mensagem. Você verá o QR Code e o código copia e cola antes de pagar.</p>
      <PublicPaymentForm intentId={i} />
    </section>
  </main>;
}
