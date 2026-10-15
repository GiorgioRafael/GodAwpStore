import type { ShopCatalogGame, ShopCatalogProduct } from "./types";

export type ShopProductView = ShopCatalogProduct & {
  category: string;
  categoryLabel: string;
  gameName: string;
  storeName: string;
  /** substore.id */
  groupId: string;
  /** substore.name without the "UP ·" prefix: "UP · Maestria" → "Maestria". */
  groupName: string;
  /** "grupo-" + substore.id, the anchor of the UP sub-group. */
  groupAnchor: string;
  /** shopProductDisplayName(name): presentation only, never sent to the server. */
  displayName: string;
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
    const groupName = substore.name.replace(/^\s*UP\s*[·•|:\-–—]\s*/i, "").trim() || substore.name;
    return substore.products.map(product => ({ ...product, category, categoryLabel, gameName: game.name, storeName,
      groupId: substore.id, groupName, groupAnchor: `grupo-${substore.id}`, displayName: shopProductDisplayName(product.name) }));
  }));
}

export function formatShopPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

const KEEP_UPPER = new Set(["XP", "CDK", "TTK", "UP", "V1", "V2", "V3", "V4", "HP", "PVP", "GW"]);
const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "com", "sem", "via", "ate", "para", "por", "em", "no", "na"]);
const ACCENTS: Record<string, string> = { fisica: "Física", fisicas: "Físicas", rapidos: "Rápidos", rapido: "Rápido",
  lendario: "Lendário", lendaria: "Lendária", lendarios: "Lendários", mitico: "Mítico", mitica: "Mítica" };
const fold = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

/** Display-only cleanup: strips "- BLOX FRUITS", tidies "( x )", title-cases SHOUTING names, fixes common accents. */
export function shopProductDisplayName(raw: string): string {
  const base = raw.replace(/\s*[-–—]\s*blox\s*fruits?\s*$/i, "").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s{2,}/g, " ").trim();
  if (!base) return raw.trim();
  const letters = base.replace(/[^\p{L}]/gu, "").length;
  const shouting = letters >= 4 && base.replace(/[^\p{Lu}]/gu, "").length / letters >= 0.7;
  return base.split(" ").map((word, index) => {
    const bare = word.replace(/[^\p{L}\p{N}]/gu, "");
    if (!bare) return word;
    const key = fold(bare).toLowerCase();
    if (KEEP_UPPER.has(key.toUpperCase())) return word.toUpperCase();
    if (/^\d+x$/i.test(bare)) return word.toLowerCase();
    if (ACCENTS[key]) return word.replace(bare, ACCENTS[key]);
    const capsWord = bare === bare.toUpperCase() && bare.replace(/[^\p{L}]/gu, "").length >= 4;
    if (!shouting && !capsWord) return word;
    const lower = word.toLowerCase();
    if (index > 0 && LOWER_WORDS.has(key)) return lower;
    return lower.replace(/\p{L}/u, letter => letter.toUpperCase()).replace(/-(\p{L})/gu, (_, letter: string) => `-${letter.toUpperCase()}`);
  }).join(" ");
}

/** Big word on image-less card art. UP → sub-group name. */
export function shopPlaceholderWord(product: Pick<ShopProductView, "category" | "groupName" | "displayName">): string {
  if (product.category === "up") return product.groupName;
  const base = product.displayName.split(" / ")[0].replace(/\b(permanente|f[ií]sica|fruit|gamepass|skin)\b/giu, "").replace(/\s{2,}/g, " ").trim();
  return base || product.displayName;
}

/** One-line real hint for UP rows (from requirements/description). */
export function shopServiceHint(product: Pick<ShopProductView, "description" | "serviceRequirements">): string | null {
  const text = (product.serviceRequirements[0] ?? product.description ?? "").replace(/^\s*Serviço completo\.\s*/i, "").trim();
  if (!text || /^Confira com a equipe os detalhes de execução no atendimento\.?$/i.test(text)) return null;
  return text;
}

/** Description for the detail dialog, or null when it only repeats the name or a requirement. */
export function shopProductDescription(product: Pick<ShopProductView, "description" | "name" | "displayName" | "serviceRequirements">): string | null {
  const text = product.description?.trim();
  if (!text) return null;
  const key = (value: string) => fold(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (key(text) === key(product.name) || key(text) === key(product.displayName)) return null;
  if (product.serviceRequirements.some(requirement => key(requirement) === key(text))) return null;
  return text;
}
