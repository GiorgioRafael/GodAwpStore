import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  defaultRoulettePromotion,
  normalizeStoredPromotion,
  type RoulettePromotionSettings,
} from "./promotion-admin";

const linkedLegacyGwSettings: RoulettePromotionSettings = {
  ...defaultRoulettePromotion("gwstore", "GWStore", "Grow a Garden 2"),
  channelId: "223456789012345678",
  messageId: "323456789012345678",
};

describe("roulette promotion admin branding", () => {
  it("troca somente a copy padrão herdada pela THStore e preserva o vínculo", () => {
    const normalized = normalizeStoredPromotion(
      linkedLegacyGwSettings,
      "thstore",
      "THStore",
      "Grow a Garden 2",
    );

    expect(normalized.title).toBe("A Roleta Giro da THStore chegou");
    expect(normalized.description).not.toContain("GWStore");
    expect(normalized.channelId).toBe(linkedLegacyGwSettings.channelId);
    expect(normalized.messageId).toBe(linkedLegacyGwSettings.messageId);
  });

  it("não sobrescreve uma divulgação que o dono personalizou", () => {
    const custom = {
      ...linkedLegacyGwSettings,
      title: "Sorte do Theuz",
      description: "Minha divulgação personalizada.",
    };

    expect(
      normalizeStoredPromotion(custom, "thstore", "THStore", "Grow a Garden 2"),
    ).toEqual(custom);
  });
});
