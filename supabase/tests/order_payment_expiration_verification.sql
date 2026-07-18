-- Transactional verification for the two-hour payment deadline, exactly-once
-- stock restoration, late-payment handling and RPC privileges.

begin;

set transaction isolation level repeatable read;
set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label, is_active)
values (
  '80000000-0000-4000-8000-000000000001',
  '810000000000000002',
  'Expiration test seller',
  true
);

insert into public.guilds (
  id,
  discord_guild_id,
  owner_discord_id,
  whitelist_entry_id,
  name,
  status
)
values (
  '81000000-0000-4000-8000-000000000001',
  '810000000000000001',
  '810000000000000002',
  '80000000-0000-4000-8000-000000000001',
  'Expiration verification guild',
  'active'
);

insert into public.games (id, name, slug, status)
values (
  '81100000-0000-4000-8000-000000000001',
  'Expiration verification game',
  'expiration-verification-game',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '81200000-0000-4000-8000-000000000001',
  '81100000-0000-4000-8000-000000000001',
  'Expiration verification store',
  'expiration-verification-store',
  'Expiration verification store',
  'active'
);

insert into public.products (
  id,
  substore_id,
  name,
  slug,
  minimum_price_cents,
  stock_quantity,
  status,
  low_stock_threshold
)
values
  (
    '81300000-0000-4000-8000-000000000001',
    '81200000-0000-4000-8000-000000000001',
    'Aggregate expiration product',
    'aggregate-expiration-product',
    100,
    20,
    'active',
    1
  ),
  (
    '81300000-0000-4000-8000-000000000002',
    '81200000-0000-4000-8000-000000000001',
    'Legacy expiration product',
    'legacy-expiration-product',
    100,
    0,
    'active',
    1
  );

create temporary table expiration_metrics_before on commit drop as
select paid_orders_count, gross_revenue_cents
from public.admin_paid_pix_metrics;

-- The public creation RPC must reserve aggregate stock and assign its deadline
-- without relying on LivePix checkout registration.
select *
from public.create_bot_order_with_reservation(
  '820000000000000101',
  '81000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000001',
  '820000000000000001',
  3,
  300,
  1000
);

update public.orders
set created_at = clock_timestamp() - interval '3 hours'
where payment_reference = 'discord:820000000000000101';

do $$
declare
  v_order public.orders%rowtype;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:820000000000000101';

  if v_order.payment_expires_at is distinct from v_order.created_at + interval '2 hours' then
    raise exception 'order creation did not establish the exact two-hour deadline';
  end if;
end
$$;

select * from public.expire_unpaid_orders(100);

do $$
declare
  v_order public.orders%rowtype;
  v_stock bigint;
  v_audits integer;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:820000000000000101';

  select stock_quantity into strict v_stock
  from public.products
  where id = v_order.product_id;

  select count(*)::integer into v_audits
  from public.audit_events
  where action = 'bot.order.payment_timeout'
    and entity_id = v_order.id
    and metadata ->> 'reason' = 'payment_not_approved_within_2_hours'
    and metadata ->> 'stock_restored' = '3';

  if v_order.status <> 'cancelled'
    or v_order.payment_status <> 'cancelled'
    or v_order.cancelled_at is null
    or v_order.paid_at is not null
    or v_order.stock_released_at is null
    or v_order.stock_release_reason <> 'payment_timeout'
    or v_stock <> 20
    or v_audits <> 1 then
    raise exception 'expired aggregate order was not cancelled/restocked/audited atomically';
  end if;
end
$$;

-- Re-running the worker is idempotent: it cannot return the same stock or
-- duplicate the timeout audit event.
select * from public.expire_unpaid_orders(100);

do $$
declare
  v_stock bigint;
  v_audits integer;
