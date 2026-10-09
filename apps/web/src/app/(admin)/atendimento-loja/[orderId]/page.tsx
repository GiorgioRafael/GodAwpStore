import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ShopOrderWorkspace } from "@/components/shop/order-workspace";
import { requireGwStoreShopAdminPage } from "@/lib/gwstore-shop-admin-page";
import { storeAdminHref } from "@/lib/store-admin-routes";

export const metadata: Metadata = { title: "Atendimento do pedido" };
export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ShopAdminOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!UUID_PATTERN.test(orderId)) notFound();
  await requireGwStoreShopAdminPage(storeAdminHref(`/atendimento-loja/${orderId}`));
  return (
    <div className="space-y-5">
      <Link href={storeAdminHref("/atendimento-loja")} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold"><ArrowLeft aria-hidden="true" className="size-4" />Pedidos da loja</Link>
      <ShopOrderWorkspace orderId={orderId} admin />
    </div>
  );
}
