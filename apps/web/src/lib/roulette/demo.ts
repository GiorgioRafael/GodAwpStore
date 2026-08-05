import { STORE_SLUG } from "@/lib/brand";

/** The wheel is configured in the admin panel, so nothing here may assume how
 * many slices there are. Slot styling is generated from the position instead of
 * listed, and every projection is driven by what the server returned. */
export const MAXIMUM_WHEEL_SLOTS = 10;

/**
 * How many distinct prizes one sale or redemption may carry.
 *
 * Counted per line, not per slice: a slice repointed a few times leaves the
 * same player holding several different items that all came from it. Has to
 * match the cap in read_roulette_item_selection.
 */
export const MAXIMUM_SELECTION_LINES = 50;

/**
 * O arco de matiz das fatias, por loja. Fica aqui em vez de no CSS porque a cor
 * de cada fatia é calculada em JS e vai para o SVG da roda.
 */
const SLICE_HUES: Record<string, { from: number; span: number }> = {
  thstore: { from: 198, span: 44 },
};
const { from: ROULETTE_SLICE_HUE_FROM, span: ROULETTE_SLICE_HUE_SPAN } =
  SLICE_HUES[STORE_SLUG] ?? { from: 250, span: 90 };

const PRIZE_KEY_PATTERN = /^premio_([1-9][0-9]?)$/;

/**
 * Colour for a slice, derived from where it sits. Hue walks the brand's violet
 * to pink arc, and lightness alternates so two neighbours are still telling
 * apart at ten slices, where the hue step alone is only eight degrees.
 */
export function rouletteSlotPalette(index: number, total: number) {
  const span = Math.max(total - 1, 1);
  // O arco vem do tema da loja: violeta->magenta na GWStore, ciano->azul na
  // THStore. Cravar 250..340 aqui pintava as fatias de roxo em qualquer loja.
  const hue =
    ROULETTE_SLICE_HUE_FROM + (Math.max(index, 0) / span) * ROULETTE_SLICE_HUE_SPAN;
  const dim = index % 2 === 1;
  const h = hue.toFixed(1);
  return {
    accent: `hsl(${h} 88% ${dim ? 56 : 66}%)`,
    surface: `hsl(${h} 58% ${dim ? 13 : 18}%)`,
    // Transparência tem que sair pronta daqui. Concatenar "55" num hsl() gera
    // "hsl(280.0 88% 66%)55", que o CSS descarta inteiro — a borda e o fundo do
    // inventário caíam para o valor padrão em vez da cor da fatia.
    accentSoft: `hsl(${h} 88% ${dim ? 56 : 66}% / 0.33)`,
    surfaceSoft: `hsl(${h} 58% ${dim ? 13 : 18}% / 0.8)`,
  };
}

