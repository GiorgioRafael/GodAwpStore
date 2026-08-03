-- Discord bots master dashboard: revenue, commissions, links and RLS.
-- Every fixture is rolled back.

begin;

set local client_min_messages = warning;

do $$
begin
  if (select global_commission_bps from public.platform_settings where id = 1) <> 200 then
    raise exception 'default platform commission is not 2%%';
  end if;
end
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'b1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'bots-admin@example.invalid', '', now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"911111111111111111"}'::jsonb, now(), now()
  ),
  (
    'b1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'bots-non-admin@example.invalid', '', now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"922222222222222222"}'::jsonb, now(), now()
  );

insert into public.admin_profiles (
  auth_user_id, discord_user_id, display_name, is_active, authorization_expires_at
)
values (
  'b1000000-0000-4000-8000-000000000001',
  '911111111111111111',
  'Bots Admin',
  true,
  now() + interval '10 minutes'
);

insert into public.whitelist_entries (
  id, discord_id, label, commission_override_bps, admin_panel_url
)
values (
  'b2000000-0000-4000-8000-000000000001',
  '933333333333333333',
  'Client Company',
  null,
  'https://client.example.com/admin'
);

insert into public.games (id, name, slug, status)
values ('b3000000-0000-4000-8000-000000000001', 'Bots Game', 'bots-game', 'active');

insert into public.substores (id, game_id, name, slug, title, description, status)
values (
  'b4000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'Bots Store',
  'bots-store',
  'Bots Store',
  'Master dashboard verification fixture.',
  'active'
);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status
)
values (
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'Bots Product',
  'bots-product',
  100,
  100,
  'active'
);

insert into public.guilds (
  id, discord_guild_id, owner_discord_id, whitelist_entry_id, name, status,
  last_bot_seen_at
)
values (
  'b6000000-0000-4000-8000-000000000001',
  '944444444444444444',
  '933333333333333333',
  'b2000000-0000-4000-8000-000000000001',
  'Client Guild',
  'active',
  now()
);

insert into public.orders (
  id, guild_id, seller_whitelist_entry_id, product_id, buyer_discord_id,
  quantity, status, subtotal_price_cents, sale_price_cents, minimum_price_cents,
  commission_bps, payment_reference, payment_provider, payment_status,
  paid_at, created_at
)
values (
  'b7000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  '955555555555555555',
  1,
  'paid',
  10000,
  10000,
  100,
  200,
  'bots-dashboard-paid-current',
  'livepix',
  'paid',
  now(),
  now()
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  company record;
  current_month record;
begin
  select * into company
  from public.discord_bots_admin_companies
  where guild_id = 'b6000000-0000-4000-8000-000000000001';

  if company.company_name <> 'Client Company'
    or company.admin_panel_url <> 'https://client.example.com/admin'
    or company.effective_commission_bps <> 200
    or company.current_month_revenue_cents <> 10000
    or company.current_month_commission_cents <> 200
    or company.current_month_paid_orders_count <> 1 then
    raise exception 'company dashboard returned unexpected values: %', row_to_json(company);
  end if;

  select * into current_month
  from public.discord_bots_admin_monthly_revenue
  order by month_start desc
  limit 1;

  if current_month.gross_revenue_cents <> 10000
    or current_month.commission_cents <> 200
    or current_month.paid_orders_count <> 1 then
    raise exception 'monthly dashboard returned unexpected values: %', row_to_json(current_month);
  end if;
end
$$;

reset role;

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.discord_bots_admin_companies) then
    raise exception 'unauthorized user read company dashboard data';
  end if;

  if exists (
    select 1
    from public.discord_bots_admin_monthly_revenue
    where gross_revenue_cents <> 0 or commission_cents <> 0 or paid_orders_count <> 0
  ) then
    raise exception 'unauthorized user read monthly revenue data';
  end if;
end
$$;

reset role;
rollback;

select 'Discord bots master dashboard checks passed' as result;
