export type OrderAnalyticsMetrics = {
  ordersTodayCount: number;
  revenueTodayCents: number;
  ordersLast7DaysCount: number;
  revenueLast7DaysCents: number;
  ordersLast30DaysCount: number;
  revenueLast30DaysCents: number;
};

export type OrderDailyPoint = {
  date: string;
  ordersCount: number;
  paidOrdersCount: number;
  revenueCents: number;
};

export type OrderChartMetric = "revenue" | "orders";
export type OrderChartRange = "7d" | "30d" | "90d" | "all";

export type OrderChartRow = OrderDailyPoint & {
  label: string;
  value: number;
  movingAverage7: number;
};

const RANGE_DAYS: Record<Exclude<OrderChartRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function saoPauloDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

export function buildOrderChartData(
  points: OrderDailyPoint[],
  metric: OrderChartMetric,
  range: OrderChartRange,
  now = new Date(),
): OrderChartRow[] {
  const today = saoPauloDateKey(now);
  const sorted = [...points].sort((first, second) => first.date.localeCompare(second.date));
  const firstActiveDate = sorted.find((point) => point.date <= today)?.date;
  const start = range === "all"
    ? (firstActiveDate ?? shiftDateKey(today, -29))
    : shiftDateKey(today, -(RANGE_DAYS[range] - 1));
  const byDate = new Map(sorted.map((point) => [point.date, point]));
  const rows: OrderChartRow[] = [];

  for (let cursor = start; cursor <= today; cursor = shiftDateKey(cursor, 1)) {
    const point = byDate.get(cursor) ?? {
      date: cursor,
      ordersCount: 0,
      paidOrdersCount: 0,
      revenueCents: 0,
    };
    const value = metric === "revenue" ? point.revenueCents : point.ordersCount;
    const window = rows.slice(Math.max(0, rows.length - 6));
    const movingAverage7 = (
      window.reduce((total, row) => total + row.value, 0) + value
    ) / (window.length + 1);

    rows.push({ ...point, label: dateLabel(cursor), value, movingAverage7 });
  }

  return rows;
}
