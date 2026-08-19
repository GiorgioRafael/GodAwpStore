import "server-only";

import { formatDashboardMonth } from "@/lib/discord-bots-dashboard";
import {
  sobremesasFitSummarySchema,
  sobremesasFitTimeseriesSchema,
  type SobremesasFitBreakdownRow,
  type SobremesasFitEventTotal,
  type SobremesasFitFunnelRow,
  type SobremesasFitMetrics,
  type SobremesasFitOrder,
  type SobremesasFitTimeseriesPoint,
} from "@/lib/sobremesas-fit-contract";

/**
 * Leitura das métricas do site 40 Sobremesas Fit.
 *
 * A API do outro projeto é fechada e responde a uma chave compartilhada. A
 * chamada acontece aqui, no servidor: a chave nunca entra no bundle do
 * navegador, e o acesso do administrador já foi validado antes, pela sessão
 * Google do painel mestre.
 *
 * Falha nunca derruba a página. O resultado carrega o próprio estado, e a tela
 * mostra o aviso — como já acontece com os serviços remotos de bots.
 */

const DEFAULT_SITE_URL = "https://petrakis.com.br";
const REQUEST_TIMEOUT_MS = 10_000;

/** Uma leitura por minuto basta: o painel não é um monitor de tempo real, e cada
 * chamada custa leituras no Firestore do outro projeto. */
const SUMMARY_REVALIDATE_SECONDS = 60;
/** O gráfico mensal muda devagar e é a chamada mais cara: cabe cache maior. */
const MONTHLY_REVALIDATE_SECONDS = 900;

export type SobremesasFitTotals = SobremesasFitMetrics & {
  revenueCents: number;
  netRevenueCents: number;
  refundedRevenueCents: number;
  averageOrderValueCents: number;
};

export type SobremesasFitDailyPoint = SobremesasFitTimeseriesPoint & {
  label: string;
  revenueCents: number;
};

export type SobremesasFitOrderRow = SobremesasFitOrder & {
  amountCents: number;
};

export type SobremesasFitDashboard = {
  siteUrl: string;
  range: { from: string; to: string; days: number };
  totals: SobremesasFitTotals;
  previous: SobremesasFitTotals;
  change: Record<string, number | null>;
  daily: SobremesasFitDailyPoint[];
  funnel: SobremesasFitFunnelRow[];
  breakdowns: {
    sources: SobremesasFitBreakdownRow[];
    pages: SobremesasFitBreakdownRow[];
    devices: SobremesasFitBreakdownRow[];
    countries: SobremesasFitBreakdownRow[];
    elements: SobremesasFitBreakdownRow[];
  };
  orders: SobremesasFitOrderRow[];
  events: SobremesasFitEventTotal[];
};

export type SobremesasFitMonthlyRevenue = {
  monthStart: string;
  monthLabel: string;
  revenueCents: number;
  paidOrdersCount: number;
};

export type SobremesasFitResult<T> =
  | { status: "ok"; data: T; error: null }
  | { status: "unconfigured"; data: null; error: string }
  | { status: "error"; data: null; error: string };

const UNCONFIGURED =
  "Integração com o site 40 Sobremesas Fit ainda não configurada.";
const UNAVAILABLE =
  "Não foi possível atualizar as métricas do 40 Sobremesas Fit agora.";

export function getSobremesasFitSiteUrl() {
  return process.env.SOBREMESAS_FIT_METRICS_URL?.trim() || DEFAULT_SITE_URL;
}

/** Reais para centavos. Todo dinheiro do painel é inteiro em centavos. */
function toCents(value: number) {
  return Math.round(value * 100);
}

async function readMetricsEndpoint(
  path: string,
  params: Record<string, string>,
  revalidate: number,
): Promise<{ ok: true; body: unknown } | { ok: false; result: SobremesasFitResult<never> }> {
  const key = process.env.SOBREMESAS_FIT_METRICS_KEY?.trim();
  if (!key) {
    return { ok: false, result: { status: "unconfigured", data: null, error: UNCONFIGURED } };
  }

  const url = new URL(path, getSobremesasFitSiteUrl());
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      next: { revalidate },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 503 do outro lado quer dizer API fechada ou Firebase ausente: é falta de
      // configuração lá, não falha de rede aqui, e o aviso na tela muda.
      if (response.status === 503) {
        return { ok: false, result: { status: "unconfigured", data: null, error: UNCONFIGURED } };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, result: { status: "error", data: null, error: UNAVAILABLE } };
  }
}

