-- Private 101Devs command center for Discord bot clients and revenue.

alter table public.platform_settings
  alter column global_commission_bps set default 200;

-- Preserve a value that was explicitly configured after the original seed.
update public.platform_settings
set
  global_commission_bps = 200,
  updated_at = now()
where id = 1
  and global_commission_bps = 3000;

alter table public.whitelist_entries
  add column if not exists admin_panel_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.whitelist_entries'::regclass
      and conname = 'whitelist_entries_admin_panel_url_format'
  ) then
    alter table public.whitelist_entries
      add constraint whitelist_entries_admin_panel_url_format
      check (
        admin_panel_url is null
        or (
          char_length(admin_panel_url) <= 2048
          and admin_panel_url ~ '^https://[^[:space:]]+$'
        )
      );
  end if;
end
$$;

comment on column public.whitelist_entries.admin_panel_url is
  'HTTPS address of the individual business administration panel.';

alter table public.guilds
  add column if not exists last_bot_seen_at timestamptz;

comment on column public.guilds.last_bot_seen_at is
  'Last time an authenticated Discord interaction registered this guild.';

create index if not exists guilds_status_last_bot_seen_idx
  on public.guilds (status, last_bot_seen_at desc)
  where archived_at is null;

create or replace view public.discord_bots_admin_monthly_revenue
with (security_invoker = true)
as
with boundaries as (
  select date_trunc(
    'month',
    now() at time zone 'America/Sao_Paulo'
  ) as current_month_local
),
months as (
  select generate_series(
    boundaries.current_month_local - interval '5 months',
    boundaries.current_month_local,
    interval '1 month'
  ) as month_start_local
  from boundaries
),
eligible_orders as (
  select
    orders.sale_price_cents,
    orders.commission_bps,
    orders.paid_at
  from public.orders
  where orders.payment_provider = 'livepix'
    and orders.payment_status = 'paid'
    and orders.paid_at is not null
    and orders.stock_released_at is null
)
select
  months.month_start_local::date as month_start,
  coalesce(sum(eligible_orders.sale_price_cents), 0)::bigint as gross_revenue_cents,
  coalesce(
    sum((eligible_orders.sale_price_cents * eligible_orders.commission_bps) / 10000),
    0
  )::bigint as commission_cents,
  count(eligible_orders.paid_at)::bigint as paid_orders_count
from months
left join eligible_orders
  on eligible_orders.paid_at >= months.month_start_local at time zone 'America/Sao_Paulo'
  and eligible_orders.paid_at <
    (months.month_start_local + interval '1 month') at time zone 'America/Sao_Paulo'
group by months.month_start_local
order by months.month_start_local;

create or replace view public.discord_bots_admin_companies
with (security_invoker = true)
as
with boundaries as (
  select
    date_trunc('month', now() at time zone 'America/Sao_Paulo') as current_month_local,
    date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month'
      as previous_month_local
)
select
  guild.id as guild_id,
  guild.discord_guild_id,
  guild.name as guild_name,
  guild.owner_discord_id,
  guild.status as guild_status,
  guild.joined_at,
  guild.last_bot_seen_at,
  guild.updated_at,
  entry.id as whitelist_entry_id,
  coalesce(nullif(btrim(entry.label), ''), guild.name) as company_name,
  entry.admin_panel_url,
  coalesce(entry.commission_override_bps, settings.global_commission_bps) as effective_commission_bps,
  coalesce(sales.current_month_revenue_cents, 0)::bigint as current_month_revenue_cents,
  coalesce(sales.previous_month_revenue_cents, 0)::bigint as previous_month_revenue_cents,
  coalesce(sales.current_month_commission_cents, 0)::bigint as current_month_commission_cents,
  coalesce(sales.current_month_paid_orders_count, 0)::bigint as current_month_paid_orders_count,
  sales.last_paid_at
from public.guilds as guild
left join public.whitelist_entries as entry
  on entry.id = guild.whitelist_entry_id
cross join public.platform_settings as settings
cross join boundaries
left join lateral (
  select
    coalesce(sum(orders.sale_price_cents) filter (
      where orders.paid_at >= boundaries.current_month_local at time zone 'America/Sao_Paulo'
    ), 0)::bigint as current_month_revenue_cents,
    coalesce(sum(orders.sale_price_cents) filter (
      where orders.paid_at >= boundaries.previous_month_local at time zone 'America/Sao_Paulo'
        and orders.paid_at < boundaries.current_month_local at time zone 'America/Sao_Paulo'
    ), 0)::bigint as previous_month_revenue_cents,
    coalesce(sum((orders.sale_price_cents * orders.commission_bps) / 10000) filter (
      where orders.paid_at >= boundaries.current_month_local at time zone 'America/Sao_Paulo'
    ), 0)::bigint as current_month_commission_cents,
    count(*) filter (
      where orders.paid_at >= boundaries.current_month_local at time zone 'America/Sao_Paulo'
    )::bigint as current_month_paid_orders_count,
    max(orders.paid_at) as last_paid_at
  from public.orders
  where orders.guild_id = guild.id
    and orders.payment_provider = 'livepix'
    and orders.payment_status = 'paid'
    and orders.paid_at is not null
    and orders.stock_released_at is null
) as sales on true
where settings.id = 1
  and guild.archived_at is null;

revoke all on table public.discord_bots_admin_monthly_revenue from anon, authenticated;
revoke all on table public.discord_bots_admin_companies from anon, authenticated;
grant select on table public.discord_bots_admin_monthly_revenue to authenticated;
grant select on table public.discord_bots_admin_companies to authenticated;

