-- Consolidated item/Robux reports, payment eligibility, delivery and RLS.
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


-- Baselines make this check independent of other catalog seeds.
create temporary table sales_baseline as select * from public.admin_paid_pix_metrics;
create temporary table metrics_baseline as select * from public.get_admin_order_metrics();
create temporary table dashboard_baseline as select * from public.admin_dashboard_summary;
grant select on sales_baseline, metrics_baseline, dashboard_baseline to authenticated;

insert into public.robux_orders (
 id, guild_id, buyer_discord_id, discord_interaction_id, robux_quantity, amount_cents,
 status, payment_provider, payment_status, paid_at, created_at,
 discord_ticket_delivery_completed_at, discord_ticket_delivery_completed_by_discord_user_id
)
values
 ('a8000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','855555555555555551','866666666666666661',1000,4000,'paid','livepix','paid',now(),now(),null,null),
 ('a8000000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001','855555555555555552','866666666666666662',1000,4000,'paid','eclipsepay','paid',now(),now(),now(),'833333333333333333'),
 ('a8000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000001','855555555555555553','866666666666666663',1000,4000,'paid','livepix','paid',now()-interval '29 days',now()-interval '29 days',null,null),
 ('a8000000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000001','855555555555555554','866666666666666664',1000,4000,'awaiting_payment','livepix','pending',null,now(),null,null),
 ('a8000000-0000-4000-8000-000000000005','a6000000-0000-4000-8000-000000000001','855555555555555555','866666666666666665',1000,4000,'paid','eclipsepay','refunded',now(),now(),now(),'833333333333333333'),
 ('a8000000-0000-4000-8000-000000000006','a6000000-0000-4000-8000-000000000001','855555555555555556','866666666666666666',1000,4000,'awaiting_payment','livepix','failed',null,now(),null,null);

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

do $$
declare sales record; base_sales record; metrics record; base_metrics record; dashboard record; base_dashboard record;
begin
 select * into sales from public.admin_paid_pix_metrics;
 select * into base_sales from sales_baseline;
 if sales.paid_orders_count <> base_sales.paid_orders_count + 3
   or sales.gross_revenue_cents <> base_sales.gross_revenue_cents + 12000
   or sales.gross_revenue_today_cents <> base_sales.gross_revenue_today_cents + 8000 then
   raise exception 'Robux revenue was missing or included pending/refunded payments';
 end if;
 select * into metrics from public.get_admin_order_metrics();
 select * into base_metrics from metrics_baseline;
 if metrics.orders_today_count <> base_metrics.orders_today_count + 5
   or metrics.revenue_today_cents <> base_metrics.revenue_today_cents + 8000
   or metrics.revenue_last_30_days_cents <> base_metrics.revenue_last_30_days_cents + 12000 then
   raise exception 'Robux period metrics are inconsistent';
 end if;
 select * into dashboard from public.admin_dashboard_summary;
 select * into base_dashboard from dashboard_baseline;
 if dashboard.orders_count <> base_dashboard.orders_count + 6
   or dashboard.delivered_orders_count <> base_dashboard.delivered_orders_count + 1 then
   raise exception 'Robux order/delivery counts are inconsistent';
 end if;
 if (select status from public.admin_order_report where id='a8000000-0000-4000-8000-000000000002') <> 'delivered'
   or (select status from public.admin_order_report where id='a8000000-0000-4000-8000-000000000005') <> 'refunded' then
   raise exception 'Robux delivery/refund status was normalized incorrectly';
 end if;
 if (select count(*) from public.admin_order_report where order_kind='robux' and id::text like 'a8000000-%') <> 6 then
   raise exception 'Unified report lost or duplicated Robux rows';
 end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
 if exists (select 1 from public.admin_order_report)
   or (select gross_revenue_cents from public.admin_paid_pix_metrics) <> 0 then
   raise exception 'Non-admin could read the consolidated sales report';
 end if;
end $$;
reset role;
set local role anon;
do $$
begin
 begin
   perform * from public.admin_order_report;
   raise exception 'Anonymous access to sales report was allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
