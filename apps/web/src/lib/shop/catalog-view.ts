import type { ShopCatalogGame, ShopCatalogProduct } from "./types";

export type ShopProductView = ShopCatalogProduct & {
  category: string;
  categoryLabel: string;
  gameName: string;
  storeName: string;
};

export const SHOP_CATEGORIES = [
  { id: "all", label: "Todos" },
  { id: "physical", label: "Frutas físicas" },
  { id: "permanent", label: "Permanentes" },
  { id: "gamepass", label: "Gamepasses" },
  { id: "skin", label: "Skins" },
  { id: "up", label: "Serviços de UP" },
  { id: "other", label: "Outros" },
] as const;

export function flattenShopCatalog(catalog: ShopCatalogGame[]): ShopProductView[] {
  return catalog.flatMap(game => game.substores.flatMap(substore => {
    const storeName = game.catalogStoreName || substore.name;
    const search = `${storeName} ${substore.name}`.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const category = /perman|perm\b/.test(search) ? "permanent"
      : /gamepass|game pass/.test(search) ? "gamepass"
      : /skin/.test(search) ? "skin"
      : substore.products.some(product => product.isUpService) ? "up"
      : /fruta|fisic|trade/.test(search) ? "physical" : "other";
    const categoryLabel = category === "permanent" ? "Frutas permanentes"
      : SHOP_CATEGORIES.find(item => item.id === category)?.label || storeName;
    return substore.products.map(product => ({ ...product, category, categoryLabel, gameName: game.name, storeName }));
  }));
}

export function formatShopPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
