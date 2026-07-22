import type { BoosterDiscountConfiguration } from "./booster-discount";
import { applyBoosterDiscount } from "./booster-discount";
import {
  LIVEPIX_MINIMUM_BRL_CENTS,
  MAXIMUM_ORDER_QUANTITY,
} from "@/lib/livepix/limits";

export type CustomerDiscountReason = "server_booster" | "customer_rank" | null;

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
  discountReason: CustomerDiscountReason;
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
