import type { Metadata } from "next";

import { InventoryManager } from "@/components/inventory/inventory-manager";
import {
  listInventoryBatches,
  listInventoryUnits,
  listProducts,
  listProductStock,
} from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Estoque" };

export default async function InventoryPage() {
  const [products, stock, units, batches] = await Promise.all([
    listProducts(),
    listProductStock(),
    listInventoryUnits(500),
    listInventoryBatches(500),
  ]);

  return (
    <InventoryManager
      products={products.map((product) => ({
        id: product.id,
        name: product.name,
        status: product.status,
      }))}
      stock={stock.map((row) => ({
        productId: row.product_id,
        available: row.available_count,
        reserved: row.reserved_count,
        low: row.is_low_stock,
      }))}
      units={units.map((unit) => ({
        id: unit.id,
        productId: unit.product_id,
        productName: unit.products?.name ?? "Produto arquivado",
        batchId: unit.batch_id,
        batchSource: unit.inventory_batches?.source ?? null,
        status: unit.status,
        createdAt: unit.created_at,
        updatedAt: unit.updated_at,
      }))}
      batches={batches.map((batch) => ({
        id: batch.id,
        productId: batch.product_id,
        productName: batch.products?.name ?? "Produto arquivado",
        source: batch.source,
        importMethod: batch.import_method,
        unitCount: batch.unit_count,
        createdAt: batch.created_at,
      }))}
    />
  );
}
