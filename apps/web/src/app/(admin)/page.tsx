import type { Metadata } from "next";
import { DashboardOverview } from "@/components/admin/dashboard-overview";
import { getDashboardSummary, getPaidPixMetrics, listAuditEvents, listProductStock } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Visão geral" };

export default async function DashboardPage() {
  const [summary, paidPix, lowStock, audit] = await Promise.all([
    getDashboardSummary(), getPaidPixMetrics(), listProductStock({ lowOnly: true }), listAuditEvents(6),
  ]);
  return <DashboardOverview summary={summary} paidPix={paidPix} lowStock={lowStock} audit={audit} />;
}
