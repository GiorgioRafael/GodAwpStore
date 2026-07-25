import type { BoosterDiscountConfiguration } from "./booster-discount";
import { applyBoosterDiscount } from "./booster-discount";
import {
  LIVEPIX_MINIMUM_BRL_CENTS,
  MAXIMUM_ORDER_QUANTITY,
} from "@/lib/livepix/limits";

export type CustomerDiscountReason =
  | "server_booster"
  | "customer_rank"
  | "upsell"
  | "lead_recovery"
  | null;

export type CustomerRankLevel = {
  code: string;
  name: string;
  roleName: string;
  minimumSpendCents: number;
  discountBps: number;
  color: number;
  sortOrder: number;
};

export type CustomerRankProgress = {
  guildId: string;
  buyerDiscordId: string;
  totalSpentCents: number;
  currentRank: CustomerRankLevel | null;
  nextRank: CustomerRankLevel | null;
  amountToNextRankCents: number;
};

export type AppliedCustomerDiscount = {
  subtotalPriceCents: number;
  totalPriceCents: number;
  discountBps: number;
  discountAmountCents: number;
  discountReason: Exclude<CustomerDiscountReason, "upsell" | "lead_recovery">;
};

export function applyBestCustomerDiscount(
  subtotalPriceCents: number,
  boosterConfiguration: BoosterDiscountConfiguration,
  isServerBooster: boolean,
  rank: CustomerRankProgress,
): AppliedCustomerDiscount | null {
  const booster = applyBoosterDiscount(
    subtotalPriceCents,
    boosterConfiguration,
    isServerBooster,
  );
  if (!booster) return null;

  const rankDiscountBps = rank.currentRank?.discountBps ?? 0;
  const rankDiscountAmountCents = calculateDiscountAmount(
    subtotalPriceCents,
    rankDiscountBps,
  );

  // On ties the rank wins so the receipt reflects the customer's progression.
  if (
    rankDiscountAmountCents > 0 &&
    rankDiscountBps >= booster.discountBps
  ) {
    return {
      subtotalPriceCents,
      totalPriceCents: subtotalPriceCents - rankDiscountAmountCents,
      discountBps: rankDiscountBps,
      discountAmountCents: rankDiscountAmountCents,
      discountReason: "customer_rank",
    };
  }

  return booster;
}

export function minimumLivePixQuantityWithCustomerDiscount(input: {
  unitPriceCents: number;
  boosterConfiguration: BoosterDiscountConfiguration;
  isServerBooster: boolean;
  rank: CustomerRankProgress;
}) {
  if (!Number.isSafeInteger(input.unitPriceCents) || input.unitPriceCents < 1) {
    return null;
  }

  const undiscountedMinimum = Math.ceil(
    LIVEPIX_MINIMUM_BRL_CENTS / input.unitPriceCents,
  );
  for (
    let quantity = Math.max(1, undiscountedMinimum);
    quantity <= MAXIMUM_ORDER_QUANTITY;
    quantity += 1
  ) {
    const subtotalPriceCents = input.unitPriceCents * quantity;
    if (!Number.isSafeInteger(subtotalPriceCents)) return null;
    const pricing = applyBestCustomerDiscount(
      subtotalPriceCents,
      input.boosterConfiguration,
      input.isServerBooster,
      input.rank,
    );
    if (pricing && pricing.totalPriceCents >= LIVEPIX_MINIMUM_BRL_CENTS) {
      return {
        quantity,
        totalPriceCents: pricing.totalPriceCents,
      };
    }
  }

  return null;
}

export function minimumLivePixCartQuantitiesWithCustomerDiscount(input: {
  lines: Array<{
    unitPriceCents: number;
    availableStock: number;
  }>;
  boosterConfiguration: BoosterDiscountConfiguration;
  isServerBooster: boolean;
  rank: CustomerRankProgress;
}) {
  if (
    input.lines.length < 1 ||
    input.lines.some(
      (line) =>
        !Number.isSafeInteger(line.unitPriceCents) ||
        line.unitPriceCents < 1 ||
        !Number.isSafeInteger(line.availableStock) ||
        line.availableStock < 1,
    )
  ) {
    return null;
  }

  const quantities = input.lines.map(() => 1);
  const maximumQuantities = input.lines.map((line) =>
    Math.min(line.availableStock, MAXIMUM_ORDER_QUANTITY),
  );

  while (true) {
    const subtotalPriceCents = input.lines.reduce(
      (sum, line, index) => sum + line.unitPriceCents * (quantities[index] ?? 0),
      0,
    );
    if (!Number.isSafeInteger(subtotalPriceCents)) return null;

    const pricing = applyBestCustomerDiscount(
      subtotalPriceCents,
      input.boosterConfiguration,
      input.isServerBooster,
      input.rank,
    );
    if (!pricing) return null;
    if (pricing.totalPriceCents >= LIVEPIX_MINIMUM_BRL_CENTS) {
      return {
        quantities,
        totalPriceCents: pricing.totalPriceCents,
      };
    }

    let nextLineIndex = -1;
    for (let index = 0; index < input.lines.length; index += 1) {
      if ((quantities[index] ?? 0) >= (maximumQuantities[index] ?? 0)) continue;
      if (
        nextLineIndex === -1 ||
        input.lines[index]!.unitPriceCents >
          input.lines[nextLineIndex]!.unitPriceCents
      ) {
        nextLineIndex = index;
      }
    }
    if (nextLineIndex === -1) return null;
    quantities[nextLineIndex] = (quantities[nextLineIndex] ?? 0) + 1;
  }
}

function calculateDiscountAmount(subtotalPriceCents: number, discountBps: number) {
  if (
    !Number.isSafeInteger(subtotalPriceCents) ||
    subtotalPriceCents < 1 ||
    !Number.isInteger(discountBps) ||
    discountBps <= 0 ||
    discountBps > 9_000
  ) {
    return 0;
  }
  return Number(
    (BigInt(subtotalPriceCents) * BigInt(discountBps)) / 10_000n,
  );
}
