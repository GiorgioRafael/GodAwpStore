begin;

alter table public.orders
  add column if not exists stock_released_at timestamptz,
  add column if not exists stock_release_reason text,
  add column if not exists late_payment_detected_at timestamptz;

-- Every Discord order reserves stock immediately. Keep the reservation for at
-- most two hours, measured by the database clock from the immutable order
-- creation instant. Provider checkout expiry values must not extend this
-- server-side deadline.
create or replace function private.enforce_order_payment_deadline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.payment_provider = 'livepix'
    and new.status in ('pending', 'awaiting_payment')
    and new.payment_status in ('uninitialized', 'pending')
    and new.paid_at is null
    and new.stock_released_at is null then
    new.payment_expires_at := new.created_at + interval '2 hours';
  elsif new.payment_expires_at is not null
    and new.payment_expires_at <= new.created_at
    and new.stock_released_at is null then
    -- Preserve the pre-existing expiry-after-creation invariant for historical
    -- maintenance that moves created_at on already-paid rows.
    new.payment_expires_at := new.created_at + interval '2 hours';
  end if;

  return new;
end
$$;

revoke all on function private.enforce_order_payment_deadline() from public, anon, authenticated, service_role;

drop trigger if exists orders_enforce_payment_deadline on public.orders;
create trigger orders_enforce_payment_deadline
before insert or update of
  created_at,
  payment_provider,
  payment_status,
  status,
  paid_at,
  payment_expires_at
on public.orders
for each row execute function private.enforce_order_payment_deadline();

-- Backfill a deterministic deadline for every still-unpaid historical order.
-- Rows older than two hours become immediately eligible for the retroactive
-- cancellation later in this same transaction.
update public.orders
set payment_expires_at = created_at + interval '2 hours'
where payment_provider = 'livepix'
  and status in ('pending', 'awaiting_payment')
  and payment_status in ('uninitialized', 'pending')
  and paid_at is null;

alter table public.orders
  drop constraint if exists orders_unpaid_payment_deadline_required;
alter table public.orders
  add constraint orders_unpaid_payment_deadline_required check (
    payment_provider <> 'livepix'
    or status not in ('pending', 'awaiting_payment')
    or payment_status not in ('uninitialized', 'pending')
    or paid_at is not null
    or payment_expires_at = created_at + interval '2 hours'
  );

alter table public.orders
  drop constraint if exists orders_stock_release_state;
alter table public.orders
  add constraint orders_stock_release_state check (
    (
      stock_released_at is null
      and stock_release_reason is null
    )
    or (
      stock_released_at is not null
      and stock_release_reason = 'payment_timeout'
      and status = 'cancelled'
      and payment_expires_at is not null
      and stock_released_at >= payment_expires_at
    )
  );

alter table public.orders
  drop constraint if exists orders_late_payment_state;
alter table public.orders
  add constraint orders_late_payment_state check (
    late_payment_detected_at is null
    or (
      stock_released_at is not null
      and stock_release_reason = 'payment_timeout'
      and status = 'cancelled'
      and payment_status = 'paid'
      and paid_at is not null
    )
  );

comment on column public.orders.payment_expires_at is
  'Authoritative server-side stock reservation deadline. Unpaid LivePix orders expire two hours after order creation.';
comment on column public.orders.stock_released_at is
  'Exactly-once marker set in the same transaction that returns reserved stock.';
comment on column public.orders.stock_release_reason is
  'Auditable reason for returning reserved stock. Currently payment_timeout or null.';
comment on column public.orders.late_payment_detected_at is
  'Database instant when a real provider payment was detected after timeout stock release.';

-- A late payment is money that must be reviewed/refunded, not a completed
-- sale. Keep it visible on the order without inflating normal sales metrics.
drop index if exists public.orders_paid_livepix_paid_at_idx;
create index orders_paid_livepix_paid_at_idx
  on public.orders (paid_at desc)
  include (sale_price_cents)
  where payment_provider = 'livepix'
    and payment_status = 'paid'
    and status in ('paid', 'processing', 'delivered')
    and stock_released_at is null
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
  and status in ('paid', 'processing', 'delivered')
  and stock_released_at is null
  and paid_at is not null;

