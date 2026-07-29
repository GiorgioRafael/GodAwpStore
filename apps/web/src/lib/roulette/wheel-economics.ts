import { COIN_CENTS } from "./demo";

export type WheelSlotDraft = {
  prizeKey: string;
  productId: string;
  productName: string;
  /** Catalog price of ONE unit. What the slice is worth is this times quantity. */
  valueCents: number;
  quantity: number;
  drawWeight: number;
};

/** What a slice actually hands over: the whole bundle. */
export function slotBundleValueCents(slot: Pick<WheelSlotDraft, "valueCents" | "quantity">) {
  return Math.max(slot.valueCents, 0) * Math.max(slot.quantity, 1);
}

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
  /**
   * Coins a spin gives back, when the prize is sold straight back. Return times
   * the resale rate: the wheel hands over `returnBps` of listed value and the
   * counter buys it back at `saleRateBps` of that.
   */
  coinReturnBps: number;
  /**
   * The payout at which the balance stops shrinking. Above it a spin returns
   * more coins than it cost, so one deposit buys spins without end and the
   * store can be drained a prize at a time. It is `1 / saleRate`, so a counter
   * paying half only trips at 200% while one paying the full price trips at
   * 100% — well inside what the prize-cost break-even still calls profit.
   */
  recyclingCeilingBps: number;
  /** Whichever ceiling binds first. Crossing either one is a loss. */
  safeCeilingBps: number;
  /** Spins one deposited coin buys when every prize is sold back. */
  spinsPerCoin: number;
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
  rates: { markupBps: number; feeBps: number; saleRateBps?: number },
): WheelEconomics {
  const totalWeight = slots.reduce((sum, slot) => sum + Math.max(slot.drawWeight, 0), 0);
  const markup = 1 + Math.max(rates.markupBps, 0) / 10000;
  const netRevenueCents = COIN_CENTS * (1 - Math.min(Math.max(rates.feeBps, 0), 10000) / 10000);
  const saleRateBps = Math.min(Math.max(rates.saleRateBps ?? 0, 0), 10000);
  const breakEvenBps = Math.round(((netRevenueCents * markup) / COIN_CENTS) * 10000);
  // A counter that pays nothing never recycles a coin, so nothing binds there.
  const recyclingCeilingBps =
    saleRateBps > 0 ? Math.round((10000 * 10000) / saleRateBps) : Number.POSITIVE_INFINITY;

  if (totalWeight <= 0) {
    return {
      totalWeight: 0,
      returnBps: 0,
      expectedValueCents: 0,
      expectedCostCents: 0,
      marginCents: netRevenueCents,
      breakEvenBps,
      coinReturnBps: 0,
      recyclingCeilingBps,
      safeCeilingBps: Math.min(breakEvenBps, recyclingCeilingBps),
      spinsPerCoin: 1,
    };
  }

  const expectedValueCents =
    slots.reduce(
      (sum, slot) => sum + Math.max(slot.drawWeight, 0) * slotBundleValueCents(slot),
      0,
    ) / totalWeight;
  const expectedCostCents = expectedValueCents / markup;

  const returnBps = Math.round((expectedValueCents / COIN_CENTS) * 10000);
  const coinReturnBps = Math.round((returnBps * saleRateBps) / 10000);

  return {
    totalWeight,
    returnBps,
    expectedValueCents,
    expectedCostCents,
    marginCents: netRevenueCents - expectedCostCents,
    breakEvenBps,
    coinReturnBps,
    recyclingCeilingBps,
    safeCeilingBps: Math.min(breakEvenBps, recyclingCeilingBps),
    // Geometric: each spin hands back coinReturn of a coin, which buys the next
    // spin, and so on. At or above a whole coin it never converges.
    spinsPerCoin: coinReturnBps >= 10000 ? Number.POSITIVE_INFINITY : 10000 / (10000 - coinReturnBps),
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
  // O teto da reciclagem aperta antes do de custo sempre que a recompra passa
  // de ~62%, e a 100% ele cai para 100% de RTP — dentro da faixa que a conta de
  // custo ainda chamaria de lucro. Ficar só com o break-even esconderia isso.
  if (economics.coinReturnBps >= 10000) {
    return {
      tone: "danger",
      title: `Giros infinitos: ${fmt(economics.coinReturnBps / 100)}% de moedas de volta`,
      detail: `Cada giro devolve mais moeda do que custou, então o saldo do jogador nunca acaba e um único depósito vira giros sem fim. Segure o RTP abaixo de ${fmt(economics.recyclingCeilingBps / 100)}% ou baixe a recompra.`,
    };
  }
  if (economics.returnBps >= economics.breakEvenBps) {
    return {
      tone: "danger",
      title: `Prejuízo: ${fmt(returnPercent)}% devolvido`,
      detail: `Acima de ${fmt(breakEvenPercent)}% o prêmio custa mais do que a moeda trouxe. Cada giro tira ${brl(-economics.marginCents)} do caixa.`,
    };
  }
  // Perto do teto da reciclagem o número que importa não é a margem do giro:
  // é quantos giros um depósito ainda compra antes de o saldo morrer.
  if (economics.coinReturnBps >= 9000) {
    return {
      tone: "warning",
      title: `No limite: ${fmt(economics.coinReturnBps / 100)}% de moedas de volta`,
      detail: `Um depósito compra ${fmt(economics.spinsPerCoin)} giros antes de o saldo acabar. Acima de ${fmt(economics.recyclingCeilingBps / 100)}% de RTP ele deixa de acabar.`,
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
    detail: `Sobra ${brl(economics.marginCents)} por giro, acima dos ${fmt(plainSaleMarginBps / 100)}% de uma venda normal. Um depósito compra ${fmt(economics.spinsPerCoin)} giros, e o prejuízo começa em ${fmt(economics.safeCeilingBps / 100)}%.`,
  };
}

function fmt(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function brl(cents: number) {
  return `R$ ${(Math.abs(cents) / 100).toFixed(2).replace(".", ",")}`;
}
