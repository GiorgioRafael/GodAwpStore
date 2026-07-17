import type { Metadata } from "next";

import { ProductsManager } from "@/components/admin/products-manager";
import { listProducts, listSubstores } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Produtos" };

export default async function ProductsPage() {
  const [products, substores] = await Promise.all([listProducts(), listSubstores()]);
  return <ProductsManager products={products} substores={substores} />;
}
