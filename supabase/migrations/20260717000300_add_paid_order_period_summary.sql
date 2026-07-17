-- Period-aware order totals for the admin Orders page.
-- Revenue is intentionally restricted to the exact order status `paid`.

begin;

set local lock_timeout = '5s';

create index if not exists orders_paid_created_at_idx
  on public.orders (created_at desc)
  include (sale_price_cents)
  where status = 'paid';

create or replace function public.get_paid_order_summary(
  p_created_from timestamptz default null,
  p_created_to timestamptz default null
)
returns table (
  paid_orders_count bigint,
  total_received_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint as paid_orders_count,
    coalesce(sum(order_row.sale_price_cents), 0)::bigint as total_received_cents
  from public.orders as order_row
  where order_row.status = 'paid'
    and (p_created_from is null or order_row.created_at >= p_created_from)
    and (p_created_to is null or order_row.created_at < p_created_to);
$$;

comment on function public.get_paid_order_summary(timestamptz, timestamptz) is
  'Counts and sums orders whose order status is exactly paid inside an optional created_at interval.';

revoke all on function public.get_paid_order_summary(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_paid_order_summary(timestamptz, timestamptz)
  to authenticated, service_role;

commit;
