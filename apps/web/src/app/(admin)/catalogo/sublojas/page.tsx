import type { Metadata } from "next";

import { SubstoresManager } from "@/components/admin/substores-manager";
import { listGames, listProducts, listSubstores } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Sublojas" };

export default async function SubstoresPage() {
  const [games, substores, products] = await Promise.all([
    listGames(),
    listSubstores(),
    listProducts(),
  ]);
  const productCounts: Record<string, number> = {};

  for (const substore of substores) {
    productCounts[substore.id] = products.filter(
      (product) => product.substore_id === substore.id && product.status !== "archived",
    ).length;
  }

  return (
    <SubstoresManager games={games} substores={substores} productCounts={productCounts} />
  );
}
