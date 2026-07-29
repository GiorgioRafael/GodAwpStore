import { COIN_CENTS } from "./demo";

export type WheelSlotDraft = {
  prizeKey: string;
  productId: string;
  productName: string;
  valueCents: number;
  drawWeight: number;
};

export type WheelEconomics = {
  totalWeight: number;
  /** What the wheel pays out per coin spun, in basis points. */
  returnBps: number;
  /** Listed value the wheel hands out on an average spin. */
  expectedValueCents: number;
  /** What that value costs the store once the markup is taken back out. */
  expectedCostCents: number;
  /** Left over per coin spun, after the provider fee and the prize cost. */
  marginCents: number;
  /** The payout at which a spin stops making money. */
  breakEvenBps: number;
};

/**
 * The wheel's economics, worked out the same way the panel reports them so the
 * number an admin sees while editing is the number they get after saving.
 *
 * A spin is paid with one coin. The provider fee was charged on the deposit, so
 * it lands here as a share of that coin; the prize costs its listed price taken
 * back through the markup. Everything is per coin spun.
 */
export function wheelEconomics(
  slots: readonly WheelSlotDraft[],
  rates: { markupBps: number; feeBps: number },
): WheelEconomics {
  const totalWeight = slots.reduce((sum, slot) => sum + Math.max(slot.drawWeight, 0), 0);
  const markup = 1 + Math.max(rates.markupBps, 0) / 10000;
  const netRevenueCents = COIN_CENTS * (1 - Math.min(Math.max(rates.feeBps, 0), 10000) / 10000);

  if (totalWeight <= 0) {
    return {
      totalWeight: 0,
      returnBps: 0,
      expectedValueCents: 0,
      expectedCostCents: 0,
      marginCents: netRevenueCents,
      breakEvenBps: Math.round(((netRevenueCents * markup) / COIN_CENTS) * 10000),
    };
  }

  const expectedValueCents =
    slots.reduce(
      (sum, slot) => sum + Math.max(slot.drawWeight, 0) * Math.max(slot.valueCents, 0),
      0,
    ) / totalWeight;
  const expectedCostCents = expectedValueCents / markup;

  return {
    totalWeight,
    returnBps: Math.round((expectedValueCents / COIN_CENTS) * 10000),
    expectedValueCents,
    expectedCostCents,
    marginCents: netRevenueCents - expectedCostCents,
    // Above this the prize costs more than the coin brought in.
    breakEvenBps: Math.round(((netRevenueCents * markup) / COIN_CENTS) * 10000),
  };
}

/** The chance of each slot, in basis points, rounded for display. */
export function slotChanceBps(slot: WheelSlotDraft, totalWeight: number) {
  if (totalWeight <= 0) return 0;
  return Math.round((Math.max(slot.drawWeight, 0) / totalWeight) * 10000);
}

/**
 * The chances as shown, adding to exactly 100%.
 *
 * Rounding each slot on its own leaves a column that reads 99,98% or 100,02%,
 * and an operator balancing a wheel cannot tell a rounding artefact from a
 * mistake they made. Largest remainder hands the leftover basis points to the
 * slots that lost the most to rounding, so the parts sum to the whole and each
 * one is still the closest it can be to its true share.
 */
export function slotChanceShares(slots: readonly WheelSlotDraft[]): number[] {
  const weights = slots.map((slot) => Math.max(slot.drawWeight, 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return slots.map(() => 0);

  const exact = weights.map((weight) => (weight / totalWeight) * 10000);
  const floors = exact.map((value) => Math.floor(value));
  let leftover = 10000 - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const shares = [...floors];
  for (const { index } of order) {
    if (leftover <= 0) break;
    shares[index] += 1;
    leftover -= 1;
  }
  return shares;
}

export type WheelVerdict = {
  tone: "danger" | "warning" | "success";
  title: string;
  detail: string;
};

/**
 * What to tell the operator about the payout they just typed.
 *
 * The band is derived, not chosen: below it the wheel feels like a scam and
 * players stop coming back; above it the margin drops under what a plain sale
 * already earns, and past break-even the store pays people to play.
 */
export function wheelVerdict(
  economics: WheelEconomics,
  rates: { markupBps: number },
): WheelVerdict {
  const returnPercent = economics.returnBps / 100;
  const breakEvenPercent = economics.breakEvenBps / 100;
  // A plain store sale keeps the markup over the cost; the roulette should not
  // do worse than simply selling the item.
  const plainSaleMarginBps = Math.round(
    (rates.markupBps / (10000 + rates.markupBps)) * 10000,
  );
  const marginBps = Math.round((economics.marginCents / COIN_CENTS) * 10000);

  if (economics.totalWeight <= 0) {
    return {
      tone: "danger",
      title: "A roda não tem peso nenhum",
      detail: "Sem peso positivo em algum prêmio, o sorteio não tem o que escolher.",
    };
  }
  if (economics.returnBps >= economics.breakEvenBps) {
    return {
      tone: "danger",
      title: `Prejuízo: ${fmt(returnPercent)}% devolvido`,
      detail: `Acima de ${fmt(breakEvenPercent)}% o prêmio custa mais do que a moeda trouxe. Cada giro tira ${brl(-economics.marginCents)} do caixa.`,
    };
  }
  if (marginBps < plainSaleMarginBps) {
    return {
      tone: "warning",
      title: `Margem apertada: ${fmt(returnPercent)}% devolvido`,
      detail: `Sobra ${brl(economics.marginCents)} por giro — menos do que os ${fmt(plainSaleMarginBps / 100)}% que uma venda normal já rende. Ainda dá lucro, mas vender o item direto rende mais.`,
    };
  }
  if (economics.returnBps < 6000) {
    return {
      tone: "warning",
      title: `Pouco generoso: ${fmt(returnPercent)}% devolvido`,
      detail: `Sobra ${brl(economics.marginCents)} por giro, mas o jogador perde ${fmt(100 - returnPercent)}% do que gasta. Abaixo de 60% a roleta cansa rápido e o jogador não volta.`,
    };
  }
  return {
    tone: "success",
    title: `Equilibrado: ${fmt(returnPercent)}% devolvido`,
    detail: `Sobra ${brl(economics.marginCents)} por giro, acima dos ${fmt(plainSaleMarginBps / 100)}% de uma venda normal. O prejuízo só começa em ${fmt(breakEvenPercent)}%.`,
  };
}

function fmt(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function brl(cents: number) {
  return `R$ ${(Math.abs(cents) / 100).toFixed(2).replace(".", ",")}`;
}
