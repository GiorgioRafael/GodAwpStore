import type { Metadata } from "next";

import { InventoryStoresManager } from "@/components/admin/inventory-stores-manager";
import { listCatalogStores, listProducts } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Estoque por loja" };

export default async function InventoryPage() {
  const [stores, products] = await Promise.all([listCatalogStores(), listProducts()]);
  return <InventoryStoresManager stores={stores} products={products} />;
}