begin
  select stock_quantity into strict v_stock
  from public.products
  where id = '81300000-0000-4000-8000-000000000001';

  select count(*)::integer into v_audits
  from public.audit_events
  where action = 'bot.order.payment_timeout'
    and entity_id = (
      select id from public.orders
      where payment_reference = 'discord:820000000000000101'
    );

  if v_stock <> 20 or v_audits <> 1 then
    raise exception 'expiration retry returned stock or audited twice';
  end if;
end
$$;

-- A confirmation observed before the boundary wins and remains paid when the
-- expiration worker runs afterwards.
select *
from public.create_bot_order_with_reservation(
  '820000000000000102',
  '81000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000001',
  '820000000000000001',
  2,
  200,
  1000
);

update public.orders
set
  created_at = clock_timestamp() - interval '119 minutes',
  payment_provider_reference = 'expiration-on-time-reference',
  payment_checkout_url = 'https://checkout.livepix.gg/expiration-on-time-reference',
  payment_status = 'pending'
where payment_reference = 'discord:820000000000000102';

select *
from public.confirm_livepix_payment(
  'expiration-on-time-payment',
  'expiration-on-time-proof',
  'expiration-on-time-reference',
  200,
  'BRL',
  clock_timestamp(),
  repeat('1', 64)
);

select * from public.expire_unpaid_orders(100);

do $$
declare
  v_order public.orders%rowtype;
  v_stock bigint;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:820000000000000102';

  select stock_quantity into strict v_stock
  from public.products
  where id = v_order.product_id;

  if v_order.status <> 'paid'
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null
    or v_stock <> 18 then
    raise exception 'on-time payment lost its race against expiration';
  end if;
end
$$;

-- A confirmation observed at/after the boundary uses the same expiration
-- primitive, returns stock once, records the event, and never resurrects the
-- order even when the provider notification is replayed.
select *
from public.create_bot_order_with_reservation(
  '820000000000000103',
  '81000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000001',
  '820000000000000001',
  4,
  400,
  1000
);

update public.orders
set
  created_at = clock_timestamp() - interval '3 hours',
  payment_provider_reference = 'expiration-late-reference',
  payment_checkout_url = 'https://checkout.livepix.gg/expiration-late-reference',
  payment_status = 'pending'
where payment_reference = 'discord:820000000000000103';

select *
from public.confirm_livepix_payment(
  'expiration-late-payment',
  'expiration-late-proof',
  'expiration-late-reference',
  400,
  'BRL',
  clock_timestamp(),
  repeat('2', 64)
);

select *
from public.confirm_livepix_payment(
  'expiration-late-payment',
  'expiration-late-proof',
  'expiration-late-reference',
  400,
  'BRL',
  (select provider_created_at from public.payment_webhook_events
   where provider_checkout_id = 'expiration-late-payment'),
  repeat('2', 64)
);

do $$
declare
  v_order public.orders%rowtype;
  v_stock bigint;
  v_timeout_audits integer;
  v_late_audits integer;
  v_processed_events integer;
  v_late_ledger_entries integer;
  v_gross_before bigint;
  v_gross_after bigint;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:820000000000000103';

  select stock_quantity into strict v_stock
  from public.products
  where id = v_order.product_id;

  select count(*)::integer into v_timeout_audits
  from public.audit_events
  where action = 'bot.order.payment_timeout'
    and entity_id = v_order.id;

  select count(*)::integer into v_late_audits
  from public.audit_events
  where action = 'bot.order.late_payment_confirmation'
    and entity_id = v_order.id;

  select count(*)::integer into v_processed_events
  from public.payment_webhook_events
  where provider_checkout_id = 'expiration-late-payment'
    and order_id = v_order.id
    and processed_at is not null
    and state_changed;

  select count(*)::integer into v_late_ledger_entries
  from public.ledger_entries
  where order_id = v_order.id;

  select gross_revenue_cents into strict v_gross_before
  from expiration_metrics_before;

  select gross_revenue_cents into strict v_gross_after
  from public.admin_paid_pix_metrics;

  if v_order.status <> 'cancelled'
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null
    or v_order.stock_released_at is null
    or v_order.stock_release_reason <> 'payment_timeout'
    or v_order.late_payment_detected_at is null
    or v_order.payment_provider_checkout_id <> 'expiration-late-payment'
    or v_order.payment_provider_proof_id <> 'expiration-late-proof'
    or v_order.payment_provider_created_at is null
    or v_stock <> 18
    or v_timeout_audits <> 1
    or v_late_audits <> 1
    or v_processed_events <> 1
    or v_late_ledger_entries <> 0
    or v_gross_after - v_gross_before <> 200 then
    raise exception 'late payment revived the order or duplicated stock/audit state';
  end if;
