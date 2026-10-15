import type { Metadata } from "next";
import { headers } from "next/headers";

import DashboardPage from "@/app/(admin)/dashboard/page";
import { AppShell } from "@/components/layout/app-shell";
import { Storefront } from "@/components/shop/storefront";
import { requireAdmin } from "@/lib/auth";
import { IS_GWSTORE } from "@/lib/brand";
import { loadShopCatalog } from "@/lib/shop/catalog";
import { getShopInformation } from "@/lib/shop/information";
import { requireShopBuyer } from "@/lib/shop/request";
import { shopHomeMetadata } from "@/lib/shop/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const protocol = process.env.NODE_ENV === "production" || requestHeaders.get("x-forwarded-proto") === "https"
    ? "https:" : "http:";
  try {
    const host = requestHeaders.get("host");
    if (host) return shopHomeMetadata(new Request(`${protocol}//${host}/`, { headers: requestHeaders }));
  } catch {
    // Missing/malformed request authority must never enable public indexing.
  }
  return { robots: { index: false, follow: false } };
}

export default async function HomePage() {
  // Other deployments continue to use the authenticated dashboard as their home.
  if (!IS_GWSTORE) {
    const identity = await requireAdmin();
    return <AppShell identity={identity}>{await DashboardPage()}</AppShell>;
  }

  const [catalogResult, buyerResult] = await Promise.allSettled([loadShopCatalog(), requireShopBuyer()]);
  return <Storefront catalog={catalogResult.status === "fulfilled" ? catalogResult.value : []}
    catalogUnavailable={catalogResult.status === "rejected"}
    information={getShopInformation()}
    buyerName={buyerResult.status === "fulfilled" ? buyerResult.value.displayName : null} />;
}
