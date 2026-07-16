import type { Metadata } from "next";

import { GamesManager } from "@/components/admin/games-manager";
import { listGames, listProducts, listSubstores } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Jogos" };

export default async function GamesPage() {
  const [games, substores, products] = await Promise.all([
    listGames(),
    listSubstores(),
    listProducts(),
  ]);
  const relatedCounts: Record<string, { substores: number; products: number }> = {};

  for (const game of games) {
    const gameSubstores = substores.filter(
      (substore) => substore.game_id === game.id && substore.status !== "archived",
    );
    const substoreIds = new Set(gameSubstores.map((substore) => substore.id));
    relatedCounts[game.id] = {
      substores: gameSubstores.length,
      products: products.filter(
        (product) => substoreIds.has(product.substore_id) && product.status !== "archived",
      ).length,
    };
  }

  return <GamesManager games={games} relatedCounts={relatedCounts} />;
}
