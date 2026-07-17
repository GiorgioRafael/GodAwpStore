-- Admin sales metrics derived only from LivePix payments confirmed on orders.
-- One order is counted once even if the provider retries the webhook.

begin;

set local lock_timeout = '5s';

create index if not exists orders_paid_livepix_paid_at_idx
  on public.orders (paid_at desc)
  include (sale_price_cents)
  where payment_provider = 'livepix'
    and payment_status = 'paid'
    and paid_at is not null;

create or replace view public.admin_paid_pix_metrics
with (security_invoker = true)
as
select
  count(*)::bigint as paid_orders_count,
  coalesce(sum(sale_price_cents), 0)::bigint as gross_revenue_cents,
  coalesce(
    sum(sale_price_cents) filter (
      where paid_at >= (
        date_trunc('day', now() at time zone 'America/Sao_Paulo')
        at time zone 'America/Sao_Paulo'
      )
    ),
    0
  )::bigint as gross_revenue_today_cents,
  coalesce(
    sum(sale_price_cents) filter (where paid_at >= now() - interval '7 days'),
    0
  )::bigint as gross_revenue_last_7_days_cents,
  coalesce(
    sum(sale_price_cents) filter (where paid_at >= now() - interval '30 days'),
    0
  )::bigint as gross_revenue_last_30_days_cents,
  coalesce(round(avg(sale_price_cents)), 0)::bigint as average_order_cents,
  max(paid_at) as last_paid_at
from public.orders
where payment_provider = 'livepix'
  and payment_status = 'paid'
  and paid_at is not null;

comment on view public.admin_paid_pix_metrics is
  'Gross sales metrics from confirmed, non-refunded LivePix order payments only.';

revoke all on table public.admin_paid_pix_metrics from anon, authenticated;
grant select on table public.admin_paid_pix_metrics to authenticated;

commit;
