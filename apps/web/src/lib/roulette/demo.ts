export const DEMO_ROULETTE_PRIZES = [
  {
    key: "premio_1",
    name: "Prêmio 1",
    shortName: "Prêmio 1",
    accent: "#ef4bd8",
    surface: "#32103f",
  },
  {
    key: "premio_2",
    name: "Prêmio 2",
    shortName: "Prêmio 2",
    accent: "#c85cff",
    surface: "#491548",
  },
  {
    key: "premio_3",
    name: "Prêmio 3",
    shortName: "Prêmio 3",
    accent: "#8f62ff",
    surface: "#261950",
  },
  {
    key: "premio_4",
    name: "Prêmio 4",
    shortName: "Prêmio 4",
    accent: "#ff4ba8",
    surface: "#591447",
  },
  {
    key: "premio_5",
    name: "Prêmio 5",
    shortName: "Prêmio 5",
    accent: "#a54cff",
    surface: "#30145b",
  },
] as const;

export type DemoRoulettePrize = (typeof DEMO_ROULETTE_PRIZES)[number];
export type DemoRoulettePrizeKey = DemoRoulettePrize["key"];

export type DemoRouletteInventoryItem = {
  prizeKey: DemoRoulettePrizeKey;
  quantity: number;
};

export function isDemoRoulettePrizeKey(value: unknown): value is DemoRoulettePrizeKey {
  return DEMO_ROULETTE_PRIZES.some((prize) => prize.key === value);
}

export function demoRoulettePrize(prizeKey: DemoRoulettePrizeKey) {
  return DEMO_ROULETTE_PRIZES.find((prize) => prize.key === prizeKey)!;
}

export function normalizeDemoRouletteInventory(
  rows: Array<{ prize_key: string; quantity: number }>,
): DemoRouletteInventoryItem[] {
  const quantities = new Map<DemoRoulettePrizeKey, number>();
  for (const row of rows) {
    if (!isDemoRoulettePrizeKey(row.prize_key)) continue;
    if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) continue;
    quantities.set(row.prize_key, row.quantity);
  }
  return DEMO_ROULETTE_PRIZES.flatMap((prize) => {
    const quantity = quantities.get(prize.key);
    return quantity ? [{ prizeKey: prize.key, quantity }] : [];
  });
}

export function mergeDemoRouletteInventory(
  inventory: DemoRouletteInventoryItem[],
  prizeKey: DemoRoulettePrizeKey,
  quantity: number,
) {
  const byKey = new Map(inventory.map((item) => [item.prizeKey, item.quantity]));
  byKey.set(prizeKey, quantity);
  return DEMO_ROULETTE_PRIZES.flatMap((prize) => {
    const nextQuantity = byKey.get(prize.key);
    return nextQuantity && nextQuantity > 0
      ? [{ prizeKey: prize.key, quantity: nextQuantity }]
      : [];
  });
}

export function demoRouletteRotation(
  currentRotation: number,
  prizeKey: DemoRoulettePrizeKey,
) {
  const prizeIndex = DEMO_ROULETTE_PRIZES.findIndex((prize) => prize.key === prizeKey);
  const segmentAngle = 360 / DEMO_ROULETTE_PRIZES.length;
  const segmentCenter = prizeIndex * segmentAngle + segmentAngle / 2;
  const targetNormalized = (360 - segmentCenter) % 360;
  const currentNormalized = ((currentRotation % 360) + 360) % 360;
  const alignmentDelta = (targetNormalized - currentNormalized + 360) % 360;
  return currentRotation + 5 * 360 + alignmentDelta;
}
