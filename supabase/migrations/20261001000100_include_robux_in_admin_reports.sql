begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = '';

-- One row per sale, before filtering and pagination. Robux delivery is marked
-- by its delivery timestamp; the original Robux status deliberately stays paid.
create or replace view public.admin_order_report
with (security_invoker = true)
as
select
  o.id, o.guild_id, 'items'::text as order_kind, o.product_id,
  o.buyer_discord_id, o.quantity, o.sale_price_cents, o.status::text as status,
  o.payment_provider, o.payment_status, o.paid_at, o.stock_released_at,
  o.stock_commit_failure_reason, o.late_payment_detected_at,
  o.discord_ticket_channel_id, o.discord_ticket_delivery_completed_at,
  o.discord_ticket_delivery_completed_by_discord_user_id,
  o.delivered_at, o.created_at, o.updated_at
from public.orders as o
union all
select
  r.id, r.guild_id, 'robux'::text, null::uuid,
  r.buyer_discord_id, r.robux_quantity, r.amount_cents,
  case
    when r.payment_status::text in ('refunded', 'failed', 'cancelled', 'expired')
      then r.payment_status::text
    when r.payment_status = 'paid' and r.discord_ticket_delivery_completed_at is not null
      then 'delivered'
    else r.status
  end,
  r.payment_provider, r.payment_status, r.paid_at, null::timestamptz,
  null::text, null::timestamptz,
  r.discord_ticket_channel_id, r.discord_ticket_delivery_completed_at,
  r.discord_ticket_delivery_completed_by_discord_user_id,
  r.discord_ticket_delivery_completed_at, r.created_at, r.updated_at
from public.robux_orders as r;

revoke all on public.admin_order_report from public, anon, authenticated;
grant select on public.admin_order_report to authenticated, service_role;

create index if not exists robux_orders_admin_created_at_id_idx
  on public.robux_orders (created_at desc, id desc);

create or replace view public.admin_paid_pix_metrics
with (security_invoker = true)
as
select
  count(*)::bigint as paid_orders_count,
  coalesce(sum(sale_price_cents), 0)::bigint as gross_revenue_cents,
  coalesce(sum(sale_price_cents) filter (
    where paid_at >= (
      date_trunc('day', now() at time zone 'America/Sao_Paulo')
      at time zone 'America/Sao_Paulo'
    )
  ), 0)::bigint as gross_revenue_today_cents,
  coalesce(sum(sale_price_cents) filter (
    where paid_at >= now() - interval '7 days'
  ), 0)::bigint as gross_revenue_last_7_days_cents,
  coalesce(sum(sale_price_cents) filter (
    where paid_at >= now() - interval '30 days'
  ), 0)::bigint as gross_revenue_last_30_days_cents,
  coalesce(round(avg(sale_price_cents)), 0)::bigint as average_order_cents,
  max(paid_at) as last_paid_at
from public.admin_order_report
where payment_provider in ('livepix', 'eclipsepay')
  and payment_status = 'paid'
  and status in ('paid', 'processing', 'delivered')
  and stock_released_at is null
  and paid_at is not null;

comment on view public.admin_paid_pix_metrics is
  'Confirmed item and Robux sales from LivePix/EclipsePay; pending, refunded and invalidated sales are excluded.';
revoke all on public.admin_paid_pix_metrics from public, anon, authenticated;
grant select on public.admin_paid_pix_metrics to authenticated, service_role;

create or replace function public.get_paid_order_summary(
  p_created_from timestamptz default null,
  p_created_to timestamptz default null
)
returns table (paid_orders_count bigint, total_received_cents bigint)
language sql stable security invoker set search_path = ''
as $fn$
  select count(*)::bigint, coalesce(sum(sale_price_cents), 0)::bigint
  from public.admin_order_report
  where payment_provider in ('livepix', 'eclipsepay')
    and payment_status = 'paid'
    and status in ('paid', 'processing', 'delivered')
    and stock_released_at is null
    and paid_at is not null
    and (p_created_from is null or created_at >= p_created_from)
    and (p_created_to is null or created_at < p_created_to);
$fn$;

comment on function public.get_paid_order_summary(timestamptz, timestamptz) is
  'Confirmed item/Robux sales within an optional created_at interval, including completed deliveries.';
revoke all on function public.get_paid_order_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_paid_order_summary(timestamptz, timestamptz) to authenticated, service_role;

-- Preserve all existing period boundaries, output columns and grants.
do $patch$
declare original text; patched text; function_name text;
begin
  original := pg_get_viewdef('public.admin_dashboard_summary'::regclass, true);
  patched := replace(original, 'public.orders', 'public.admin_order_report');
  patched := replace(patched, 'orders.status', 'admin_order_report.status');
  patched := replace(patched, '::public.order_status', '::text');
  if original = patched then raise exception 'Dashboard order source was not found'; end if;
  execute 'create or replace view public.admin_dashboard_summary with (security_invoker = true) as ' || patched;

  foreach function_name in array array[
    'public.get_admin_order_metrics()', 'public.get_admin_order_daily_series()'
  ] loop
    original := pg_get_functiondef(function_name::regprocedure);
    patched := replace(original, 'public.orders', 'public.admin_order_report');
    patched := replace(patched, 'payment_provider = ''livepix''', 'payment_provider in (''livepix'',''eclipsepay'')');
    if original = patched then raise exception 'Order source was not found in %', function_name; end if;
    execute patched;
  end loop;
end $patch$;

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'robux_orders'
    ) then
    alter publication supabase_realtime add table public.robux_orders;
  end if;
end $realtime$;

notify pgrst, 'reload schema';
commit;
