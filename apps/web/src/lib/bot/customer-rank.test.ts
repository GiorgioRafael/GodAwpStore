import { describe, expect, it } from "vitest";

import { DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION } from "./booster-discount";
import {
  applyBestCustomerDiscount,
  minimumLivePixQuantityWithCustomerDiscount,
  type CustomerRankProgress,
} from "./customer-rank";

const progress: CustomerRankProgress = {
  guildId: "guild-row",
  buyerDiscordId: "423456789012345678",
  totalSpentCents: 150_000,
  currentRank: {
    code: "diamond_i",
    name: "Diamond I",
    roleName: "💎 Cliente Diamond I",
    minimumSpendCents: 150_000,
    discountBps: 1_000,
    color: 1_936_632,
    sortOrder: 12,
  },
  nextRank: null,
  amountToNextRankCents: 0,
};

describe("customer rank pricing", () => {
  it("aplica 10% de Diamond acima dos 5% de Nitro Booster", () => {
    expect(
      applyBestCustomerDiscount(
        5_000,
        DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
        true,
        progress,
      ),
    ).toEqual({
      subtotalPriceCents: 5_000,
      totalPriceCents: 4_500,
      discountBps: 1_000,
      discountAmountCents: 500,
      discountReason: "customer_rank",
    });
  });

  it("não inventa desconto quando a fração calculada é menor que um centavo", () => {
    expect(
      applyBestCustomerDiscount(
        9,
        DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
        false,
        { ...progress, currentRank: { ...progress.currentRank!, discountBps: 100 } },
      ),
    ).toMatchObject({
      totalPriceCents: 9,
      discountBps: 0,
      discountReason: null,
    });
  });

  it("calcula a quantidade mínima usando o valor já descontado", () => {
    expect(
      minimumLivePixQuantityWithCustomerDiscount({
        unitPriceCents: 50,
        boosterConfiguration: DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
        isServerBooster: false,
        rank: progress,
      }),
    ).toEqual({ quantity: 3, totalPriceCents: 135 });
  });
});