end
$$;

do $$
declare
  v_order_id uuid := (
    select id from public.orders
    where payment_reference = 'discord:820000000000000103'
  );
begin
  begin
    perform public.claim_discord_ticket(v_order_id);
    raise exception 'late-paid released order claimed a Discord ticket';
  exception
    when data_exception then null;
  end;
end
$$;

-- Checkout registration can neither clear nor extend the authoritative
-- deadline, including the null currently sent by the application.
select *
from public.create_bot_order_with_reservation(
  '820000000000000104',
  '81000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000001',
  '820000000000000001',
  1,
  100,
  1000
);

select *
from public.claim_livepix_checkout(
  (select id from public.orders where payment_reference = 'discord:820000000000000104'),
  '83000000-0000-4000-8000-000000000001'
);

select *
from public.register_claimed_livepix_checkout(
  (select id from public.orders where payment_reference = 'discord:820000000000000104'),
  '83000000-0000-4000-8000-000000000001',
  'expiration-registration-reference',
  'https://checkout.livepix.gg/expiration-registration-reference',
  clock_timestamp() + interval '1 day'
);

do $$
declare
  v_order public.orders%rowtype;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:820000000000000104';

  if v_order.payment_expires_at is null
    or v_order.payment_expires_at is distinct from v_order.created_at + interval '2 hours' then
    raise exception 'checkout registration cleared or extended the server deadline';
  end if;
end
$$;

update public.orders
set created_at = clock_timestamp() - interval '3 hours'
where payment_reference = 'discord:820000000000000104';

do $$
declare
  v_order_id uuid := (
    select id from public.orders
    where payment_reference = 'discord:820000000000000104'
  );
begin
  begin
    perform public.claim_livepix_checkout(
      v_order_id,
      '83000000-0000-4000-8000-000000000002'
    );
    raise exception 'expired checkout was reused by claim_livepix_checkout';
  exception
    when data_exception then null;
  end;

  begin
    perform public.register_claimed_livepix_checkout(
      v_order_id,
      '83000000-0000-4000-8000-000000000001',
      'expiration-registration-reference',
      'https://checkout.livepix.gg/expiration-registration-reference',
      null
    );
    raise exception 'expired checkout was reused by register_claimed_livepix_checkout';
  exception
    when data_exception then null;
  end;

  begin
    perform public.register_livepix_checkout(
      v_order_id,
      'expiration-registration-reference',
      'https://checkout.livepix.gg/expiration-registration-reference',
      null
    );
    raise exception 'expired checkout was reused by legacy register_livepix_checkout';
  exception
    when data_exception then null;
  end;
end
$$;

-- Historical encrypted-unit reservations are returned to available state and
-- the aggregate stock counter is incremented by the same quantity.
insert into public.inventory_batches (
  id,
  product_id,
  source,
  import_method,
  unit_count
)
values (
  '84000000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000002',
  'expiration verification',
  'manual',
  2
);

insert into public.inventory_units (
  id,
  product_id,
  batch_id,
  encrypted_payload,
  iv,
  auth_tag,
  fingerprint,
  status
)
values
  (
    '84100000-0000-4000-8000-000000000001',
    '81300000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000001',
    decode('01', 'hex'),
    decode(repeat('01', 12), 'hex'),
    decode(repeat('02', 16), 'hex'),
    decode(repeat('03', 32), 'hex'),
    'reserved'
  ),
  (
    '84100000-0000-4000-8000-000000000002',
    '81300000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000001',
    decode('04', 'hex'),
    decode(repeat('04', 12), 'hex'),
    decode(repeat('05', 16), 'hex'),
    decode(repeat('06', 32), 'hex'),
    'reserved'
  );

