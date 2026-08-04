"use client";

import { formatBrl } from "@godawp/domain";
import { BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DiscordBotsMonthlyRevenue } from "@/lib/data/discord-bots-dashboard";

function RevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DiscordBotsMonthlyRevenue }>;
}) {
  const month = payload?.[0]?.payload;
  if (!active || !month) return null;

  return (
    <div className="min-w-52 rounded-xl border border-slate-700 bg-[#111925] p-3 text-xs shadow-2xl">
      <p className="font-semibold text-white">{month.monthLabel}</p>
      <dl className="mt-2 space-y-1.5 text-slate-400">
        <div className="flex items-center justify-between gap-5">
          <dt>Faturamento</dt>
          <dd className="font-medium text-white">{formatBrl(month.grossRevenueCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-5">
          <dt>Comissão</dt>
          <dd className="font-medium text-violet-300">{formatBrl(month.commissionCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-5">
          <dt>Pedidos pagos</dt>
          <dd className="font-medium text-white">{month.paidOrdersCount.toLocaleString("pt-BR")}</dd>
        </div>
      </dl>
    </div>
  );
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function RevenueHistoryChart({ data }: { data: DiscordBotsMonthlyRevenue[] }) {
  const hasRevenue = data.some((month) => month.grossRevenueCents > 0);

  return (
    <section
      id="financeiro"
      aria-labelledby="historico-faturamento"
      className="min-w-0 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 shadow-[0_22px_70px_rgba(0,0,0,.2)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="historico-faturamento" className="text-base font-semibold tracking-tight text-white sm:text-lg">
            Faturamento dos últimos 6 meses
          </h2>
          <p className="mt-1 text-sm text-slate-500">Soma da GWStore e da Loja TH; somente pagamentos LivePix confirmados.</p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-violet-400/15 bg-violet-500/[0.08] text-violet-300">
          <BarChart3 aria-hidden="true" className="size-[17px]" />
        </span>
      </div>

      {hasRevenue ? (
        <div className="mt-5 h-[260px] w-full" aria-label="Gráfico de faturamento mensal">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 6, bottom: 0, left: 0 }} accessibilityLayer>
              <defs>
                <linearGradient id="revenueViolet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#263244" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="monthLabel"
                axisLine={{ stroke: "#263244" }}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickFormatter={(value) => compactCurrency(Number(value))}
                tickLine={false}
                width={72}
              />
              <Tooltip cursor={{ stroke: "#64748b", strokeDasharray: "4 4" }} content={<RevenueTooltip />} />
              <Area
                type="monotone"
                dataKey="grossRevenueCents"
                fill="url(#revenueViolet)"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                activeDot={{ fill: "#8b5cf6", stroke: "#ede9fe", strokeWidth: 2, r: 5 }}
                dot={{ fill: "#8b5cf6", stroke: "#ede9fe", strokeWidth: 1.5, r: 3.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-5 grid h-[260px] place-items-center rounded-xl border border-dashed border-slate-800 bg-[#080f18] px-6 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">Ainda não há faturamento confirmado</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              A série será preenchida automaticamente quando os bots registrarem pagamentos.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
