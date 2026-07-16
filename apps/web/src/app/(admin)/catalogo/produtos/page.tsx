import type { Metadata } from "next";

import { ProductsManager } from "@/components/admin/products-manager";
import {
  listProducts,
  listProductStock,
  listSubstores,
  type ProductStockRow,
} from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Produtos" };

export default async function ProductsPage() {
  const [products, substores, stock] = await Promise.all([
    listProducts(),
    listSubstores(),
    listProductStock(),
  ]);
  const stockByProduct: Record<string, ProductStockRow> = {};

  for (const row of stock) stockByProduct[row.product_id] = row;

  return (
    <ProductsManager
      products={products}
      substores={substores}
      stockByProduct={stockByProduct}
    />
  );
}
