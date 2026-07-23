begin;

set local lock_timeout = '5s';

create index if not exists orders_admin_created_at_id_idx
  on public.orders (created_at desc, id desc);

create index if not exists orders_admin_status_created_at_id_idx
  on public.orders (status, created_at desc, id desc);

create index if not exists orders_admin_awaiting_payment_created_idx
  on public.orders (created_at desc, id desc)
  where status in ('pending', 'awaiting_payment')
    and payment_status in ('uninitialized', 'pending')
    and paid_at is null;

create or replace function public.get_admin_order_metrics()
returns table (
  orders_today_count bigint,
  revenue_today_cents bigint,
  orders_last_7_days_count bigint,
  revenue_last_7_days_cents bigint,
  orders_last_30_days_count bigint,
  revenue_last_30_days_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with local_date as (
    select (now() at time zone 'America/Sao_Paulo')::date as today
  ),
  boundaries as (
    select
      (today::timestamp at time zone 'America/Sao_Paulo') as today_start,
      ((today + 1)::timestamp at time zone 'America/Sao_Paulo') as tomorrow_start,
      ((today - 6)::timestamp at time zone 'America/Sao_Paulo') as last_7_days_start,
      ((today - 29)::timestamp at time zone 'America/Sao_Paulo') as last_30_days_start
    from local_date
  ),
  order_totals as (
    select
      count(*) filter (
        where order_row.created_at >= boundary.today_start
          and order_row.created_at < boundary.tomorrow_start
      )::bigint as today_count,
      count(*) filter (
        where order_row.created_at >= boundary.last_7_days_start
          and order_row.created_at < boundary.tomorrow_start
      )::bigint as last_7_days_count,
      count(*) filter (
        where order_row.created_at >= boundary.last_30_days_start
          and order_row.created_at < boundary.tomorrow_start
      )::bigint as last_30_days_count
    from public.orders as order_row
    cross join boundaries as boundary
  ),
  revenue_totals as (
    select
      coalesce(sum(order_row.sale_price_cents) filter (
        where order_row.paid_at >= boundary.today_start
          and order_row.paid_at < boundary.tomorrow_start
      ), 0)::bigint as today_cents,
      coalesce(sum(order_row.sale_price_cents) filter (
        where order_row.paid_at >= boundary.last_7_days_start
          and order_row.paid_at < boundary.tomorrow_start
      ), 0)::bigint as last_7_days_cents,
      coalesce(sum(order_row.sale_price_cents) filter (
        where order_row.paid_at >= boundary.last_30_days_start
          and order_row.paid_at < boundary.tomorrow_start
      ), 0)::bigint as last_30_days_cents
    from public.orders as order_row
    cross join boundaries as boundary
    where order_row.payment_provider = 'livepix'
      and order_row.payment_status = 'paid'
      and order_row.status in ('paid', 'processing', 'delivered')
      and order_row.stock_released_at is null
      and order_row.paid_at is not null
  )
  select
    order_totals.today_count,
    revenue_totals.today_cents,
    order_totals.last_7_days_count,
    revenue_totals.last_7_days_cents,
    order_totals.last_30_days_count,
    revenue_totals.last_30_days_cents
  from order_totals
  cross join revenue_totals;
$$;

comment on function public.get_admin_order_metrics() is
  'Returns rolling order counts by created_at and eligible LivePix revenue by paid_at using America/Sao_Paulo calendar boundaries.';

create or replace function public.get_admin_order_daily_series()
returns table (
  metric_date date,
  orders_count bigint,
  paid_orders_count bigint,
  revenue_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with orders_by_day as (
    select
      (order_row.created_at at time zone 'America/Sao_Paulo')::date as metric_date,
      count(*)::bigint as orders_count
    from public.orders as order_row
    group by 1
  ),
  revenue_by_day as (
    select
      (order_row.paid_at at time zone 'America/Sao_Paulo')::date as metric_date,
      count(*)::bigint as paid_orders_count,
      coalesce(sum(order_row.sale_price_cents), 0)::bigint as revenue_cents
    from public.orders as order_row
    where order_row.payment_provider = 'livepix'
      and order_row.payment_status = 'paid'
      and order_row.status in ('paid', 'processing', 'delivered')
      and order_row.stock_released_at is null
      and order_row.paid_at is not null
    group by 1
  ),
  active_dates as (
    select metric_date from orders_by_day
    union
    select metric_date from revenue_by_day
  )
  select
    active_date.metric_date,
    coalesce(order_day.orders_count, 0)::bigint,
    coalesce(revenue_day.paid_orders_count, 0)::bigint,
    coalesce(revenue_day.revenue_cents, 0)::bigint
  from active_dates as active_date
  left join orders_by_day as order_day using (metric_date)
  left join revenue_by_day as revenue_day using (metric_date)
  order by active_date.metric_date;
$$;

comment on function public.get_admin_order_daily_series() is
  'Returns sparse daily order and eligible LivePix revenue aggregates in the America/Sao_Paulo calendar.';

revoke all on function public.get_admin_order_metrics() from public, anon;
revoke all on function public.get_admin_order_daily_series() from public, anon;
grant execute on function public.get_admin_order_metrics() to authenticated, service_role;
grant execute on function public.get_admin_order_daily_series() to authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end
$$;

commit;
