import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IS_GWSTORE } from "@/lib/brand";
import { eclipsePayEnabled } from "@/lib/eclipsepay/runtime";
import { PublicPaymentForm } from "./payment-form";
import { PaymentBrand } from "./payment-brand";
import styles from "./payment-link.module.css";

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
  if (!IS_GWSTORE || !eclipsePayEnabled()) redirect("/");
  const { i } = await searchParams;
  // The shareable URL is /pagar. The per-visitor URL keeps the same financial
  // intent across refreshes and uncertain provider responses.
  if (!i) redirect(`/pagar?i=${crypto.randomUUID()}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(i)) {
    redirect(`/pagar?i=${crypto.randomUUID()}`);
  }
  return <main className={styles.page}>
    <section className={`${styles.card} ${styles.formCard}`}>
      <PaymentBrand />
      <h1 className={styles.srOnly}>Pagamento via Pix na GWStore</h1>
      <PublicPaymentForm intentId={i} />
    </section>
  </main>;
}
