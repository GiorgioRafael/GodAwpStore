import { LIVEPIX_MINIMUM_BRL_CENTS } from "@/lib/livepix/limits";

/** R$ 40,00 para cada 1.000 Robux. Valores são sempre calculados em centavos. */
export const ROBUX_PRICE_PER_THOUSAND_CENTS = 4_000;
export const ROBUX_QUANTITY_PER_PRICE_UNIT = 1_000;
export const MINIMUM_ROBUX_QUANTITY = 100;
export const MAXIMUM_ROBUX_QUANTITY = 500_000;

export function calculateRobuxPriceCents(quantity: number): number | null {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < MINIMUM_ROBUX_QUANTITY ||
    quantity > MAXIMUM_ROBUX_QUANTITY
  ) {
    return null;
  }

  // LivePix accepts whole centavos only. Rounding up avoids ever charging
  // less than the configured R$ 40,00 / 1.000 Robux rate.
  const cents = Math.ceil(
    (quantity * ROBUX_PRICE_PER_THOUSAND_CENTS) / ROBUX_QUANTITY_PER_PRICE_UNIT,
  );
  return Number.isSafeInteger(cents) && cents >= LIVEPIX_MINIMUM_BRL_CENTS
    ? cents
    : null;
}

export function formatRobuxQuantity(quantity: number) {
  return new Intl.NumberFormat("pt-BR").format(quantity);
}
