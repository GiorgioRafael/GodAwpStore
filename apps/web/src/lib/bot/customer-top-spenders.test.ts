import { describe, expect, it } from "vitest";
import { rankTopSpenders, topSpendersMessage, type PaidCustomerPurchase } from "./customer-top-spenders";

const buyer = (id: number) => `${id}23456789012345678`;
const purchase = (id: number, amountCents: number, extra: Partial<PaidCustomerPurchase> = {}): PaidCustomerPurchase => ({
  source: "product", id: String(id), guildId: "gw", buyerDiscordId: buyer(id),
  amountCents, paidAt: "2026-10-01T00:00:00Z", ...extra,
});

describe("Top 5 clientes", () => {
  it("soma produtos, carrinhos e Robux por comprador e mantém apenas os cinco maiores", () => {
    const rows = [purchase(1, 200), purchase(1, 300, { source: "robux" }),
      ...[2, 3, 4, 5, 6, 7].map(id => purchase(id, id * 50)),
      purchase(8, 999_999, { guildId: "th" })];
    expect(rankTopSpenders("gw", rows)).toEqual([
      { buyerDiscordId: buyer(1), totalSpentCents: 500 },
      { buyerDiscordId: buyer(7), totalSpentCents: 350 },
      { buyerDiscordId: buyer(6), totalSpentCents: 300 },
      { buyerDiscordId: buyer(5), totalSpentCents: 250 },
      { buyerDiscordId: buyer(4), totalSpentCents: 200 },
    ]);
  });

  it("não duplica uma compra e desempata pela primeira compra confirmada", () => {
    const first = purchase(1, 500);
    const rows = [first, first, purchase(2, 500, { paidAt: "2026-09-01T00:00:00Z" }), purchase(3, 0)];
    expect(rankTopSpenders("gw", rows).map(row => row.buyerDiscordId)).toEqual([buyer(2), buyer(1)]);
    expect(rankTopSpenders("gw", rows.reverse()).map(row => row.buyerDiscordId)).toEqual([buyer(2), buyer(1)]);
  });

  it("falha sem publicar dados incompletos quando o valor pago é inválido", () => {
    expect(() => rankTopSpenders("gw", [purchase(1, NaN)])).toThrow("inválida");
    expect(() => rankTopSpenders("gw", [purchase(1, Number.MAX_SAFE_INTEGER),
      purchase(2, 1, { buyerDiscordId: buyer(1) })])).toThrow("limite");
  });

  it("mostra posições sem expor valores individuais ou enviar notificações", () => {
    const message = topSpendersMessage([{ buyerDiscordId: buyer(1), totalSpentCents: 98765 }]);
    expect(message.embeds[0].description).toContain(`🥇 **1º lugar** · <@${buyer(1)}>`);
    expect(JSON.stringify(message)).not.toContain("98765");
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(topSpendersMessage([]).embeds[0].description).toContain("primeira compra confirmada");
  });

  it("escapa nomes públicos para não criar links ou formatação no ranking", () => {
    const message = topSpendersMessage([{ buyerDiscordId: buyer(1), totalSpentCents: 500,
      displayName: "**Nome** [link](https://example.com)\nnovo" }]);
    expect(message.embeds[0].description).toContain("\\*\\*Nome\\*\\* \\[link\\]\\(https://example.com\\) novo");
  });
});
