import type { OrdersPeriodKey, OrdersStatusFilter } from "@/lib/orders-period";

export type OrdersQueryState = {
  period: OrdersPeriodKey;
  status: OrdersStatusFilter;
  page?: number;
  from?: string;
  to?: string;
};

export function buildOrdersHref(state: OrdersQueryState): string {
  const params = new URLSearchParams();

  if (state.period !== "all") params.set("period", state.period);
  if (state.period === "custom") {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
  if (state.status !== "all") params.set("status", state.status);
  if ((state.page ?? 1) > 1) params.set("page", String(state.page));

  const query = params.toString();
  return query ? `/pedidos?${query}` : "/pedidos";
}
