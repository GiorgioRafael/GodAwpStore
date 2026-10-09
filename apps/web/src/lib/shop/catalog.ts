import "server-only";
import { IS_GWSTORE } from "@/lib/brand";
import { SupabaseBotCommerceRepository } from "@/lib/bot/supabase-repository";
import { GW_UP_STORE_ID } from "@/lib/bot/gw-up-catalog";
import type { BotCommerceRepository } from "@/lib/bot/types";
import { ShopError } from "./errors";
import type { ShopCatalogGame } from "./types";

export async function loadShopCatalog(repository?: Pick<BotCommerceRepository, "listCatalog">): Promise<ShopCatalogGame[]> {
  if (!IS_GWSTORE) throw new ShopError("not_found");
  const catalog = await (repository ?? new SupabaseBotCommerceRepository()).listCatalog();
  return catalog.map(game => ({
    ...game,
    substores: game.substores.map(substore => ({
      ...substore,
      products: substore.products.filter(product => Number.isSafeInteger(product.priceCents) && product.priceCents > 0)
        .map(product => ({
          ...product,
          isUpService: game.catalogStoreId === GW_UP_STORE_ID,
          serviceRequirements: game.catalogStoreId === GW_UP_STORE_ID
            ? [product.description?.trim() || "Confira com a equipe os detalhes de execução no atendimento."] : [],
        })),
    })).filter(substore => substore.products.length > 0),
  })).filter(game => game.substores.length > 0);
}
