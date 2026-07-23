-- Administrative order analytics, timezone boundaries and RLS visibility.
-- Every fixture is rolled back.

begin;

set local client_min_messages = warning;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'analytics-admin@example.invalid', '', now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"811111111111111111"}'::jsonb, now(), now()
  ),
  (
    'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'analytics-non-admin@example.invalid', '', now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"822222222222222222"}'::jsonb, now(), now()
  );

insert into public.admin_profiles (
  auth_user_id, discord_user_id, display_name, is_active, authorization_expires_at
)
values (
  'a1000000-0000-4000-8000-000000000001',
  '811111111111111111',
  'Analytics Admin',
  true,
  now() + interval '10 minutes'
);

insert into public.whitelist_entries (id, discord_id, label)
values ('a2000000-0000-4000-8000-000000000001', '833333333333333333', 'Analytics seller');

insert into public.games (id, name, slug, status)
values ('a3000000-0000-4000-8000-000000000001', 'Analytics Game', 'analytics-game', 'active');

insert into public.substores (id, game_id, name, slug, title, description, status)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'Analytics Store',
  'analytics-store',
  'Analytics Store',
  'Administrative analytics verification fixture.',
  'active'
);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status
)
values (
  'a5000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'Analytics Product',
  'analytics-product',
  100,
  100,
  'active'
);

insert into public.guilds (
  id, discord_guild_id, owner_discord_id, whitelist_entry_id, name, status
)
values (
  'a6000000-0000-4000-8000-000000000001',
  '844444444444444444',
  '833333333333333333',
  'a2000000-0000-4000-8000-000000000001',
  'Analytics Guild',
  'active'
);

-- Six orders exercise local midnight, rolling windows and excluded revenue.
insert into public.orders (
  id, guild_id, seller_whitelist_entry_id, product_id, buyer_discord_id,
  quantity, status, subtotal_price_cents, sale_price_cents, minimum_price_cents,
  commission_bps, payment_reference, payment_provider, payment_status,
  stock_released_at, stock_release_reason, paid_at, cancelled_at, created_at
)
values
  (
    'a7000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    '855555555555555551', 1, 'paid', 1000, 1000, 100, 1000,
    'analytics-paid-today', 'livepix', 'paid', null, null,
    ((now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '1 hour') at time zone 'America/Sao_Paulo',
    null,
    ((now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '30 minutes') at time zone 'America/Sao_Paulo'
  ),
  (
    'a7000000-0000-4000-8000-000000000002',
    'a6000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    '855555555555555552', 1, 'awaiting_payment', 2000, 2000, 100, 1000,
    'analytics-pending-today', 'livepix', 'pending', null, null, null, null,
    ((now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '2 hours') at time zone 'America/Sao_Paulo'
  ),
  (
    'a7000000-0000-4000-8000-000000000003',
    'a6000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    '855555555555555553', 1, 'cancelled', 3000, 3000, 100, 1000,
    'analytics-late-today', 'livepix', 'paid',
    ((now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '3 hours') at time zone 'America/Sao_Paulo',
    'payment_timeout',
    ((now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '4 hours') at time zone 'America/Sao_Paulo',
    ((now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '3 hours') at time zone 'America/Sao_Paulo',
    ((now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '2 hours 30 minutes') at time zone 'America/Sao_Paulo'
  ),
  (
    'a7000000-0000-4000-8000-000000000004',
    'a6000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    '855555555555555554', 1, 'processing', 4000, 4000, 100, 1000,
    'analytics-paid-seven', 'livepix', 'paid', null, null,
    (((now() at time zone 'America/Sao_Paulo')::date - 6)::timestamp + interval '1 hour') at time zone 'America/Sao_Paulo',
    null,
    (((now() at time zone 'America/Sao_Paulo')::date - 6)::timestamp + interval '30 minutes') at time zone 'America/Sao_Paulo'
  ),
  (
    'a7000000-0000-4000-8000-000000000005',
    'a6000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    '855555555555555555', 1, 'paid', 5000, 5000, 100, 1000,
    'analytics-paid-thirty', 'livepix', 'paid', null, null,
    (((now() at time zone 'America/Sao_Paulo')::date - 29)::timestamp + interval '1 hour') at time zone 'America/Sao_Paulo',
    null,
    (((now() at time zone 'America/Sao_Paulo')::date - 29)::timestamp + interval '30 minutes') at time zone 'America/Sao_Paulo'
  ),
  (
    'a7000000-0000-4000-8000-000000000006',
    'a6000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001',
    '855555555555555556', 1, 'refunded', 6000, 6000, 100, 1000,
    'analytics-refunded-outside', 'livepix', 'refunded', null, null,
    (((now() at time zone 'America/Sao_Paulo')::date - 30)::timestamp + interval '1 hour') at time zone 'America/Sao_Paulo',
    null,
    (((now() at time zone 'America/Sao_Paulo')::date - 30)::timestamp + interval '30 minutes') at time zone 'America/Sao_Paulo'
  );

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  metrics record;
  today_series record;
begin
  select * into metrics from public.get_admin_order_metrics();

  if metrics.orders_today_count <> 3
    or metrics.revenue_today_cents <> 1000
    or metrics.orders_last_7_days_count <> 4
    or metrics.revenue_last_7_days_cents <> 5000
    or metrics.orders_last_30_days_count <> 5
    or metrics.revenue_last_30_days_cents <> 10000 then
    raise exception 'administrative metrics returned unexpected values: %', row_to_json(metrics);
  end if;

  select * into today_series
  from public.get_admin_order_daily_series()
  where metric_date = (now() at time zone 'America/Sao_Paulo')::date;

  if today_series.orders_count <> 3
    or today_series.paid_orders_count <> 1
    or today_series.revenue_cents <> 1000 then
    raise exception 'today series returned unexpected values: %', row_to_json(today_series);
  end if;

  if exists (
    select 1
    from public.get_admin_order_daily_series()
    where metric_date = (now() at time zone 'America/Sao_Paulo')::date - 1
  ) then
    raise exception 'sparse daily series unexpectedly materialized an inactive day';
  end if;
end
$$;

reset role;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  metrics record;
begin
  select * into metrics from public.get_admin_order_metrics();
  if metrics.orders_last_30_days_count <> 0 or metrics.revenue_last_30_days_cents <> 0 then
    raise exception 'unauthorized authenticated user bypassed order RLS';
  end if;

  if exists (select 1 from public.get_admin_order_daily_series()) then
    raise exception 'unauthorized authenticated user read the daily order series';
  end if;
end
$$;

reset role;
rollback;

select 'Administrative order analytics checks passed' as result;
