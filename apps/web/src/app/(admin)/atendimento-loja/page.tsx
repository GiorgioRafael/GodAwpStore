import type { Metadata } from "next";

import { PageHeader } from "@/components/admin/page-header";
import { ShopOrdersManager } from "@/components/admin/shop-orders-manager";
import { requireGwStoreShopAdminPage } from "@/lib/gwstore-shop-admin-page";
import { storeAdminHref } from "@/lib/store-admin-routes";

export const metadata: Metadata = { title: "Pedidos da loja" };
export const dynamic = "force-dynamic";

export default async function ShopAdminOrdersPage() {
  await requireGwStoreShopAdminPage(storeAdminHref("/atendimento-loja"));
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Operação" title="Pedidos da loja" description="Acompanhe as compras feitas no site. Abra um pedido para conversar com o comprador e concluir a entrega." />
      <ShopOrdersManager />
    </div>
  );
}
