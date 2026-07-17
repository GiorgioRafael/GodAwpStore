import { describe, expect, it } from "vitest";

import {
  applyBoosterDiscount,
  DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
  readBoosterDiscountConfiguration,
} from "./booster-discount";

describe("Nitro Booster discount", () => {
  it("usa 5% acima de R$ 50 como configuração segura padrão", () => {
    expect(readBoosterDiscountConfiguration({})).toEqual(
      DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION,
    );
  });

  it("aplica o desconto somente para booster acima do mínimo", () => {
    expect(
      applyBoosterDiscount(5_000, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, true),
    ).toEqual({
      subtotalPriceCents: 5_000,
      totalPriceCents: 4_750,
      discountBps: 500,
      discountAmountCents: 250,
      discountReason: "server_booster",
    });
    expect(
      applyBoosterDiscount(5_000, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, false),
    ).toMatchObject({ totalPriceCents: 5_000, discountAmountCents: 0 });
    expect(
      applyBoosterDiscount(4_999, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, true),
    ).toMatchObject({ totalPriceCents: 4_999, discountAmountCents: 0 });
  });

  it("trunca frações de centavo igual ao PostgreSQL", () => {
    expect(
      applyBoosterDiscount(5_001, DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION, true),
    ).toMatchObject({ discountAmountCents: 250, totalPriceCents: 4_751 });
  });

  it("ignora configuração adulterada que faria o Pix cair abaixo do mínimo", () => {
    expect(
      readBoosterDiscountConfiguration({
        booster_discount: {
          enabled: true,
          discount_bps: 9_000,
          minimum_subtotal_cents: 100,
        },
      }),
    ).toEqual({
      enabled: true,
      discount_bps: 9_000,
      minimum_subtotal_cents: 5_000,
    });
  });
});
