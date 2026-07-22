/** @jsxImportSource chat */

import { toCardElement } from "chat";
import { describe, expect, it } from "vitest";

import { customerRankCard } from "./customer-rank-card";

describe("customerRankCard", () => {
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
});