export function rouletteSlotIndex(prizeKey: string) {
  const match = PRIZE_KEY_PATTERN.exec(prizeKey);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/** premio_10 sorts before premio_2 as text, so ordering is always numeric. */
export function compareRouletteSlots(a: string, b: string) {
  return rouletteSlotIndex(a) - rouletteSlotIndex(b);
}

export function rouletteSlotLabel(prizeKey: string) {
  const index = rouletteSlotIndex(prizeKey);
  return Number.isFinite(index) ? `Prêmio ${index}` : "Prêmio";
}

/** The keys a wheel of `total` slices uses, in order. */
export function rouletteSlotKeys(total: number) {
  const count = Math.min(Math.max(Math.round(total), 0), MAXIMUM_WHEEL_SLOTS);
  return Array.from({ length: count }, (_, index) => `premio_${index + 1}`);
}

export type DemoRoulettePrize = {
  key: string;
  name: string;
  shortName: string;
  accent: string;
  surface: string;
};

/** A key is a slot label; which ones exist is the wheel's business, not a type's. */
export type DemoRoulettePrizeKey = string;

/**
 * A prize a player owns.
 *
 * It carries its own product, name, image and price because that is what was
 * frozen when it was won. Reading any of those from the slot it came from means
 * an administrator repointing that slot rewrites what the player appears to
 * own, while the server still pays and delivers the original — the screen
 * would be the only part of the system lying.
 */
export type DemoRouletteInventoryItem = {
  prizeKey: DemoRoulettePrizeKey;
  productId: string;
  name: string;
  imageUrl: string | null;
  valueCents: number;
  saleValueCents: number;
  quantity: number;
};

/** Same owner, slot, product and frozen price: the same thing to own. */
export function rouletteInventoryKey(
  item: Pick<DemoRouletteInventoryItem, "prizeKey" | "productId" | "valueCents">,
) {
  return `${item.prizeKey}:${item.productId}:${item.valueCents}`;
}

/**
 * The bundle currently attached to a wheel slot.
 *
 * `quantity` units of one product, and `valueCents` is what the whole bundle is
 * worth — the number the wheel shows and every calculation runs on.
 */
export type RoulettePrizeProduct = {
  prizeKey: DemoRoulettePrizeKey;
  productId: string;
  name: string;
  quantity: number;
  imageUrl: string | null;
  valueCents: number;
  saleValueCents: number;
  drawChanceBps: number;
};

/** A wheel slot ready to render: slot styling plus the resolved catalog item. */
export type RouletteWheelPrize = DemoRoulettePrize & {
  productId: string | null;
  quantity: number;
  displayName: string;
  wheelLabel: string;
  imageUrl: string | null;
  valueCents: number;
  saleValueCents: number;
  drawChanceBps: number;
};

const MAXIMUM_WHEEL_LABEL_LENGTH = 14;

/** One coin is R$ 1,00. Balances and prize values are kept in coin cents. */
export const COIN_CENTS = 100;
export const SPIN_COST_CENTS = COIN_CENTS;
export const MINIMUM_COIN_PURCHASE = 1;
export const MAXIMUM_COIN_PURCHASE = 100;

export function formatCoins(cents: number) {
  const safe = Number.isFinite(cents) ? cents : 0;
  return (safe / COIN_CENTS).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function coinsFromCents(cents: number) {
  return Math.floor((Number.isFinite(cents) ? cents : 0) / COIN_CENTS);
}

export function isDemoRoulettePrizeKey(value: unknown): value is DemoRoulettePrizeKey {
  return typeof value === "string" && PRIZE_KEY_PATTERN.test(value);
}

/** "10x Bamboo Seed" when the slice is a bundle, the plain name when it is one. */
export function rouletteBundleName(name: string, quantity: number) {
  const count = Number.isSafeInteger(quantity) && quantity > 1 ? quantity : 1;
  return count > 1 ? `${count}x ${name}` : name;
}

/** Styling for a slot inside a wheel of a given size. */
export function demoRoulettePrize(prizeKey: string, index: number, total: number) {
  const name = rouletteSlotLabel(prizeKey);
  return { key: prizeKey, name, shortName: name, ...rouletteSlotPalette(index, total) };
}

export function normalizeRoulettePrizeProducts(
  rows: Array<{
    slot_prize_key: string;
    slot_product_id: string;
    slot_product_name: string;
    slot_product_image_url: string | null;
    slot_prize_quantity: number;
    slot_value_cents: number;
    slot_sale_value_cents: number;
    slot_draw_chance_bps: number;
  }>,
): RoulettePrizeProduct[] {
  const byKey = new Map<DemoRoulettePrizeKey, RoulettePrizeProduct>();
  for (const row of rows) {
    if (!isDemoRoulettePrizeKey(row.slot_prize_key)) continue;
    const name = typeof row.slot_product_name === "string" ? row.slot_product_name.trim() : "";
    if (!row.slot_product_id || !name) continue;
    byKey.set(row.slot_prize_key, {
      prizeKey: row.slot_prize_key,
      productId: row.slot_product_id,
      name,
      quantity: Math.max(safeCents(row.slot_prize_quantity), 1),
      imageUrl: normalizeImageUrl(row.slot_product_image_url),
      valueCents: safeCents(row.slot_value_cents),
      saleValueCents: safeCents(row.slot_sale_value_cents),
      drawChanceBps: safeCents(row.slot_draw_chance_bps),
    });
  }
  return [...byKey.values()].sort((a, b) => compareRouletteSlots(a.prizeKey, b.prizeKey));
}

function safeCents(value: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Merges the slot palette with the catalog item assigned to it. Slots without a
 * live product keep the provisional name so the wheel never renders a gap.
 */
export function buildRouletteWheelPrizes(
  products: RoulettePrizeProduct[],
): RouletteWheelPrize[] {
  const ordered = [...products].sort((a, b) =>
    compareRouletteSlots(a.prizeKey, b.prizeKey),
  );
  const total = ordered.length;
  return ordered.map((product, index) => {
    const slot = demoRoulettePrize(product.prizeKey, index, total);
    // The count belongs in the name: a slice offering ten of something and one
    // offering a single unit are different prizes, and only the label says so.
    const displayName = rouletteBundleName(product.name || slot.name, product.quantity);
    return {
      ...slot,
      productId: product.productId,
      quantity: product.quantity,
      displayName,
      wheelLabel: truncateWheelLabel(displayName, total),
      imageUrl: product.imageUrl,
      valueCents: product.valueCents,
      saleValueCents: product.saleValueCents,
      drawChanceBps: product.drawChanceBps,
    };
  });
}

/**
 * A slot the wheel does not know about is possible for a moment after an
 * administrator adds one, so this never assumes the lookup succeeds.
 */
export function rouletteWheelPrize(
  prizes: RouletteWheelPrize[],
  prizeKey: string,
): RouletteWheelPrize {
  const found = prizes.find((prize) => prize.key === prizeKey);
  if (found) return found;

  const slot = demoRoulettePrize(prizeKey, prizes.length, prizes.length + 1);
  return {
    ...slot,
    productId: null,
    quantity: 1,
    displayName: slot.name,
    wheelLabel: slot.shortName,
    imageUrl: null,
    valueCents: 0,
    saleValueCents: 0,
    drawChanceBps: 0,
  };
}

/**
 * Ten slices give each label barely half the arc five did, so the budget
 * shrinks with the wheel instead of letting names run over their neighbours.
 */
export function wheelLabelBudget(total: number) {
  if (total <= 5) return MAXIMUM_WHEEL_LABEL_LENGTH;
  if (total <= 7) return 11;
  return 9;
}

function truncateWheelLabel(value: string, total: number) {
  const budget = wheelLabelBudget(total);
  return value.length > budget
    ? `${value.slice(0, budget - 1).trimEnd()}…`
    : value;
}

function normalizeImageUrl(value: string | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  try {
    return new URL(normalized).protocol === "https:" ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * One entry per thing owned. Two prizes won on the same slot before and after
 * an administrator repointed it are two different items, so they are never
 * folded together: doing that would hide one of them behind the other's name
 * and price.
 */
export function normalizeDemoRouletteInventory(
  rows: Array<{
    prize_key: string;
    product_id: string;
    product_name: string | null;
    product_image_url: string | null;
    unit_value_cents: number;
    unit_sale_value_cents: number;
    quantity: number;
  }>,
): DemoRouletteInventoryItem[] {
  const byIdentity = new Map<string, DemoRouletteInventoryItem>();
  for (const row of rows) {
    if (!isDemoRoulettePrizeKey(row.prize_key)) continue;
    if (typeof row.product_id !== "string" || !row.product_id) continue;
    if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) continue;

    const item: DemoRouletteInventoryItem = {
      prizeKey: row.prize_key,
      productId: row.product_id,
      name: (typeof row.product_name === "string" && row.product_name.trim()) || "Prêmio da roleta",
      imageUrl: normalizeImageUrl(row.product_image_url),
      valueCents: safeCents(row.unit_value_cents),
      saleValueCents: safeCents(row.unit_sale_value_cents),
      quantity: row.quantity,
    };
    const key = rouletteInventoryKey(item);
    const seen = byIdentity.get(key);
    byIdentity.set(key, seen ? { ...seen, quantity: seen.quantity + item.quantity } : item);
  }
  return sortRouletteInventory([...byIdentity.values()]);
}

/**
 * Applies what the server said is left of one line, leaving the others alone.
 * Keyed by the item, so selling the cheap prize on a slot cannot delete the
 * expensive one won on that same slot before it was repointed.
 */
export function mergeDemoRouletteInventory(
  inventory: DemoRouletteInventoryItem[],
  line: DemoRouletteInventoryItem,
) {
  const byIdentity = new Map(inventory.map((item) => [rouletteInventoryKey(item), item]));
  const key = rouletteInventoryKey(line);
  const known = byIdentity.get(key);
  byIdentity.set(key, { ...(known ?? line), quantity: line.quantity });
  return sortRouletteInventory(
    [...byIdentity.values()].filter((item) => item.quantity > 0),
  );
}

function sortRouletteInventory(items: DemoRouletteInventoryItem[]) {
  // Never throws on a malformed line: this runs inside a state updater, and an
  // exception here takes the whole page down rather than dropping one row.
  return items.sort(
    (a, b) =>
      compareRouletteSlots(a.prizeKey, b.prizeKey) ||
      (b.valueCents || 0) - (a.valueCents || 0) ||
      String(a.productId ?? "").localeCompare(String(b.productId ?? "")),
  );
}

/**
 * Where to stop so the pointer lands on the winning slice.
 *
 * The slice count comes from the wheel actually drawn, never from a constant:
 * aligning to five steps while ten wedges are painted parks the pointer on an
 * unrelated prize while the card announces the real one.
 */
export function demoRouletteRotation(
  currentRotation: number,
  prizeKey: string,
  prizes: ReadonlyArray<{ key: string }>,
) {
  const total = Math.max(prizes.length, 1);
  const found = prizes.findIndex((prize) => prize.key === prizeKey);
  const prizeIndex = found >= 0 ? found : 0;
  const segmentAngle = 360 / total;
  const segmentCenter = prizeIndex * segmentAngle + segmentAngle / 2;
  const targetNormalized = (360 - segmentCenter) % 360;
  const currentNormalized = ((currentRotation % 360) + 360) % 360;
  const alignmentDelta = (targetNormalized - currentNormalized + 360) % 360;
  return currentRotation + 5 * 360 + alignmentDelta;
}
