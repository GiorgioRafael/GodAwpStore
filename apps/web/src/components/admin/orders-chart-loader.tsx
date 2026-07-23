"use client";

import dynamic from "next/dynamic";

import { Card } from "@/components/ui/card";
import type { OrderDailyPoint } from "@/lib/orders-analytics";

const LazyOrdersChart = dynamic(
  () => import("./orders-chart").then((module) => module.OrdersChart),
  {
    ssr: false,
    loading: () => (
      <Card className="h-[470px] animate-pulse bg-surface-muted/50" aria-label="Carregando gráfico" />
    ),
  },
);

export function OrdersChartLoader({ points }: { points: OrderDailyPoint[] }) {
  return <LazyOrdersChart points={points} />;
}
