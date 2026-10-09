import type { Metadata } from "next";

import DashboardPage from "@/app/(admin)/dashboard/page";
import { AppShell } from "@/components/layout/app-shell";
import { Storefront } from "@/components/shop/storefront";
import { requireAdmin } from "@/lib/auth";
import { IS_GWSTORE, STORE_NAME } from "@/lib/brand";
import { loadShopCatalog } from "@/lib/shop/catalog";
import { requireShopBuyer } from "@/lib/shop/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = IS_GWSTORE
  ? { title: { absolute: `${STORE_NAME} · Frutas, skins e serviços de Blox Fruits` },
      description: "Escolha seus produtos, pague com Pix e receba atendimento no chat privado da sua compra na GWStore.",
      applicationName: STORE_NAME, robots: { index: true, follow: true },
      alternates: { canonical: "https://gwstoreofc.com" } }
  : { title: "Visão geral" };

export default async function HomePage() {
  // Other deployments continue to use the authenticated dashboard as their home.
  if (!IS_GWSTORE) {
    const identity = await requireAdmin();
    return <AppShell identity={identity}>{await DashboardPage()}</AppShell>;
  }

  const [catalogResult, buyerResult] = await Promise.allSettled([loadShopCatalog(), requireShopBuyer()]);
  return <Storefront catalog={catalogResult.status === "fulfilled" ? catalogResult.value : []}
    catalogUnavailable={catalogResult.status === "rejected"}
    buyerName={buyerResult.status === "fulfilled" ? buyerResult.value.displayName : null} />;
}
