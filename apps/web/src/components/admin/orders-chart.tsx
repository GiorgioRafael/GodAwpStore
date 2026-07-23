"use client";

import { useMemo, useState } from "react";
import { formatBrl } from "@godawp/domain";
import { BarChart3, CircleDollarSign } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import {
  buildOrderChartData,
  type OrderChartMetric,
  type OrderChartRange,
  type OrderChartRow,
  type OrderDailyPoint,
} from "@/lib/orders-analytics";

const RANGE_OPTIONS: Array<{ value: OrderChartRange; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "Tudo" },
];

const METRIC_OPTIONS: Array<{ value: OrderChartMetric; label: string }> = [
  { value: "revenue", label: "Receita" },
  { value: "orders", label: "Pedidos" },
];

function fullDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    dateStyle: "long",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatValue(value: number, metric: OrderChartMetric): string {
  if (metric === "revenue") return formatBrl(Math.round(value));
  return Math.round(value).toLocaleString("pt-BR");
}

function OrderTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ payload?: OrderChartRow }>;
  metric: OrderChartMetric;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="min-w-48 rounded-xl border border-border-strong bg-surface-elevated p-3 text-xs shadow-panel">
      <p className="font-semibold text-foreground">{fullDate(row.date)}</p>
      <dl className="mt-2 space-y-1.5 text-muted">
        <div className="flex items-center justify-between gap-4">
          <dt>{metric === "revenue" ? "Receita" : "Pedidos"}</dt>
          <dd className="font-medium text-foreground">{formatValue(row.value, metric)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt>Média móvel 7d</dt>
          <dd className="font-medium text-gold-bright">
            {formatValue(row.movingAverage7, metric)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="inline-flex rounded-xl border border-border bg-surface-muted p-1"
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-gold text-[#171208] shadow-gold"
              : "text-muted hover:bg-white/[0.04] hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function OrdersChart({ points }: { points: OrderDailyPoint[] }) {
  const [metric, setMetric] = useState<OrderChartMetric>("revenue");
  const [range, setRange] = useState<OrderChartRange>("30d");
  const data = useMemo(
    () => buildOrderChartData(points, metric, range),
    [metric, points, range],
  );
  const hasActivity = data.some((row) => row.value > 0);
  const Icon = metric === "revenue" ? CircleDollarSign : BarChart3;
  const color = metric === "revenue" ? "#65c98b" : "#d4a64a";

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border p-5 sm:p-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.06] text-gold">
            <Icon aria-hidden="true" className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Receita e pedidos por dia
            </h2>
            <p className="mt-1 text-sm text-muted">
              Barras diárias e média móvel dos últimos sete dias.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SegmentedControl
            label="Métrica do gráfico"
            options={METRIC_OPTIONS}
            value={metric}
            onChange={setMetric}
          />
          <SegmentedControl
            label="Período do gráfico"
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
          />
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {hasActivity ? (
          <div className="h-[320px] w-full sm:h-[360px]" aria-label={`Gráfico de ${metric === "revenue" ? "receita" : "pedidos"}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid stroke="#2a2923" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  minTickGap={28}
                  tick={{ fill: "#9b998e", fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  tick={{ fill: "#9b998e", fontSize: 11 }}
                  tickFormatter={(value) => formatValue(Number(value), metric)}
                  tickLine={false}
                  width={metric === "revenue" ? 82 : 48}
                />
                <Tooltip
                  cursor={{ fill: "rgba(212, 166, 74, 0.05)" }}
                  content={<OrderTooltip metric={metric} />}
                />
                <Bar dataKey="value" fill={color} radius={[5, 5, 2, 2]} maxBarSize={30} />
                <Line
                  dataKey="movingAverage7"
                  dot={false}
                  stroke="#edc66f"
                  strokeDasharray="5 4"
                  strokeWidth={2}
                  type="monotone"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-border bg-surface-muted/40 px-6 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">Sem movimento neste período</p>
              <p className="mt-1 text-xs text-muted">
                O gráfico será preenchido automaticamente quando houver novos pedidos.
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
