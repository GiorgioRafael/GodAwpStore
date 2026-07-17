export const LIVEPIX_MINIMUM_BRL_CENTS = 100;
export const MAXIMUM_ORDER_QUANTITY = 10_000;

export function minimumLivePixQuantity(unitPriceCents: number) {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) return null;
  return Math.ceil(LIVEPIX_MINIMUM_BRL_CENTS / unitPriceCents);
}

export function calculateOrderTotalCents(unitPriceCents: number, quantity: number) {
  if (
    !Number.isSafeInteger(unitPriceCents) ||
    unitPriceCents < 1 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAXIMUM_ORDER_QUANTITY
  ) {
    return null;
  }

  const total = unitPriceCents * quantity;
  return Number.isSafeInteger(total) ? total : null;
}