function toTotals(metrics: SobremesasFitMetrics): SobremesasFitTotals {
  return {
    ...metrics,
    revenueCents: toCents(metrics.revenue),
    netRevenueCents: toCents(metrics.netRevenue),
    refundedRevenueCents: toCents(metrics.refundedRevenue),
    averageOrderValueCents: toCents(metrics.averageOrderValue),
  };
}

const dayLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function dayLabel(bucket: string) {
  const parsed = new Date(`${bucket}T12:00:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? bucket : dayLabelFormatter.format(parsed);
}

/** Painel completo do produto: KPIs, série diária, funil, recortes e vendas. */
export async function getSobremesasFitDashboard(
  period = "30d",
): Promise<SobremesasFitResult<SobremesasFitDashboard>> {
  const response = await readMetricsEndpoint(
    "/api/metrics/summary",
    { period },
    SUMMARY_REVALIDATE_SECONDS,
  );
  if (!response.ok) return response.result;

  const parsed = sobremesasFitSummarySchema.safeParse(response.body);
  if (!parsed.success) {
    return { status: "error", data: null, error: UNAVAILABLE };
  }

  const summary = parsed.data;

  return {
    status: "ok",
    error: null,
    data: {
      siteUrl: getSobremesasFitSiteUrl(),
      range: summary.range,
      totals: toTotals(summary.totals),
      previous: toTotals(summary.previous),
      change: summary.change,
      daily: summary.timeseries.map((point) => ({
        ...point,
        label: dayLabel(point.bucket),
        revenueCents: toCents(point.revenue),
      })),
      funnel: summary.funnel,
      breakdowns: summary.breakdowns,
      orders: summary.recentOrders.map((order) => ({
        ...order,
        amountCents: toCents(order.amount),
      })),
      events: summary.events,
    },
  };
}

/**
 * Receita por mês, para o gráfico consolidado da visão geral.
 *
 * A API entrega um ponto por dia; o agrupamento por mês acontece aqui. As chaves
 * de dia já vêm no fuso de São Paulo, então cortar `AAAA-MM` do início basta —
 * não há conversão de fuso para errar.
 */
export async function getSobremesasFitMonthlyRevenue(
  months = 6,
): Promise<SobremesasFitResult<SobremesasFitMonthlyRevenue[]>> {
  const { from, to } = monthWindow(months);
  const response = await readMetricsEndpoint(
    "/api/metrics/timeseries",
    { from, to, interval: "day" },
    MONTHLY_REVALIDATE_SECONDS,
  );
  if (!response.ok) return response.result;

  const parsed = sobremesasFitTimeseriesSchema.safeParse(response.body);
  if (!parsed.success) {
    return { status: "error", data: null, error: UNAVAILABLE };
  }

  const buckets = new Map<string, { revenueCents: number; paidOrdersCount: number }>();
  for (const point of parsed.data.points) {
    const monthStart = `${point.bucket.slice(0, 7)}-01`;
    const bucket = buckets.get(monthStart) ?? { revenueCents: 0, paidOrdersCount: 0 };
    bucket.revenueCents += toCents(point.revenue);
    bucket.paidOrdersCount += point.purchases;
    buckets.set(monthStart, bucket);
  }

  return {
    status: "ok",
    error: null,
    data: [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([monthStart, bucket]) => ({
        monthStart,
        monthLabel: formatDashboardMonth(monthStart),
        revenueCents: bucket.revenueCents,
        paidOrdersCount: bucket.paidOrdersCount,
      })),
  };
}

/** Primeiro dia do mês N-1 meses atrás até hoje, em São Paulo. */
export function monthWindow(months: number, now = new Date()) {
  const today = saoPauloDayKey(now);
  const [year, month] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 - (months - 1), 1));

  return { from: start.toISOString().slice(0, 10), to: today };
}

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function saoPauloDayKey(date: Date) {
  return dayKeyFormatter.format(date);
}
