import type { Metadata } from "next";

import { ProductsManager } from "@/components/admin/products-manager";
import { listCatalogStores, listProducts, listSubstores } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Produtos" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ loja?: string | string[] }>;
}) {
  const { loja } = await searchParams;
  const [products, substores, stores] = await Promise.all([
    listProducts(),
    listSubstores(),
    listCatalogStores(),
  ]);
  const requestedStoreId = typeof loja === "string" ? loja : null;
  const initialStoreId = stores.some(
    (store) =>
      store.id === requestedStoreId &&
      store.status === "active" &&
      !store.archived_at,
  )
    ? requestedStoreId!
    : "all";
  const productsRevision = products
    .map((product) => `${product.id}:${product.updated_at}`)
    .join("|");
  return (
    <ProductsManager
      key={`${productsRevision}:${initialStoreId}`}
      products={products}
      substores={substores}
      stores={stores}
      initialStoreId={initialStoreId}
    />
  );
}
