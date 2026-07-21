import type { Metadata } from "next";

import { ProductsManager } from "@/components/admin/products-manager";
import { listProducts, listSubstores } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Produtos" };

export default async function ProductsPage() {
  const [products, substores] = await Promise.all([listProducts(), listSubstores()]);
  const productsRevision = products
    .map((product) => `${product.id}:${product.updated_at}`)
    .join("|");
  return (
    <ProductsManager
      key={productsRevision}
      products={products}
      substores={substores}
    />
  );
}