insert into public.orders (
  id,
  guild_id,
  seller_whitelist_entry_id,
  product_id,
  inventory_unit_id,
  buyer_discord_id,
  quantity,
  status,
  currency_code,
  subtotal_price_cents,
  sale_price_cents,
  minimum_price_cents,
  discount_bps,
  discount_amount_cents,
  commission_bps,
  payment_reference,
  payment_provider,
  payment_status,
  created_at
)
values (
  '84200000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000002',
  '84100000-0000-4000-8000-000000000001',
  '820000000000000001',
  2,
  'awaiting_payment',
  'BRL',
  200,
  200,
  100,
  0,
  0,
  1000,
  'discord:820000000000000105',
  'livepix',
  'pending',
  clock_timestamp() - interval '3 hours'
);

insert into public.order_inventory_units (order_id, inventory_unit_id, position)
values
  (
    '84200000-0000-4000-8000-000000000001',
    '84100000-0000-4000-8000-000000000001',
    1
  ),
  (
    '84200000-0000-4000-8000-000000000001',
    '84100000-0000-4000-8000-000000000002',
    2
  );

select * from public.expire_unpaid_orders(100);

do $$
declare
  v_order public.orders%rowtype;
  v_stock bigint;
  v_available_units integer;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.id = '84200000-0000-4000-8000-000000000001';

  select stock_quantity into strict v_stock
  from public.products
  where id = v_order.product_id;

  select count(*)::integer into v_available_units
  from public.inventory_units
  where id in (
    '84100000-0000-4000-8000-000000000001',
    '84100000-0000-4000-8000-000000000002'
  )
    and status = 'available'
    and reservation_expires_at is null;

  if v_order.status <> 'cancelled'
    or v_order.payment_status <> 'cancelled'
    or v_order.stock_released_at is null
    or v_order.stock_release_reason <> 'payment_timeout'
    or v_stock <> 2
    or v_available_units <> 2 then
    raise exception 'legacy encrypted inventory was not released consistently';
  end if;
end
$$;

-- Schema, partial index, cron registration, and default-deny privilege checks.
do $$
declare
  v_cron_job_exists boolean;
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_unpaid_payment_deadline_required'
  ) then
    raise exception 'payment deadline constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_index
    where indexrelid = 'public.orders_unpaid_payment_expiration_idx'::regclass
      and indpred is not null
  ) then
    raise exception 'partial expiration index is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'orders_enforce_payment_deadline'
      and not tgisinternal
  ) then
    raise exception 'payment deadline trigger is missing';
  end if;

  if has_function_privilege('anon', 'public.expire_unpaid_orders(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.expire_unpaid_orders(integer)', 'EXECUTE')
    or has_function_privilege('anon', 'private.expire_unpaid_order(uuid,timestamp with time zone,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.expire_unpaid_order(uuid,timestamp with time zone,text)', 'EXECUTE') then
    raise exception 'an untrusted API role can execute an expiration function';
  end if;

  if not has_function_privilege('service_role', 'public.expire_unpaid_orders(integer)', 'EXECUTE')
    or has_function_privilege('service_role', 'private.expire_unpaid_order(uuid,timestamp with time zone,text)', 'EXECUTE') then
    raise exception 'expiration function privileges are not default-deny/service-role-only';
  end if;

  if not exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    raise exception 'pg_cron is required but was not installed';
  end if;

  execute
    'select exists (select 1 from cron.job where jobname = $1 and active)'
    into v_cron_job_exists
    using 'gwstore-expire-unpaid-orders';

  if not v_cron_job_exists then
    raise exception 'active expiration cron job is missing';
  end if;
end
$$;

rollback;

select 'Order payment expiration verification passed' as result;
