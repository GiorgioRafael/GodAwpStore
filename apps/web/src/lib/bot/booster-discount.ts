import type { Json, JsonObject } from "@/lib/supabase/database.types";

export const DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION = {
  enabled: true,
  discount_bps: 500,
  minimum_subtotal_cents: 5_000,
} as const;

export type BoosterDiscountConfiguration = {
  enabled: boolean;
  discount_bps: number;
  minimum_subtotal_cents: number;
};

export type AppliedBoosterDiscount = {
  subtotalPriceCents: number;
  totalPriceCents: number;
  discountBps: number;
  discountAmountCents: number;
  discountReason: "server_booster" | null;
};

export function readBoosterDiscountConfiguration(
  configuration: Json,
): BoosterDiscountConfiguration {
  if (!isObject(configuration) || !isObject(configuration.booster_discount)) {
    return { ...DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION };
  }

  const discount = configuration.booster_discount;
  const enabled = typeof discount.enabled === "boolean"
    ? discount.enabled
    : DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION.enabled;
  const discountBps = validInteger(discount.discount_bps, 1, 9_000)
    ? discount.discount_bps
    : DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION.discount_bps;
  const rawMinimumSubtotalCents = validInteger(
    discount.minimum_subtotal_cents,
    100,
    Number.MAX_SAFE_INTEGER,
  )
    ? discount.minimum_subtotal_cents
    : DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION.minimum_subtotal_cents;
  const minimumSubtotalCents = minimumDiscountedSubtotal(rawMinimumSubtotalCents, discountBps) >= 100
    ? rawMinimumSubtotalCents
    : DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION.minimum_subtotal_cents;

  return {
    enabled,
    discount_bps: discountBps,
    minimum_subtotal_cents: minimumSubtotalCents,
  };
}

export function withBoosterDiscountConfiguration(
  configuration: Json,
  boosterDiscount: BoosterDiscountConfiguration,
): JsonObject {
  return {
    ...(isObject(configuration) ? configuration : {}),
    booster_discount: boosterDiscount,
  };
}

export function applyBoosterDiscount(
  subtotalPriceCents: number,
  configuration: BoosterDiscountConfiguration,
  isServerBooster: boolean,
): AppliedBoosterDiscount | null {
  if (!Number.isSafeInteger(subtotalPriceCents) || subtotalPriceCents < 1) return null;

  const eligible =
    isServerBooster &&
    configuration.enabled &&
    subtotalPriceCents >= configuration.minimum_subtotal_cents;
  if (!eligible) {
    return {
      subtotalPriceCents,
      totalPriceCents: subtotalPriceCents,
      discountBps: 0,
      discountAmountCents: 0,
      discountReason: null,
    };
  }

  const discountAmount = Number(
    (BigInt(subtotalPriceCents) * BigInt(configuration.discount_bps)) / 10_000n,
  );
  const totalPriceCents = subtotalPriceCents - discountAmount;
  if (
    !Number.isSafeInteger(discountAmount) ||
    discountAmount < 1 ||
    !Number.isSafeInteger(totalPriceCents) ||
    totalPriceCents < 1
  ) {
    return null;
  }

  return {
    subtotalPriceCents,
    totalPriceCents,
    discountBps: configuration.discount_bps,
    discountAmountCents: discountAmount,
    discountReason: "server_booster",
  };
}

function validInteger(value: Json | undefined, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function minimumDiscountedSubtotal(subtotalPriceCents: number, discountBps: number) {
  return Number((BigInt(subtotalPriceCents) * BigInt(10_000 - discountBps)) / 10_000n);
}

function isObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
