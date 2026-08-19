import { z } from "zod";

/**
 * Formato das respostas da API de métricas do site 40 Sobremesas Fit.
 *
 * A API é de outro projeto e evolui sozinha, então a resposta é validada antes
 * de virar tela — o painel prefere avisar que não conseguiu atualizar a mostrar
 * um número que veio de um campo renomeado.
 *
 * Os valores monetários chegam em reais (`19.9`). A conversão para centavos, que
 * é como o resto do painel trabalha com dinheiro, acontece na camada de dados.
 */

const finiteNumber = z.number().finite();
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** O bloco de indicadores que o `overview` devolve, no período e no anterior. */
const metricsSchema = z.object({
  sessions: finiteNumber,
  visitors: finiteNumber,
  newVisitors: finiteNumber,
  returningVisitors: finiteNumber,
  pageviews: finiteNumber,
  ctaClicks: finiteNumber,
  checkoutViews: finiteNumber,
  checkoutStarts: finiteNumber,
  purchases: finiteNumber,
  revenue: finiteNumber,
  netRevenue: finiteNumber,
  refunds: finiteNumber,
  refundedRevenue: finiteNumber,
  pendingPurchases: finiteNumber,
  rejectedPurchases: finiteNumber,
  delivered: finiteNumber,
  averageOrderValue: finiteNumber,
  revenuePerSession: finiteNumber,
  pagesPerSession: finiteNumber,
  averageEngagementSeconds: finiteNumber,
  conversionRate: finiteNumber,
  checkoutRate: finiteNumber,
  checkoutStartRate: finiteNumber,
  paymentConversionRate: finiteNumber,
  scroll: z.record(z.string(), finiteNumber),
});

const timeseriesPointSchema = z.object({
  bucket: z.string().min(1),
  sessions: finiteNumber,
  visitors: finiteNumber,
  pageviews: finiteNumber,
  ctaClicks: finiteNumber,
  checkoutViews: finiteNumber,
  checkoutStarts: finiteNumber,
  purchases: finiteNumber,
  revenue: finiteNumber,
  conversionRate: finiteNumber,
});

const funnelRowSchema = z.object({
  step: z.string().min(1),
  label: z.string().min(1),
  visits: finiteNumber,
  shareOfVisits: finiteNumber,
  shareOfPrevious: finiteNumber,
  dropOff: finiteNumber,
});

const breakdownRowSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  sessions: finiteNumber,
  pageviews: finiteNumber,
  entries: finiteNumber,
  ctaClicks: finiteNumber,
  checkoutViews: finiteNumber,
  checkoutStarts: finiteNumber,
  purchases: finiteNumber,
  revenue: finiteNumber,
  count: finiteNumber,
  conversionRate: finiteNumber,
  revenuePerSession: finiteNumber,
});

const orderSchema = z.object({
  paymentId: z.string().min(1),
  status: z.enum(["approved", "pending", "rejected", "refunded"]),
  amount: finiteNumber,
  currency: z.string().min(1),
  method: z.string().nullable(),
  day: z.string(),
  createdAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  delivered: z.boolean(),
  buyerMask: z.string().nullable(),
  buyerDomain: z.string().nullable(),
  source: z.string().nullable(),
  medium: z.string().nullable(),
  campaign: z.string().nullable(),
});

const eventTotalSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  count: finiteNumber,
});

export const sobremesasFitSummarySchema = z.object({
  range: z.object({ from: dayKey, to: dayKey, days: z.number().int().positive() }),
  totals: metricsSchema,
  previous: metricsSchema,
  change: z.record(z.string(), z.number().nullable()),
  timeseries: z.array(timeseriesPointSchema),
  funnel: z.array(funnelRowSchema),
  breakdowns: z.object({
  sources: z.array(breakdownRowSchema),
  pages: z.array(breakdownRowSchema),
  devices: z.array(breakdownRowSchema),
  countries: z.array(breakdownRowSchema),
  elements: z.array(breakdownRowSchema),
  }),
  recentOrders: z.array(orderSchema),
  events: z.array(eventTotalSchema),
});

export const sobremesasFitTimeseriesSchema = z.object({
  range: z.object({ from: dayKey, to: dayKey }),
  interval: z.enum(["day", "hour"]),
  points: z.array(timeseriesPointSchema),
});

export type SobremesasFitSummary = z.infer<typeof sobremesasFitSummarySchema>;
export type SobremesasFitMetrics = z.infer<typeof metricsSchema>;
export type SobremesasFitTimeseriesPoint = z.infer<typeof timeseriesPointSchema>;
export type SobremesasFitFunnelRow = z.infer<typeof funnelRowSchema>;
export type SobremesasFitBreakdownRow = z.infer<typeof breakdownRowSchema>;
export type SobremesasFitOrder = z.infer<typeof orderSchema>;
export type SobremesasFitEventTotal = z.infer<typeof eventTotalSchema>;
