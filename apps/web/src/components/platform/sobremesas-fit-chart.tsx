"use client";

import { formatBrl } from "@godawp/domain";
import { Activity } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SobremesasFitDailyPoint } from "@/lib/data/sobremesas-fit";

/**
 * Visitas e receita no mesmo gráfico, em eixos separados.
 *
 * As duas escalas são incomparáveis — centenas de visitas contra dezenas de
 * reais — mas é justamente a relação entre elas que interessa: o dia de pico de
 * tráfego que não virou venda é o que vale investigar.
 */

function DailyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: SobremesasFitDailyPoint }>;
}) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;

  return (
    <div className="min-w-56 rounded-xl border border-slate-700 bg-[#111925] p-3 text-xs shadow-2xl">
      <p className="font-semibold text-white">{day.label}</p>
      <dl className="mt-2 space-y-1.5 text-slate-400">
        <div className="flex items-center justify-between gap-5">
          <dt>Visitas</dt>
          <dd className="font-medium text-white">{day.sessions.toLocaleString("pt-BR")}</dd>
        </div>
        <div className="flex items-center justify-between gap-5">
          <dt>Vendas</dt>
          <dd className="font-medium text-white">{day.purchases.toLocaleString("pt-BR")}</dd>
        </div>
        <div className="flex items-center justify-between gap-5">
          <dt>Receita</dt>
          <dd className="font-medium text-emerald-300">{formatBrl(day.revenueCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-5">
          <dt>Conversão</dt>
          <dd className="font-medium text-white">
            {day.conversionRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
          </dd>
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

export function SobremesasFitChart({ daily }: { daily: SobremesasFitDailyPoint[] }) {
  const hasTraffic = daily.some((day) => day.sessions > 0 || day.revenueCents > 0);

  return (
    <section
      aria-labelledby="sobremesas-serie-diaria"
      className="min-w-0 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 shadow-[0_22px_70px_rgba(0,0,0,.2)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="sobremesas-serie-diaria" className="text-base font-semibold tracking-tight text-white sm:text-lg">
            Visitas e receita por dia
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            A barra é a receita do dia; a área é o tráfego que a gerou.
          </p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-violet-400/15 bg-violet-500/[0.08] text-violet-300">
          <Activity aria-hidden="true" className="size-[17px]" />
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-violet-500" />
          Visitas
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-emerald-400" />
          Receita
        </span>
      </div>

      {hasTraffic ? (
        <div className="mt-4 h-[280px] w-full" aria-label="Gráfico de visitas e receita por dia">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 12, right: 6, bottom: 0, left: 0 }} accessibilityLayer>
              <defs>
                <linearGradient id="sobremesasSessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#263244" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={{ stroke: "#263244" }}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                minTickGap={18}
              />
              <YAxis
                yAxisId="sessions"
                axisLine={false}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false}
                width={44}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="revenue"
                orientation="right"
                axisLine={false}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickFormatter={(value) => compactCurrency(Number(value))}
                tickLine={false}
                width={64}
              />
              <Tooltip cursor={{ stroke: "#64748b", strokeDasharray: "4 4" }} content={<DailyTooltip />} />
              <Area
                yAxisId="sessions"
                type="monotone"
                dataKey="sessions"
                fill="url(#sobremesasSessions)"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                dot={false}
              />
              <Bar
                yAxisId="revenue"
                dataKey="revenueCents"
                fill="#34d399"
                fillOpacity={0.75}
                radius={[3, 3, 0, 0]}
                maxBarSize={26}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 grid h-[280px] place-items-center rounded-xl border border-dashed border-slate-800 bg-[#080f18] px-6 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">Nenhuma visita registrada no período</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              O gráfico se preenche assim que o site receber tráfego com o rastreamento publicado.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
