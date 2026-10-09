/** @jsxImportSource chat */

import { toCardElement } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true, STORE_NAME_UPPER: "GWSTORE" }));

import {
  customerRankCard,
  customerRankGuideCard,
} from "./customer-rank-card";

beforeEach(() => vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("customerRankCard", () => {
  it("mantém o progresso e informa a pausa sem prometer descontos automáticos", () => {
    vi.stubEnv("GWSTORE_CUSTOMER_DISCOUNTS_ENABLED", "false");
    const serialized = JSON.stringify(toCardElement(customerRankCard({ guildId: "guild-row", buyerDiscordId: "223456789012345678", totalSpentCents: 150_000,
      currentRank: { code: "diamond_i", name: "Diamond I", roleName: "Cliente Diamond I", minimumSpendCents: 150_000, discountBps: 1_000, color: 1, sortOrder: 12 },
      nextRank: null, amountToNextRankCents: 0 })));
    expect(serialized).toContain("Cliente Diamond I");
    expect(serialized).toContain("temporariamente pausados");
    expect(serialized).not.toContain("10% de desconto");
    expect(serialized).not.toContain("entra automaticamente");
    const guide = JSON.stringify(toCardElement(customerRankGuideCard()));
    expect(guide).toContain("Diamond V · R$ 5.000");
    expect(guide).toContain("temporariamente pausados");
    expect(guide).not.toContain("de desconto");
    expect(guide).not.toContain("aplicado automaticamente");
  });

  it("mostra gasto, desconto e quanto falta para o próximo nível", () => {
    const serialized = JSON.stringify(
      toCardElement(
        customerRankCard({
          guildId: "guild-row",
          buyerDiscordId: "223456789012345678",
          totalSpentCents: 8_000,
          currentRank: {
            code: "prata_ii",
            name: "Prata II",
            roleName: "🥈 Cliente Prata II",
            minimumSpendCents: 8_000,
            discountBps: 200,
            color: 11_186_877,
            sortOrder: 5,
          },
          nextRank: {
            code: "prata_iii",
            name: "Prata III",
            roleName: "🥈 Cliente Prata III",
            minimumSpendCents: 12_000,
            discountBps: 200,
            color: 14_080_735,
            sortOrder: 6,
          },
          amountToNextRankCents: 4_000,
        }),
      ),
    );

    expect(serialized).toContain("R$ 80,00");
    expect(serialized).toContain("Cliente Prata II");
    expect(serialized).toContain("2% de desconto");
    expect(serialized).toContain("Faltam R$ 40,00");
    expect(serialized).toContain("Cliente Prata III");
  });

  it("publica a tabela completa e orienta o cliente a usar /rank", () => {
    const serialized = JSON.stringify(toCardElement(customerRankGuideCard()));

    expect(serialized).toContain("SISTEMA DE RANKING");
    expect(serialized).toContain("Bronze I · R$ 5");
    expect(serialized).toContain("Prata III · R$ 120");
    expect(serialized).toContain("Ouro V · R$ 1.000");
    expect(serialized).toContain("Diamond V · R$ 5.000");
    expect(serialized).toContain("/rank");
    expect(serialized).toContain("R$ 1,00");
  });
});
