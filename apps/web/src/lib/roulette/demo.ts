/** The wheel is configured in the admin panel, so nothing here may assume how
 * many slices there are. Slot styling is generated from the position instead of
 * listed, and every projection is driven by what the server returned. */
export const MAXIMUM_WHEEL_SLOTS = 10;

const PRIZE_KEY_PATTERN = /^premio_([1-9][0-9]?)$/;

/**
 * Colour for a slice, derived from where it sits. Hue walks the brand's violet
 * to pink arc, and lightness alternates so two neighbours are still telling
 * apart at ten slices, where the hue step alone is only eight degrees.
 */
export function rouletteSlotPalette(index: number, total: number) {
  const span = Math.max(total - 1, 1);
  const hue = 250 + (Math.max(index, 0) / span) * 90;
  const dim = index % 2 === 1;
  return {
    accent: `hsl(${hue.toFixed(1)} 88% ${dim ? 56 : 66}%)`,
    surface: `hsl(${hue.toFixed(1)} 58% ${dim ? 13 : 18}%)`,
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

export type DemoRouletteInventoryItem = {
  prizeKey: DemoRoulettePrizeKey;
  quantity: number;
};

/** Catalog product currently attached to a wheel slot. */
export type RoulettePrizeProduct = {
  prizeKey: DemoRoulettePrizeKey;
  productId: string;
  name: string;
  imageUrl: string | null;
  valueCents: number;
  saleValueCents: number;
  drawChanceBps: number;
};

/** A wheel slot ready to render: slot styling plus the resolved catalog item. */
export type RouletteWheelPrize = DemoRoulettePrize & {
  productId: string | null;
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
    const displayName = product.name || slot.name;
    return {
      ...slot,
      productId: product.productId,
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

export function normalizeDemoRouletteInventory(
  rows: Array<{ prize_key: string; quantity: number }>,
): DemoRouletteInventoryItem[] {
  const quantities = new Map<string, number>();
  for (const row of rows) {
    if (!isDemoRoulettePrizeKey(row.prize_key)) continue;
    if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) continue;
    // A slot can appear more than once if it was rebuilt; keep every unit.
    quantities.set(row.prize_key, (quantities.get(row.prize_key) ?? 0) + row.quantity);
  }
  return [...quantities.entries()]
    .map(([prizeKey, quantity]) => ({ prizeKey, quantity }))
    .sort((a, b) => compareRouletteSlots(a.prizeKey, b.prizeKey));
}

export function mergeDemoRouletteInventory(
  inventory: DemoRouletteInventoryItem[],
  prizeKey: DemoRoulettePrizeKey,
  quantity: number,
) {
  const byKey = new Map(inventory.map((item) => [item.prizeKey, item.quantity]));
  byKey.set(prizeKey, quantity);
  return [...byKey.entries()]
    .filter(([, nextQuantity]) => nextQuantity > 0)
    .map(([key, nextQuantity]) => ({ prizeKey: key, quantity: nextQuantity }))
    .sort((a, b) => compareRouletteSlots(a.prizeKey, b.prizeKey));
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
