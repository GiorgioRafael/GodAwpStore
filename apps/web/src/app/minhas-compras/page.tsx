import { redirect } from "next/navigation";
import { ShopShell } from "@/components/shop/shop-shell";
import { ShopOrdersList } from "@/components/shop/orders-list";
import { requireShopBuyer } from "@/lib/shop/request";
import { ShopError } from "@/lib/shop/errors";

export const dynamic = "force-dynamic";
export default async function CustomerOrdersPage() {
  const buyer = await requireShopBuyer().catch(error => {
    if (error instanceof ShopError && error.code === "unauthenticated") redirect("/entrar?next=%2Fminhas-compras");
    throw error;
  });
  return <ShopShell buyerName={buyer.displayName}><ShopOrdersList /></ShopShell>;
}
