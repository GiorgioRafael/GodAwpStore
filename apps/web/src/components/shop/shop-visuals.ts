import type { CSSProperties } from "react";
import {
  ArrowBigUpDash, BicepsFlexed, Boxes, Cherry, ChevronsUp, Coins, Cog, Crosshair, Dna, Eye, Flame, InfinityIcon, Palette,
  Skull, Sparkles, Swords, Ticket, TreePalm, TrendingUp, Waves, Zap, type LucideIcon,
} from "lucide-react";
import type { SHOP_CATEGORIES, ShopProductView } from "@/lib/shop/catalog-view";

export type ShopCategory = Exclude<(typeof SHOP_CATEGORIES)[number], { id: "all" }>;
export type ShopCategoryId = ShopCategory["id"];
export type CategoryVisual = {
  image: string; description: string; singular: string; hue: string; icon: LucideIcon;
  /** object-position of the cover at 3:2 (desktop) and 4:5 (mobile), and of the category band. */
  pos: string; posSm: string; bandPos: string;
};

// Each category borrows one hue from its cover art. The hue only tints that
// category's decoration; CTAs, prices and focus always use the store accent.
export const CATEGORY_COVERS: Record<ShopCategoryId, CategoryVisual> = {
  physical: { image: "/brands/categories/physical.webp", description: "Para equipar, trocar e evoluir.", singular: "Fruta física",
    hue: "#c77dff", icon: Cherry, pos: "50% 45%", posSm: "50% 40%", bandPos: "50% 40%" },
  permanent: { image: "/brands/categories/permanent.webp", description: "Seu poder, sempre disponível.", singular: "Permanente",
    hue: "#ff9a3c", icon: InfinityIcon, pos: "50% 45%", posSm: "52% 40%", bandPos: "50% 35%" },
  gamepass: { image: "/brands/categories/gamepass.webp", description: "Vantagens para ir além.", singular: "Gamepass",
    hue: "#f2c94c", icon: Ticket, pos: "50% 40%", posSm: "50% 38%", bandPos: "50% 45%" },
  skin: { image: "/brands/categories/skin.webp", description: "Um novo visual para seu jogo.", singular: "Skin",
    hue: "#5aa9ff", icon: Palette, pos: "45% 40%", posSm: "40% 40%", bandPos: "45% 30%" },
  up: { image: "/brands/categories/up.webp", description: "Level, maestria, raças, bosses e mais.", singular: "Serviço de UP",
    hue: "#ff3dbb", icon: ArrowBigUpDash, pos: "50% 35%", posSm: "46% 30%", bandPos: "50% 30%" },
  other: { image: "/brands/categories/other.webp", description: "Robux e outros itens para sua conta.", singular: "Outros",
    hue: "#9b8cff", icon: Coins, pos: "60% 45%", posSm: "62% 45%", bandPos: "60% 40%" },
};

export function categoryVisual(id: string): CategoryVisual {
  return Object.hasOwn(CATEGORY_COVERS, id) ? CATEGORY_COVERS[id as ShopCategoryId] : CATEGORY_COVERS.other;
}

// First match wins, on the accent-free lowercase group name (the owner's own emoji per group).
const SERVICE_GROUP_ICONS: [RegExp, LucideIcon][] = [
  [/observa/, Eye], [/haki/, Sparkles], [/leviat/, Waves], [/boss/, Skull], [/ilha/, TreePalm], [/pacote/, Boxes],
  [/draco/, Flame], [/v4/, Cog], [/raca/, Dna], [/arma/, Crosshair], [/espada/, Swords], [/luta|estilo/, BicepsFlexed],
  [/maestr/, Zap], [/geral|level|nivel/, TrendingUp],
];

export function serviceGroupIcon(groupName: string): LucideIcon {
  const key = groupName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return SERVICE_GROUP_ICONS.find(([pattern]) => pattern.test(key))?.[1] ?? ChevronsUp;
}

export function productIcon(product: Pick<ShopProductView, "category" | "groupName">): LucideIcon {
  return product.category === "up" ? serviceGroupIcon(product.groupName) : categoryVisual(product.category).icon;
}

/** Typed inline custom properties, e.g. style={cssVars({ "--hue": visual.hue })}. */
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}
