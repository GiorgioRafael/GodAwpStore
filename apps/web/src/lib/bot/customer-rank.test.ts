import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ IS_GWSTORE: true }));
vi.mock("@/lib/brand", () => brand);

import { DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION } from "./booster-discount";
import {
  applyBestCustomerDiscount,
  customerDiscountsEnabled,
  minimumLivePixCartQuantitiesWithCustomerDiscount,
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

beforeEach(() => { brand.IS_GWSTORE = true; vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", "true"); });
afterEach(() => vi.unstubAllEnvs());

describe("customer rank pricing", () => {
  it.each([progress, { ...progress, currentRank: null }])("pausa ranking e booster na GW sem alterar seus benefícios cadastrados", rank => {
    vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", "false");
    expect(applyBestCustomerDiscount(5_000, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, true, rank)).toEqual({
      subtotalPriceCents: 5_000, totalPriceCents: 5_000, discountBps: 0, discountAmountCents: 0, discountReason: null,
    });
    expect(progress.currentRank?.discountBps).toBe(1_000);
    expect(DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION.enabled).toBe(true);
  });

  it.each([0, -1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])("continua rejeitando subtotal inválido durante a pausa (%s)", subtotal => {
    vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", "false");
    expect(applyBestCustomerDiscount(subtotal, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, true, progress)).toBeNull();
  });

  it("a pausa da GW não altera descontos da THStore", () => {
    vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", "false");
    brand.IS_GWSTORE = false;
    expect(applyBestCustomerDiscount(5_000, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, true, progress)).toMatchObject({ totalPriceCents: 4_500, discountReason: "customer_rank" });
    expect(applyBestCustomerDiscount(5_000, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, true, { ...progress, currentRank: null })).toMatchObject({ totalPriceCents: 4_750, discountReason: "server_booster" });
  });

  it("retoma os benefícios existentes ao remover a pausa e calcula o mínimo de pagamento correto", () => {
    const input = { unitPriceCents: 100, boosterConfiguration: DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, isServerBooster: true, rank: progress };
    vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", "false");
    expect(minimumLivePixQuantityWithCustomerDiscount(input)).toEqual({ quantity: 1, totalPriceCents: 100 });
    vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", undefined);
    expect(customerDiscountsEnabled()).toBe(true);
    expect(minimumLivePixQuantityWithCustomerDiscount(input)).toEqual({ quantity: 2, totalPriceCents: 180 });
  });

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

  it("calcula as quantidades iniciais do carrinho sobre o total já descontado", () => {
    expect(
      minimumLivePixCartQuantitiesWithCustomerDiscount({
        lines: [
          { unitPriceCents: 100, availableStock: 10 },
        ],
        boosterConfiguration: DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
        isServerBooster: false,
        rank: progress,
      }),
    ).toEqual({ quantities: [2], totalPriceCents: 180 });

    expect(
      minimumLivePixCartQuantitiesWithCustomerDiscount({
        lines: [
          { unitPriceCents: 40, availableStock: 10 },
          { unitPriceCents: 50, availableStock: 10 },
        ],
        boosterConfiguration: DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
        isServerBooster: false,
        rank: progress,
      }),
    ).toEqual({ quantities: [1, 2], totalPriceCents: 126 });
  });

  it("não sugere uma quantidade acima do estoque disponível", () => {
    expect(
      minimumLivePixCartQuantitiesWithCustomerDiscount({
        lines: [{ unitPriceCents: 100, availableStock: 1 }],
        boosterConfiguration: DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
        isServerBooster: false,
        rank: progress,
      }),
    ).toBeNull();
  });
});
