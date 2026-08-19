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

import type { MasterOverviewMonth } from "@/lib/data/master-overview";

/**
 * Receita da 101Devs por mês, empilhando as duas fontes.
 *
 * As duas faixas são somáveis de propósito: comissão dos bots e venda do e-book
 * são dinheiro que entra na casa. O faturamento bruto das lojas fica de fora
 * porque não é receita da 101Devs — ele aparece na aba de cada loja.
 */

function RevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MasterOverviewMonth }>;
}) {
  const month = payload?.[0]?.payload;
  if (!active || !month) return null;

  return (
    <div className="min-w-56 rounded-xl border border-slate-700 bg-[#111925] p-3 text-xs shadow-2xl">
      <p className="font-semibold text-white">{month.monthLabel}</p>
      <dl className="mt-2 space-y-1.5 text-slate-400">
        <div className="flex items-center justify-between gap-5">
          <dt>Comissão dos bots</dt>
          <dd className="font-medium text-violet-300">{formatBrl(month.botsCommissionCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-5">
          <dt>E-book Sobremesas Fit</dt>
          <dd className="font-medium text-emerald-300">{formatBrl(month.ebookRevenueCents)}</dd>
        </div>
        <div className="mt-1 flex items-center justify-between gap-5 border-t border-slate-700 pt-1.5">
          <dt className="text-slate-300">Total</dt>
          <dd className="font-semibold text-white">{formatBrl(month.totalCents)}</dd>
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

export function MasterRevenueChart({ months }: { months: MasterOverviewMonth[] }) {
  const hasRevenue = months.some((month) => month.totalCents > 0);

  return (
    <section
      id="financeiro"
      aria-labelledby="historico-receita-101devs"
      className="min-w-0 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 shadow-[0_22px_70px_rgba(0,0,0,.2)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="historico-receita-101devs" className="text-base font-semibold tracking-tight text-white sm:text-lg">
            Receita da 101Devs nos últimos 6 meses
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Comissão sobre as lojas de bots mais a venda direta do e-book.
          </p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-violet-400/15 bg-violet-500/[0.08] text-violet-300">
          <BarChart3 aria-hidden="true" className="size-[17px]" />
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-violet-500" />
          Comissão dos bots
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-emerald-400" />
          E-book Sobremesas Fit
        </span>
      </div>

      {hasRevenue ? (
        <div className="mt-4 h-[260px] w-full" aria-label="Gráfico de receita mensal da 101Devs">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={months} margin={{ top: 12, right: 6, bottom: 0, left: 0 }} accessibilityLayer>
              <defs>
                <linearGradient id="masterRevenueViolet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.01} />
                </linearGradient>
                <linearGradient id="masterRevenueEmerald" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.01} />
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
                dataKey="botsCommissionCents"
                stackId="receita"
                fill="url(#masterRevenueViolet)"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="ebookRevenueCents"
                stackId="receita"
                fill="url(#masterRevenueEmerald)"
                stroke="#34d399"
                strokeWidth={2.5}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 grid h-[260px] place-items-center rounded-xl border border-dashed border-slate-800 bg-[#080f18] px-6 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">Ainda não há receita confirmada</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              A série é preenchida automaticamente quando os bots registram comissão ou o e-book
              registra uma venda aprovada.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
