import { describe, expect, it } from "vitest";

import { buildOrderChartData, type OrderDailyPoint } from "./orders-analytics";

const points: OrderDailyPoint[] = [
  { date: "2026-07-20", ordersCount: 2, paidOrdersCount: 1, revenueCents: 500 },
  { date: "2026-07-22", ordersCount: 4, paidOrdersCount: 2, revenueCents: 1_500 },
];

describe("buildOrderChartData", () => {
  it("preenche dias sem movimento e calcula média móvel", () => {
    const rows = buildOrderChartData(points, "revenue", "7d", new Date("2026-07-22T15:00:00Z"));

    expect(rows).toHaveLength(7);
    expect(rows.at(-2)).toMatchObject({ date: "2026-07-21", value: 0 });
    expect(rows.at(-1)).toMatchObject({ date: "2026-07-22", value: 1_500 });
    expect(rows.at(-1)?.movingAverage7).toBeCloseTo(2_000 / 7);
  });

  it("alterna a série para quantidade de pedidos", () => {
    const rows = buildOrderChartData(points, "orders", "30d", new Date("2026-07-22T15:00:00Z"));
    expect(rows.at(-1)?.value).toBe(4);
  });

  it("usa a primeira data ativa no intervalo completo", () => {
    const rows = buildOrderChartData(points, "orders", "all", new Date("2026-07-22T15:00:00Z"));
    expect(rows.map((row) => row.date)).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });
});