comment on view public.admin_paid_pix_metrics is
  'Gross sales metrics from confirmed LivePix orders that remain eligible for fulfillment; timeout payments under review are excluded.';

revoke all on table public.admin_paid_pix_metrics from anon, authenticated;
grant select on table public.admin_paid_pix_metrics to authenticated;

drop index if exists public.orders_unpaid_payment_expiration_idx;
create index orders_unpaid_payment_expiration_idx
  on public.orders (payment_expires_at, id)
  where payment_provider = 'livepix'
    and status in ('pending', 'awaiting_payment')
    and payment_status in ('uninitialized', 'pending')
    and paid_at is null
    and stock_released_at is null;

-- Single-order primitive shared by the cron batch and late-payment
-- reconciliation. The row lock makes the status transition and stock return
-- exactly-once even when workers race one another.
create or replace function private.expire_unpaid_order(
  p_order_id uuid,
  p_effective_at timestamptz,
  p_source text
)
returns table (
  expired_order_id uuid,
  expired_product_id uuid,
  restored_quantity integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_inventory_unit_ids uuid[];
  v_restored_quantity integer;
  v_updated_count integer;
begin
  if p_order_id is null or p_effective_at is null then
    raise exception using errcode = '22023', message = 'Order and expiration instant are required.';
  end if;
  if p_source not in ('scheduled_job', 'migration_backfill', 'payment_confirmation') then
    raise exception using errcode = '22023', message = 'Expiration source is invalid.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found
    or v_order.payment_provider <> 'livepix'
    or v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending')
    or v_order.paid_at is not null
    or v_order.stock_released_at is not null
    or v_order.payment_expires_at is null
    or v_order.payment_expires_at > p_effective_at then
    return;
  end if;

  -- Legacy encrypted-unit orders keep their reservation mapping. Lock and
  -- release those units in stable UUID order. New aggregate-stock orders have
  -- no mapping and return the snapshotted order quantity directly.
  select coalesce(array_agg(locked.inventory_unit_id order by locked.inventory_unit_id), '{}'::uuid[])
  into v_inventory_unit_ids
  from (
    select reservation.inventory_unit_id
    from public.order_inventory_units as reservation
    join public.inventory_units as unit
      on unit.id = reservation.inventory_unit_id
    where reservation.order_id = v_order.id
    order by reservation.inventory_unit_id
    for update of unit
  ) as locked;

  if cardinality(v_inventory_unit_ids) > 0 then
    if cardinality(v_inventory_unit_ids) <> v_order.quantity then
      raise exception using
        errcode = '22000',
        message = 'Expired order inventory reservation count is inconsistent.';
    end if;

    update public.inventory_units
    set
      status = 'available',
      reservation_expires_at = null
    where id = any(v_inventory_unit_ids)
      and product_id = v_order.product_id
      and status = 'reserved';

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> v_order.quantity then
      raise exception using
        errcode = '22000',
        message = 'Expired order inventory reservation state is inconsistent.';
    end if;
    v_restored_quantity := v_updated_count;
  else
    if v_order.inventory_unit_id is not null then
      raise exception using
        errcode = '22000',
        message = 'Expired legacy order has no inventory reservation mapping.';
    end if;
    v_restored_quantity := v_order.quantity;
  end if;

  update public.products
  set stock_quantity = stock_quantity + v_restored_quantity
  where id = v_order.product_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Expired order product was not found.';
  end if;

  update public.orders
  set
    status = 'cancelled',
    payment_status = 'cancelled',
    cancelled_at = coalesce(cancelled_at, p_effective_at),
    stock_released_at = p_effective_at,
    stock_release_reason = 'payment_timeout',
    livepix_checkout_claim_token = null,
    livepix_checkout_claimed_at = null
  where id = v_order.id
    and status in ('pending', 'awaiting_payment')
    and payment_status in ('uninitialized', 'pending')
    and paid_at is null
    and stock_released_at is null;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception using errcode = '40001', message = 'Concurrent order expiration must be retried.';
  end if;

  insert into public.audit_events (
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'bot.order.payment_timeout',
    'order',
    v_order.id,
    jsonb_build_object(
      'reason', 'payment_not_approved_within_2_hours',
      'source', p_source,
      'product_id', v_order.product_id,
      'quantity', v_order.quantity,
      'stock_restored', v_restored_quantity,
      'deadline', v_order.payment_expires_at,
      'stock_released_at', p_effective_at
    )
  );

  return query
  select v_order.id, v_order.product_id, v_restored_quantity;
end
$$;

comment on function private.expire_unpaid_order(uuid, timestamptz, text) is
  'Atomically cancels one overdue unpaid order and returns its reserved stock exactly once.';

revoke all on function private.expire_unpaid_order(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;

create or replace function public.expire_unpaid_orders(p_batch_size integer default 250)
returns table (
  expired_order_id uuid,
  expired_product_id uuid,
  restored_quantity integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_effective_at timestamptz := clock_timestamp();
  v_candidate record;
  v_expired record;
begin
  if p_batch_size is null or p_batch_size not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Expiration batch size must be between 1 and 1000.';
  end if;

  for v_candidate in
    select order_row.id
    from public.orders as order_row
    where order_row.payment_provider = 'livepix'
      and order_row.status in ('pending', 'awaiting_payment')
      and order_row.payment_status in ('uninitialized', 'pending')
      and order_row.paid_at is null
      and order_row.stock_released_at is null
      and order_row.payment_expires_at <= v_effective_at
    order by order_row.product_id, order_row.id
    limit p_batch_size
    for update skip locked
  loop
    select *
    into v_expired
    from private.expire_unpaid_order(
      v_candidate.id,
      v_effective_at,
      'scheduled_job'
    );

    if found then
      expired_order_id := v_expired.expired_order_id;
      expired_product_id := v_expired.expired_product_id;
      restored_quantity := v_expired.restored_quantity;
      return next;
    end if;
  end loop;
end
$$;

comment on function public.expire_unpaid_orders(integer) is
  'Claims overdue unpaid orders with SKIP LOCKED and atomically restores reserved stock in bounded batches.';

revoke all on function public.expire_unpaid_orders(integer)
  from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders(integer) to service_role;

-- Checkout creation/reuse is rejected directly at the database boundary once
-- the authoritative deadline is reached, even during the sub-minute interval
-- before the cron worker claims the order.
create or replace function public.claim_livepix_checkout(
  p_order_id uuid,
  p_claim_token uuid
)
returns table (
  claimed_order_id uuid,
  claimed boolean,
  provider_reference text,
  checkout_url text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'LivePix checkout claim token is required.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;
  if v_order.payment_provider <> 'livepix'
    or v_order.payment_reference is null
    or v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending')
    or v_order.paid_at is not null
    or v_order.stock_released_at is not null
    or v_order.payment_expires_at is null
    or v_order.payment_expires_at <= clock_timestamp() then
    raise exception using errcode = '22000', message = 'Order payment window is closed.';
  end if;
  if (v_order.payment_provider_reference is null) <> (v_order.payment_checkout_url is null) then
    raise exception using errcode = '22000', message = 'LivePix checkout data is incomplete.';
  end if;
  if v_order.payment_provider_reference is not null then
    return query select
      v_order.id,
      false,
      v_order.payment_provider_reference,
      v_order.payment_checkout_url;
    return;
  end if;

  if v_order.livepix_checkout_claim_token is not null
    and v_order.livepix_checkout_claim_token <> p_claim_token
    and v_order.livepix_checkout_claimed_at > now() - interval '5 minutes' then
    return query select v_order.id, false, null::text, null::text;
    return;
  end if;

  update public.orders
  set
    livepix_checkout_claim_token = p_claim_token,
    livepix_checkout_claimed_at = now()
  where id = v_order.id
  returning * into v_order;

  return query select v_order.id, true, null::text, null::text;
end
$$;

create or replace function public.register_claimed_livepix_checkout(
  p_order_id uuid,
  p_claim_token uuid,
  p_provider_reference text,
  p_checkout_url text,
  p_expires_at timestamptz default null
)
returns table (
  registered_order_id uuid,
  provider_reference text,
  checkout_url text,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'LivePix checkout claim token is required.';
  end if;
  if p_provider_reference is null
    or btrim(p_provider_reference) = ''
    or char_length(p_provider_reference) > 255 then
    raise exception using errcode = '22023', message = 'LivePix reference is invalid.';
  end if;
  if p_checkout_url is null
    or p_checkout_url !~ '^https://'
    or char_length(p_checkout_url) > 2048 then
    raise exception using errcode = '22023', message = 'LivePix checkout URL is invalid.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;
  if v_order.payment_provider <> 'livepix'
    or v_order.payment_reference is null
    or v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending')
    or v_order.paid_at is not null
    or v_order.stock_released_at is not null
    or v_order.payment_expires_at is null
    or v_order.payment_expires_at <= clock_timestamp() then
    raise exception using errcode = '22000', message = 'Order payment window is closed.';
  end if;
  if v_order.payment_provider_reference is not null then
    if v_order.payment_provider_reference <> btrim(p_provider_reference)
      or v_order.payment_checkout_url <> p_checkout_url then
      raise exception using
        errcode = '22000',
        message = 'Order already has different LivePix checkout data.';
    end if;
    return query select
      v_order.id,
      v_order.payment_provider_reference,
      v_order.payment_checkout_url,
      false;
    return;
  end if;
  if v_order.livepix_checkout_claim_token is distinct from p_claim_token
    or v_order.livepix_checkout_claimed_at is null then
    raise exception using errcode = '42501', message = 'LivePix checkout claim is not owned by this request.';
  end if;

  update public.orders
  set
    payment_provider_reference = btrim(p_provider_reference),
    payment_checkout_url = p_checkout_url,
    -- The provider deadline is informational input only; the trigger enforces
    -- the server's exact order.created_at + two hours deadline.
    payment_expires_at = created_at + interval '2 hours',
    payment_status = 'pending',
    status = 'awaiting_payment',
    livepix_checkout_claim_token = null,
    livepix_checkout_claimed_at = null
  where id = v_order.id
  returning * into v_order;

  return query select
    v_order.id,
    v_order.payment_provider_reference,
    v_order.payment_checkout_url,
    true;
end
$$;

create or replace function public.register_livepix_checkout(
  p_order_id uuid,
  p_provider_reference text,
  p_checkout_url text,
  p_expires_at timestamptz default null
)
returns table (
  registered_order_id uuid,
  provider_reference text,
  checkout_url text,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_provider_reference is null
    or btrim(p_provider_reference) = ''
    or char_length(p_provider_reference) > 255 then
    raise exception using errcode = '22023', message = 'LivePix reference is invalid.';
  end if;
  if p_checkout_url is null
    or p_checkout_url !~ '^https://'
    or char_length(p_checkout_url) > 2048 then
    raise exception using errcode = '22023', message = 'LivePix checkout URL is invalid.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;
  if v_order.payment_provider <> 'livepix'
    or v_order.payment_reference is null
    or v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending')
    or v_order.paid_at is not null
    or v_order.stock_released_at is not null
    or v_order.payment_expires_at is null
    or v_order.payment_expires_at <= clock_timestamp() then
    raise exception using errcode = '22000', message = 'Order payment window is closed.';
  end if;
  if v_order.payment_provider_reference is not null then
    if v_order.payment_provider_reference <> btrim(p_provider_reference)
      or v_order.payment_checkout_url <> p_checkout_url then
      raise exception using
        errcode = '22000',
        message = 'Order already has different LivePix checkout data.';
    end if;
    return query
    select v_order.id, v_order.payment_provider_reference, v_order.payment_checkout_url, false;
    return;
  end if;

  update public.orders
  set
    payment_provider_reference = btrim(p_provider_reference),
    payment_checkout_url = p_checkout_url,
    payment_expires_at = created_at + interval '2 hours',
    payment_status = 'pending',
    status = 'awaiting_payment'
  where id = v_order.id
  returning * into v_order;

  return query
  select v_order.id, v_order.payment_provider_reference, v_order.payment_checkout_url, true;
end
$$;

comment on function public.claim_livepix_checkout(uuid, uuid) is
  'Claims checkout creation only while the authoritative two-hour payment window remains open.';
comment on function public.register_claimed_livepix_checkout(uuid, uuid, text, text, timestamptz) is
  'Registers claimed checkout data without clearing or extending the server-side payment deadline.';
comment on function public.register_livepix_checkout(uuid, text, text, timestamptz) is
  'Legacy registration RPC guarded by the authoritative two-hour payment deadline.';

revoke all on function public.claim_livepix_checkout(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_livepix_checkout(uuid, uuid) to service_role;
revoke all on function public.register_claimed_livepix_checkout(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_claimed_livepix_checkout(uuid, uuid, text, text, timestamptz)
  to service_role;
revoke all on function public.register_livepix_checkout(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_livepix_checkout(uuid, text, text, timestamptz)
  to service_role;

-- The payment reconciliation function below deliberately serializes on the
-- same order row. A confirmation that acquires the lock before the deadline
-- wins; at or after the deadline it is recorded as late, the order is
-- cancelled, and the stock is not reserved again.
create or replace function public.confirm_livepix_payment(
  p_provider_checkout_id text,
  p_provider_proof_id text,
  p_provider_reference text,
  p_amount_cents bigint,
  p_currency_code text,
  p_provider_created_at timestamptz,
  p_reconciliation_sha256 text
)
returns table (
  processed_order_id uuid,
  discord_guild_id text,
  buyer_discord_id text,
  product_name text,
  paid_amount_cents bigint,
  resulting_order_status public.order_status,
  first_confirmation boolean,
  existing_ticket_channel_id text,
  ticket_status public.discord_ticket_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_product_name text;
  v_inserted boolean := false;
  v_state_changed boolean := false;
  v_effective_at timestamptz;
begin
  if p_provider_checkout_id is null
    or btrim(p_provider_checkout_id) = ''
    or char_length(p_provider_checkout_id) > 255 then
    raise exception using errcode = '22023', message = 'LivePix checkout ID is invalid.';
  end if;

  if p_provider_proof_id is null
    or btrim(p_provider_proof_id) = ''
    or char_length(p_provider_proof_id) > 255 then
    raise exception using errcode = '22023', message = 'LivePix proof ID is invalid.';
  end if;

  if p_provider_reference is null
    or btrim(p_provider_reference) = ''
    or char_length(p_provider_reference) > 255 then
    raise exception using errcode = '22023', message = 'LivePix reference is invalid.';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'LivePix amount is invalid.';
  end if;

  if p_currency_code <> 'BRL' then
    raise exception using errcode = '22023', message = 'LivePix currency must be BRL.';
  end if;

  if p_provider_created_at is null then
    raise exception using errcode = '22023', message = 'LivePix createdAt is required.';
  end if;

  if p_reconciliation_sha256 is null
    or p_reconciliation_sha256 !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'LivePix reconciliation SHA-256 is invalid.';
  end if;

  insert into public.payment_webhook_events (
    provider,
    event_type,
    provider_checkout_id,
    provider_reference,
    provider_proof_id,
    amount_cents,
    currency_code,
    provider_created_at,
    reconciliation_sha256
  )
  values (
    'livepix',
    'payment.confirmed',
    btrim(p_provider_checkout_id),
    btrim(p_provider_reference),
    btrim(p_provider_proof_id),
    p_amount_cents,
    p_currency_code,
    p_provider_created_at,
    lower(p_reconciliation_sha256)
  )
  on conflict (provider, provider_checkout_id, event_type) do nothing
  returning * into v_event;

  v_inserted := found;

  if not v_inserted then
    select event.*
    into strict v_event
    from public.payment_webhook_events as event
    where event.provider = 'livepix'
      and event.provider_checkout_id = btrim(p_provider_checkout_id)
      and event.event_type = 'payment.confirmed'
    for update;

    if v_event.provider_reference <> btrim(p_provider_reference)
      or v_event.provider_proof_id <> btrim(p_provider_proof_id)
      or v_event.amount_cents <> p_amount_cents
      or v_event.currency_code <> p_currency_code
      or v_event.provider_created_at <> p_provider_created_at then
      raise exception using
        errcode = '22000',
        message = 'LivePix checkout ID was reconciled with different data.';
    end if;

    if v_event.processed_at is not null then
      select order_row.*
      into strict v_order
      from public.orders as order_row
      where order_row.id = v_event.order_id;

      select guild.discord_guild_id
      into strict v_discord_guild_id
      from public.guilds as guild
      where guild.id = v_order.guild_id;

      select product.name
      into strict v_product_name
      from public.products as product
      where product.id = v_order.product_id;

      return query
      select
        v_order.id,
        v_discord_guild_id,
        v_order.buyer_discord_id,
        v_product_name,
        v_order.sale_price_cents,
        v_order.status,
        false,
        v_order.discord_ticket_channel_id,
        v_order.discord_ticket_status;
      return;
    end if;
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.payment_provider = 'livepix'
    and order_row.payment_provider_reference = btrim(p_provider_reference)
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No registered LivePix checkout matches this reference.';
  end if;

  select guild.discord_guild_id
  into strict v_discord_guild_id
  from public.guilds as guild
  where guild.id = v_order.guild_id;

  select product.name
  into strict v_product_name
  from public.products as product
  where product.id = v_order.product_id;

  if v_order.payment_provider_checkout_id is not null
    and v_order.payment_provider_checkout_id <> btrim(p_provider_checkout_id) then
    raise exception using errcode = '22000', message = 'LivePix checkout ID does not match the order.';
  end if;

  if v_order.payment_provider_proof_id is not null
    and v_order.payment_provider_proof_id <> btrim(p_provider_proof_id) then
    raise exception using errcode = '22000', message = 'LivePix proof ID does not match the order.';
  end if;

  if v_order.sale_price_cents <> p_amount_cents or v_order.currency_code <> p_currency_code then
    raise exception using errcode = '22000', message = 'LivePix amount or currency does not match the order.';
  end if;

  v_effective_at := clock_timestamp();

  -- A previously-cancelled order must never be revived by a delayed or
  -- replayed provider notification. If the deadline has just elapsed but the
  -- cron worker has not claimed the row yet, reconcile it through the same
  -- exactly-once stock-return primitive now.
  if (
      v_order.status in ('cancelled', 'expired')
      or v_order.payment_status in ('cancelled', 'expired')
    )
    or (
      v_order.status in ('pending', 'awaiting_payment')
      and v_order.payment_status in ('uninitialized', 'pending')
      and v_order.paid_at is null
      and v_order.stock_released_at is null
      and v_order.payment_expires_at is not null
      and v_order.payment_expires_at <= v_effective_at
    ) then
    if v_order.status in ('pending', 'awaiting_payment')
      and v_order.payment_status in ('uninitialized', 'pending')
      and v_order.paid_at is null
      and v_order.stock_released_at is null
      and v_order.payment_expires_at is not null
      and v_order.payment_expires_at <= v_effective_at then
      perform private.expire_unpaid_order(
        v_order.id,
        v_effective_at,
        'payment_confirmation'
      );
    end if;

    select order_row.*
    into strict v_order
    from public.orders as order_row
    where order_row.id = v_order.id;

    update public.orders
    set
      payment_provider_checkout_id = coalesce(
        payment_provider_checkout_id,
        btrim(p_provider_checkout_id)
      ),
      payment_provider_proof_id = coalesce(
        payment_provider_proof_id,
        btrim(p_provider_proof_id)
      ),
      payment_provider_created_at = coalesce(
        payment_provider_created_at,
        p_provider_created_at
      ),
      payment_status = 'paid',
      paid_at = coalesce(paid_at, p_provider_created_at),
      late_payment_detected_at = case
        when stock_release_reason = 'payment_timeout'
          then coalesce(late_payment_detected_at, v_effective_at)
        else late_payment_detected_at
      end
    where id = v_order.id
    returning * into strict v_order;

    update public.payment_webhook_events
    set
      order_id = v_order.id,
      state_changed = true,
      processed_at = v_effective_at
    where id = v_event.id;

    insert into public.audit_events (
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      'bot.order.late_payment_confirmation',
      'order',
      v_order.id,
      jsonb_build_object(
        'reason', 'order_payment_window_closed',
        'order_status', v_order.status,
        'payment_status', v_order.payment_status,
        'deadline', v_order.payment_expires_at,
        'stock_released_at', v_order.stock_released_at,
        'late_payment_detected_at', v_order.late_payment_detected_at
      )
    );

    return query
    select
      v_order.id,
      v_discord_guild_id,
      v_order.buyer_discord_id,
      v_product_name,
      v_order.sale_price_cents,
      v_order.status,
      true,
      v_order.discord_ticket_channel_id,
      v_order.discord_ticket_status;
    return;
  end if;

  v_state_changed :=
    v_order.status <> 'refunded'
    and v_order.payment_status <> 'refunded'
    and (
      v_order.status not in ('paid', 'processing', 'delivered')
      or v_order.payment_status <> 'paid'
      or v_order.paid_at is null
    );

  update public.orders
  set
    payment_provider_checkout_id = coalesce(
      payment_provider_checkout_id,
      btrim(p_provider_checkout_id)
    ),
    payment_provider_proof_id = coalesce(
      payment_provider_proof_id,
      btrim(p_provider_proof_id)
    ),
    payment_provider_created_at = coalesce(
      payment_provider_created_at,
      p_provider_created_at
    ),
    payment_status = case
      when payment_status = 'refunded' then payment_status
      else 'paid'::public.payment_status
    end,
    status = case
      when status in ('processing', 'delivered', 'refunded') then status
      else 'paid'::public.order_status
    end,
    paid_at = coalesce(paid_at, now())
  where id = v_order.id
    and (
      payment_provider_checkout_id is null
      or payment_provider_proof_id is null
      or payment_provider_created_at is null
      or v_state_changed
    );

  select order_row.*
  into strict v_order
  from public.orders as order_row
  where order_row.payment_provider = 'livepix'
    and order_row.payment_provider_reference = btrim(p_provider_reference);

  update public.payment_webhook_events
  set
    order_id = v_order.id,
    state_changed = v_state_changed,
    processed_at = now()
  where id = v_event.id;

  return query
  select
    v_order.id,
    v_discord_guild_id,
    v_order.buyer_discord_id,
    v_product_name,
    v_order.sale_price_cents,
    v_order.status,
    true,
    v_order.discord_ticket_channel_id,
    v_order.discord_ticket_status;
end
$$;

comment on function public.confirm_livepix_payment(text, text, text, bigint, text, timestamptz, text) is
  'Idempotently reconciles a verified LivePix payment without reviving orders whose two-hour payment window has closed.';

revoke all on function public.confirm_livepix_payment(text, text, text, bigint, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.confirm_livepix_payment(text, text, text, bigint, text, timestamptz, text)
  to service_role;

create or replace function public.claim_discord_ticket(p_order_id uuid)
returns table (
  claimed_order_id uuid,
  claimed boolean,
  discord_guild_id text,
  buyer_discord_id text,
  product_name text,
  paid_amount_cents bigint,
  ticket_status public.discord_ticket_status,
  existing_channel_id text,
  order_quantity integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_product_name text;
begin
  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  select guild.discord_guild_id
  into strict v_discord_guild_id
  from public.guilds as guild
  where guild.id = v_order.guild_id;

  select product.name
  into strict v_product_name
  from public.products as product
  where product.id = v_order.product_id;

  -- Check the stock-release marker before returning even an existing ticket.
  -- This prevents a late-paid, timed-out order from opening or reclaiming a
  -- Discord fulfillment channel.
  if v_order.stock_released_at is not null then
    raise exception using errcode = '22000', message = 'Order stock was already released.';
  end if;

  if v_order.discord_ticket_status in ('open', 'closed') then
    return query select
      v_order.id, false, v_discord_guild_id, v_order.buyer_discord_id,
      v_product_name, v_order.sale_price_cents, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, v_order.quantity;
    return;
  end if;

  if v_order.status not in ('paid', 'processing', 'delivered')
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null then
    raise exception using errcode = '22000', message = 'Order is not eligible for a Discord ticket.';
  end if;

  if v_order.discord_ticket_status = 'creating'
    and v_order.discord_ticket_claimed_at > now() - interval '5 minutes' then
    return query select
      v_order.id, false, v_discord_guild_id, v_order.buyer_discord_id,
      v_product_name, v_order.sale_price_cents, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, v_order.quantity;
    return;
  end if;

  update public.orders
  set
    discord_ticket_status = 'creating',
    discord_ticket_channel_id = null,
    discord_ticket_claimed_at = now()
  where id = v_order.id
    and stock_released_at is null
  returning * into v_order;

  if not found then
    raise exception using errcode = '40001', message = 'Concurrent ticket claim must be retried.';
  end if;

  return query select
    v_order.id, true, v_discord_guild_id, v_order.buyer_discord_id,
    v_product_name, v_order.sale_price_cents, v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id, v_order.quantity;
end
$$;

comment on function public.claim_discord_ticket(uuid) is
  'Claims a paid-order ticket only while its reserved stock has not been released.';

revoke all on function public.claim_discord_ticket(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_discord_ticket(uuid) to service_role;

-- Expire every historical overdue order during deployment. The bounded loop
-- prevents one query from accumulating an unbounded result set while still
-- completing the full retroactive cleanup in this migration.
do $$
declare
  v_candidate record;
  v_effective_at timestamptz := clock_timestamp();
  v_expired_count integer;
begin
  loop
    v_expired_count := 0;

    for v_candidate in
      select order_row.id
      from public.orders as order_row
      where order_row.payment_provider = 'livepix'
        and order_row.status in ('pending', 'awaiting_payment')
        and order_row.payment_status in ('uninitialized', 'pending')
        and order_row.paid_at is null
        and order_row.stock_released_at is null
        and order_row.payment_expires_at <= v_effective_at
      order by order_row.product_id, order_row.id
      limit 1000
      for update skip locked
    loop
      perform private.expire_unpaid_order(
        v_candidate.id,
        v_effective_at,
        'migration_backfill'
      );
      v_expired_count := v_expired_count + 1;
    end loop;

    exit when v_expired_count = 0;
  end loop;
end
$$;

-- This feature depends on Supabase Cron. Fail the migration instead of
-- silently deploying without automatic expiration if pg_cron is unavailable.
do $$
declare
  v_job_id bigint;
begin
  if not exists (
    select 1
    from pg_catalog.pg_available_extensions
    where name = 'pg_cron'
  ) then
    raise exception using
      errcode = '0A000',
      message = 'pg_cron is required to expire unpaid orders automatically.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_cron'
  ) then
    execute 'create extension pg_cron';
  end if;

  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'gwstore-expire-unpaid-orders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'gwstore-expire-unpaid-orders',
    '* * * * *',
    'select public.expire_unpaid_orders(250);'
  );
end
$$;

commit;
