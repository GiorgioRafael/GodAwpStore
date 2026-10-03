export const GWSTORE_RANKING_GUILD_ID = "1401264061101899820";
export const GWSTORE_RANKING_CHANNEL_ID = "1556055233937940614";
export const TOP_SPENDERS_TITLE = "🏆 TOP 5 CLIENTES • GWSTORE";

export type PaidCustomerPurchase = {
  source: "product" | "robux";
  id: string;
  guildId: string;
  buyerDiscordId: string;
  amountCents: number;
  paidAt: string;
};

export type TopSpender = {
  buyerDiscordId: string;
  totalSpentCents: number;
};

/** One row per checkout, including carts; never sum joined order-item rows. */
export function rankTopSpenders(guildId: string, purchases: PaidCustomerPurchase[]): TopSpender[] {
  const totals = new Map<string, { cents: number; firstPaidAt: string }>();
  const seen = new Set<string>();
  for (const purchase of purchases) {
    if (purchase.guildId !== guildId) continue;
    const key = `${purchase.source}:${purchase.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!/^[0-9]{15,22}$/.test(purchase.buyerDiscordId) ||
      !Number.isSafeInteger(purchase.amountCents) || purchase.amountCents < 0 ||
      !Number.isFinite(Date.parse(purchase.paidAt))) {
      throw new Error("Compra confirmada inválida no ranking.");
    }
    if (purchase.amountCents === 0) continue;
    const total = totals.get(purchase.buyerDiscordId) ?? { cents: 0, firstPaidAt: purchase.paidAt };
    total.cents += purchase.amountCents;
    if (!Number.isSafeInteger(total.cents)) throw new Error("Total do ranking excedeu o limite permitido.");
    if (Date.parse(purchase.paidAt) < Date.parse(total.firstPaidAt)) total.firstPaidAt = purchase.paidAt;
    totals.set(purchase.buyerDiscordId, total);
  }
  return [...totals].sort(([leftId, left], [rightId, right]) =>
    right.cents - left.cents || Date.parse(left.firstPaidAt) - Date.parse(right.firstPaidAt) ||
    leftId.localeCompare(rightId),
  ).slice(0, 5).map(([buyerDiscordId, total]) => ({ buyerDiscordId, totalSpentCents: total.cents }));
}

export function topSpendersMessage(leaders: TopSpender[]) {
  const medals = ["🥇", "🥈", "🥉", "🏅", "🏅"];
  return {
    content: "",
    embeds: [{
      title: TOP_SPENDERS_TITLE,
      color: 0xF4C542,
      description: [
        "Os clientes que mais compraram na GWStore:",
        "",
        ...(leaders.length ? leaders.slice(0, 5).map((leader, index) =>
          `${medals[index]} **${index + 1}º lugar** · <@${leader.buyerDiscordId}>`,
        ) : ["O ranking aparecerá após a primeira compra confirmada."]),
        "",
        "**Como funciona**",
        "Ranking geral pelo total pago em produtos e Robux neste servidor. Pedidos pendentes, cancelados e reembolsados não contam.",
        "",
        "Use **/rank** em outro canal para consultar seu total e seus descontos.",
      ].join("\n"),
      footer: { text: "GWStore • Atualização automática a cada 5 minutos" },
    }],
    allowed_mentions: { parse: [] },
  };
}
