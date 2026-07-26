-- Keep commerce inventory visible while a LivePix checkout is unpaid.
-- Stock is committed only by a verified payment webhook, under stable row
-- locks, and an unpaid checkout is cancelled after thirty minutes.

begin;

set local lock_timeout = '10s';

alter table public.orders
  add column if not exists stock_committed_at timestamptz,
  add column if not exists stock_commit_failed_at timestamptz,
  add column if not exists stock_commit_failure_reason text;

-- Orders completed before this migration already consumed aggregate stock at
-- checkout creation. Mark them committed so webhook replays cannot consume it
-- a second time.
update public.orders
set stock_committed_at = coalesce(paid_at, updated_at, created_at)
where stock_committed_at is null
  and stock_released_at is null
  and payment_status in ('paid', 'refunded')
  and status in ('paid', 'processing', 'delivered', 'refunded')
  and paid_at is not null;

alter table public.orders
  drop constraint if exists orders_stock_commit_state,
  add constraint orders_stock_commit_state check (
    stock_committed_at is null
    or (
      payment_status in ('paid', 'refunded')
      and status in ('paid', 'processing', 'delivered', 'refunded')
      and paid_at is not null
      and stock_commit_failed_at is null
      and stock_commit_failure_reason is null
    )
  ),
  drop constraint if exists orders_stock_commit_failure_state,
  add constraint orders_stock_commit_failure_state check (
    (
      stock_commit_failed_at is null
      and stock_commit_failure_reason is null
    )
    or (
      stock_commit_failed_at is not null
      and stock_commit_failure_reason = 'insufficient_stock_after_payment'
      and stock_committed_at is null
      and status = 'cancelled'
      and payment_status = 'paid'
      and paid_at is not null
    )
  );

comment on column public.orders.stock_committed_at is
  'Exactly-once marker set in the same transaction that consumes aggregate stock after a verified payment.';
comment on column public.orders.stock_commit_failed_at is
  'Database instant when a verified payment could not consume stock because another payment won the last units.';
comment on column public.orders.stock_commit_failure_reason is
  'Auditable stock commit failure. Currently insufficient_stock_after_payment or null.';

-- The database owns the payment window. Provider checkout expiry values may
-- shorten neither nor extend the fixed thirty-minute deadline.
alter table public.orders
  drop constraint if exists orders_unpaid_payment_deadline_required;

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
    new.payment_expires_at := new.created_at + interval '30 minutes';
  elsif new.payment_expires_at is not null
    and new.payment_expires_at <= new.created_at
    and new.stock_released_at is null then
    new.payment_expires_at := new.created_at + interval '30 minutes';
  end if;

  return new;
end
$$;

revoke all on function private.enforce_order_payment_deadline()
  from public, anon, authenticated, service_role;

update public.orders
set payment_expires_at = created_at + interval '30 minutes'
where payment_provider = 'livepix'
  and status in ('pending', 'awaiting_payment')
  and payment_status in ('uninitialized', 'pending')
  and paid_at is null
  and stock_released_at is null;

alter table public.orders
  add constraint orders_unpaid_payment_deadline_required check (
    payment_provider <> 'livepix'
    or status not in ('pending', 'awaiting_payment')
    or payment_status not in ('uninitialized', 'pending')
    or paid_at is not null
    or stock_released_at is not null
    or payment_expires_at = created_at + interval '30 minutes'
  );

comment on column public.orders.payment_expires_at is
  'Authoritative server-side payment deadline. Unpaid LivePix orders expire thirty minutes after creation.';
comment on column public.orders.stock_released_at is
  'Exactly-once payment-window closure marker. Aggregate commerce stock is not reserved while payment is pending.';
comment on column public.orders.stock_release_reason is
  'Auditable payment-window closure reason. Currently payment_timeout or null.';

-- First cancel historical checkouts that are already older than the new
-- deadline. The previous expiration primitive still returns the stock they
-- reserved under the old model.
do $$
declare
  v_expired_count integer;
begin
  loop
    select count(*)::integer
    into v_expired_count
    from public.expire_unpaid_orders(1000);

    exit when v_expired_count = 0;
  end loop;
end
$$;

-- Remaining historical unpaid orders are still valid, but their stock was
-- deducted by the old creation RPCs. Return that stock once without cancelling
-- the checkout. Historical encrypted-unit reservations are converted to the
-- aggregate model so a later payment follows the same commit path.
do $$
declare
  v_order record;
  v_inventory_unit_ids uuid[];
  v_restored_quantity integer;
begin
  for v_order in
    select order_row.id, order_row.product_id
    from public.orders as order_row
    where order_row.payment_provider = 'livepix'
      and order_row.status in ('pending', 'awaiting_payment')
      and order_row.payment_status in ('uninitialized', 'pending')
      and order_row.paid_at is null
      and order_row.stock_released_at is null
      and order_row.payment_expires_at > clock_timestamp()
    order by order_row.product_id, order_row.id
    for update
  loop
    perform product.id
    from public.products as product
    join public.order_items as item on item.product_id = product.id
    where item.order_id = v_order.id
    order by product.id
    for update of product;

    update public.products as product
    set stock_quantity = product.stock_quantity + totals.quantity
    from (
      select item.product_id, sum(item.quantity)::bigint as quantity
      from public.order_items as item
      where item.order_id = v_order.id
      group by item.product_id
    ) as totals
    where product.id = totals.product_id;

    select
      coalesce(array_agg(mapping.inventory_unit_id order by mapping.inventory_unit_id), '{}'::uuid[])
    into v_inventory_unit_ids
    from public.order_inventory_units as mapping
    where mapping.order_id = v_order.id;

    if cardinality(v_inventory_unit_ids) > 0 then
      update public.inventory_units
      set status = 'available', reservation_expires_at = null
      where id = any(v_inventory_unit_ids)
        and status = 'reserved';

      update public.orders
      set inventory_unit_id = null
      where id = v_order.id;

      delete from public.order_inventory_units
      where order_id = v_order.id;
    end if;

    select coalesce(sum(item.quantity), 0)::integer
    into v_restored_quantity
    from public.order_items as item
    where item.order_id = v_order.id;

    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values (
      'bot.order.pending_stock_released',
      'order',
      v_order.id,
      jsonb_build_object(
        'reason', 'migration_to_payment_time_stock_commit',
        'stock_restored', v_restored_quantity
      )
    );
  end loop;
end
$$;

-- Creation RPCs keep their public rolling-deployment signatures. Their old
-- implementations still perform all validation and locking; the wrappers
-- immediately neutralize the legacy decrement in the same transaction.
alter function public.create_bot_order_with_reservation(
  text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer
) rename to create_bot_order_with_legacy_reservation;

revoke all on function public.create_bot_order_with_legacy_reservation(
  text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer
) from public, anon, authenticated, service_role;

create function public.create_bot_order_with_reservation(
  p_interaction_id text,
  p_guild_id uuid,
  p_whitelist_entry_id uuid,
  p_product_id uuid,
  p_buyer_discord_id text,
  p_quantity integer,
  p_subtotal_price_cents bigint,
  p_sale_price_cents bigint,
  p_discount_bps integer,
  p_discount_amount_cents bigint,
  p_discount_reason text,
  p_commission_bps integer
)
returns table (
  created_order_id uuid,
  resulting_status public.order_status,
  was_created boolean,
  out_of_stock boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result record;
begin
  select *
  into strict v_result
  from public.create_bot_order_with_legacy_reservation(
    p_interaction_id,
    p_guild_id,
    p_whitelist_entry_id,
    p_product_id,
    p_buyer_discord_id,
    p_quantity,
    p_subtotal_price_cents,
    p_sale_price_cents,
    p_discount_bps,
    p_discount_amount_cents,
    p_discount_reason,
    p_commission_bps
  );

  if v_result.was_created and v_result.created_order_id is not null then
    update public.products
    set stock_quantity = stock_quantity + p_quantity
    where id = p_product_id;

    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values (
      'bot.order.stock_deferred',
      'order',
      v_result.created_order_id,
      jsonb_build_object(
        'product_id', p_product_id,
        'quantity', p_quantity,
        'commit_trigger', 'verified_livepix_payment'
      )
    );
  end if;

  return query
  select
    v_result.created_order_id::uuid,
    v_result.resulting_status::public.order_status,
    v_result.was_created::boolean,
    v_result.out_of_stock::boolean;
end
$$;

comment on function public.create_bot_order_with_reservation(
  text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer
) is
  'Idempotently validates and creates a Discord order without hiding aggregate stock before payment.';

revoke all on function public.create_bot_order_with_reservation(
  text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer
) from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(
  text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer
) to service_role;

-- Rebind the compatibility overload to the new payment-time implementation;
-- otherwise an existing SQL-function dependency could keep calling the
-- renamed legacy function by OID.
create or replace function public.create_bot_order_with_reservation(
  p_interaction_id text,
  p_guild_id uuid,
  p_whitelist_entry_id uuid,
  p_product_id uuid,
  p_buyer_discord_id text,
  p_quantity integer,
  p_sale_price_cents bigint,
  p_commission_bps integer
)
returns table (
  created_order_id uuid,
  resulting_status public.order_status,
  was_created boolean,
  out_of_stock boolean
)
language sql
security definer
set search_path = pg_catalog
as $$
  select *
  from public.create_bot_order_with_reservation(
    p_interaction_id,
    p_guild_id,
    p_whitelist_entry_id,
    p_product_id,
    p_buyer_discord_id,
    p_quantity,
    p_sale_price_cents,
    p_sale_price_cents,
    0,
    0,
    null,
    p_commission_bps
  );
$$;

revoke all on function public.create_bot_order_with_reservation(
  text, uuid, uuid, uuid, text, integer, bigint, integer
) from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(
  text, uuid, uuid, uuid, text, integer, bigint, integer
) to service_role;

alter function public.create_bot_cart_with_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) rename to create_bot_cart_with_legacy_reservation;

revoke all on function public.create_bot_cart_with_legacy_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) from public, anon, authenticated, service_role;

create function public.create_bot_cart_with_reservation(
  p_interaction_id text,
  p_guild_id uuid,
  p_whitelist_entry_id uuid,
  p_buyer_discord_id text,
  p_items jsonb,
  p_discount_bps integer,
  p_discount_reason text,
  p_commission_bps integer
)
returns table (
  checkout_order_id uuid,
  was_created boolean,
  out_of_stock boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result record;
begin
  select *
  into strict v_result
  from public.create_bot_cart_with_legacy_reservation(
    p_interaction_id,
    p_guild_id,
    p_whitelist_entry_id,
    p_buyer_discord_id,
    p_items,
    p_discount_bps,
    p_discount_reason,
    p_commission_bps
  );

  if v_result.was_created and v_result.checkout_order_id is not null then
    update public.products as product
    set stock_quantity = product.stock_quantity + totals.quantity
    from (
      select item.product_id, sum(item.quantity)::bigint as quantity
      from public.order_items as item
      where item.order_id = v_result.checkout_order_id
      group by item.product_id
    ) as totals
    where product.id = totals.product_id;

    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values (
      'bot.order.stock_deferred',
      'order',
      v_result.checkout_order_id,
      jsonb_build_object(
        'quantity', (
          select coalesce(sum(item.quantity), 0)
          from public.order_items as item
          where item.order_id = v_result.checkout_order_id
        ),
        'commit_trigger', 'verified_livepix_payment'
      )
    );
  end if;

  return query
  select
    v_result.checkout_order_id::uuid,
    v_result.was_created::boolean,
    v_result.out_of_stock::boolean;
end
$$;

comment on function public.create_bot_cart_with_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) is
  'Idempotently validates and creates a one-to-three-product Discord cart without hiding stock before payment.';

revoke all on function public.create_bot_cart_with_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.create_bot_cart_with_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) to service_role;

-- Upsells run after the base cart wrapper, so only the additional legacy
-- decrement needs to be neutralized.
alter function public.finalize_bot_upsell_offer(
  uuid, text, text, boolean, text
) rename to finalize_bot_upsell_offer_with_legacy_reservation;

revoke all on function public.finalize_bot_upsell_offer_with_legacy_reservation(
  uuid, text, text, boolean, text
) from public, anon, authenticated, service_role;

create function public.finalize_bot_upsell_offer(
  p_offer_id uuid,
  p_discord_guild_id text,
  p_buyer_discord_id text,
  p_accept boolean,
  p_decision_interaction_id text
)
returns table (
  checkout_order_id uuid,
  source_interaction_id text,
  was_created boolean,
  out_of_stock boolean,
  offer_expired boolean,
  decision_conflict boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_prior_status text;
  v_final_status text;
  v_offered_product_id uuid;
  v_result record;
begin
  select offer.status::text, offer.offered_product_id
  into v_prior_status, v_offered_product_id
  from public.upsell_offers as offer
  where offer.id = p_offer_id
  for update;

  select *
  into strict v_result
  from public.finalize_bot_upsell_offer_with_legacy_reservation(
    p_offer_id,
    p_discord_guild_id,
    p_buyer_discord_id,
    p_accept,
    p_decision_interaction_id
  );

  select offer.status::text
  into v_final_status
  from public.upsell_offers as offer
  where offer.id = p_offer_id;

  if p_accept
    and v_prior_status is distinct from 'accepted'
    and v_final_status = 'accepted'
    and v_result.checkout_order_id is not null then
    update public.products
    set stock_quantity = stock_quantity + 1
    where id = v_offered_product_id;

    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values (
      'bot.order.upsell_stock_deferred',
      'order',
      v_result.checkout_order_id,
      jsonb_build_object(
        'offer_id', p_offer_id,
        'product_id', v_offered_product_id,
        'quantity', 1,
        'commit_trigger', 'verified_livepix_payment'
      )
    );
  end if;

  return query
  select
    v_result.checkout_order_id::uuid,
    v_result.source_interaction_id::text,
    v_result.was_created::boolean,
    v_result.out_of_stock::boolean,
    v_result.offer_expired::boolean,
    v_result.decision_conflict::boolean;
end
$$;

comment on function public.finalize_bot_upsell_offer(uuid, text, text, boolean, text) is
  'Finalizes an upsell without consuming stock until the resulting order is paid.';

revoke all on function public.finalize_bot_upsell_offer(uuid, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.finalize_bot_upsell_offer(uuid, text, text, boolean, text)
  to service_role;

-- Recovery orders are also unpaid checkouts. Keep their items visible until
-- the recovered Pix is actually confirmed.
alter function public.finalize_lead_recovery_offer(
  uuid, text, boolean, text
) rename to finalize_lead_recovery_offer_with_legacy_reservation;

revoke all on function public.finalize_lead_recovery_offer_with_legacy_reservation(
  uuid, text, boolean, text
) from public, anon, authenticated, service_role;

create function public.finalize_lead_recovery_offer(
  p_offer_id uuid,
  p_buyer_discord_id text,
  p_accept boolean,
  p_decision_interaction_id text
)
returns table (
  checkout_order_id uuid,
  was_created boolean,
  declined boolean,
  out_of_stock boolean,
  offer_expired boolean,
  offer_invalidated boolean,
  decision_conflict boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_prior_status text;
  v_final_status text;
  v_result record;
begin
  select offer.status::text
  into v_prior_status
  from public.lead_recovery_offers as offer
  where offer.id = p_offer_id
  for update;

  select *
  into strict v_result
  from public.finalize_lead_recovery_offer_with_legacy_reservation(
    p_offer_id,
    p_buyer_discord_id,
    p_accept,
    p_decision_interaction_id
  );

  select offer.status::text
  into v_final_status
  from public.lead_recovery_offers as offer
  where offer.id = p_offer_id;

  if p_accept
    and v_prior_status is distinct from 'accepted'
    and v_final_status = 'accepted'
    and v_result.checkout_order_id is not null then
    update public.products as product
    set stock_quantity = product.stock_quantity + totals.quantity
    from (
      select item.product_id, sum(item.quantity)::bigint as quantity
      from public.order_items as item
      where item.order_id = v_result.checkout_order_id
      group by item.product_id
    ) as totals
    where product.id = totals.product_id;

    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values (
      'bot.order.recovery_stock_deferred',
      'order',
      v_result.checkout_order_id,
      jsonb_build_object(
        'offer_id', p_offer_id,
        'quantity', (
          select coalesce(sum(item.quantity), 0)
          from public.order_items as item
          where item.order_id = v_result.checkout_order_id
        ),
        'commit_trigger', 'verified_livepix_payment'
      )
    );
  end if;

  return query
  select
    v_result.checkout_order_id::uuid,
    v_result.was_created::boolean,
    v_result.declined::boolean,
    v_result.out_of_stock::boolean,
    v_result.offer_expired::boolean,
    v_result.offer_invalidated::boolean,
    v_result.decision_conflict::boolean;
end
$$;

comment on function public.finalize_lead_recovery_offer(uuid, text, boolean, text) is
  'Finalizes a recovered checkout without consuming stock until its replacement Pix is paid.';

revoke all on function public.finalize_lead_recovery_offer(uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.finalize_lead_recovery_offer(uuid, text, boolean, text)
  to service_role;

-- New aggregate orders have nothing to restore when their payment window
-- closes. Keep support for historical encrypted-unit mappings so maintenance
-- can still release a genuinely reserved legacy order safely.
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
  v_restored_quantity integer := 0;
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
    or v_order.stock_committed_at is not null
    or v_order.stock_released_at is not null
    or v_order.payment_expires_at is null
    or v_order.payment_expires_at > p_effective_at then
    return;
  end if;

  select
    coalesce(array_agg(locked.inventory_unit_id order by locked.inventory_unit_id), '{}'::uuid[])
  into v_inventory_unit_ids
  from (
    select mapping.inventory_unit_id
    from public.order_inventory_units as mapping
    join public.inventory_units as unit on unit.id = mapping.inventory_unit_id
    where mapping.order_id = v_order.id
    order by mapping.inventory_unit_id
    for update of unit
  ) as locked;

  if cardinality(v_inventory_unit_ids) > 0 then
    update public.inventory_units
    set status = 'available', reservation_expires_at = null
    where id = any(v_inventory_unit_ids)
      and status = 'reserved';
    get diagnostics v_restored_quantity = row_count;

    if v_restored_quantity <> cardinality(v_inventory_unit_ids) then
      raise exception using
        errcode = '22000',
        message = 'Legacy order inventory reservation state is inconsistent.';
    end if;

    update public.products
    set stock_quantity = stock_quantity + v_restored_quantity
    where id = v_order.product_id;
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
    and stock_committed_at is null
    and stock_released_at is null;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception using errcode = '40001', message = 'Concurrent order expiration must be retried.';
  end if;

  insert into public.audit_events (action, entity_type, entity_id, metadata)
  values (
    'bot.order.payment_timeout',
    'order',
    v_order.id,
    jsonb_build_object(
      'reason', 'payment_not_approved_within_30_minutes',
      'source', p_source,
      'quantity', v_order.quantity,
      'stock_restored', v_restored_quantity,
      'deadline', v_order.payment_expires_at,
      'payment_window_closed_at', p_effective_at
    )
  );

  return query select v_order.id, v_order.product_id, v_restored_quantity;
end
$$;

comment on function private.expire_unpaid_order(uuid, timestamptz, text) is
  'Atomically cancels one overdue unpaid order; modern aggregate orders restore zero stock because none was reserved.';

revoke all on function private.expire_unpaid_order(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;

-- Financial ledger rows are created only after the stock commit succeeds.
-- The payment reconciler first records the provider payment, then the stock
-- helper updates this marker and deliberately re-fires the financial trigger.
create or replace function private.finalize_paid_order_financials()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_inventory_count integer;
  v_valid_inventory_count integer;
  v_commission_cents bigint;
  v_profit_cents bigint;
begin
  if new.payment_status <> 'paid'
    or new.status not in ('paid', 'processing', 'delivered')
    or new.stock_committed_at is null then
    return new;
  end if;

  if new.seller_whitelist_entry_id is null then
    raise exception using errcode = '22000', message = 'Paid order has no authorized seller.';
  end if;

  if new.inventory_unit_id is not null then
    select
      count(*)::integer,
      count(*) filter (
        where unit.product_id = new.product_id
          and unit.status in ('reserved', 'delivered')
      )::integer
    into v_inventory_count, v_valid_inventory_count
    from public.order_inventory_units as reservation
    join public.inventory_units as unit on unit.id = reservation.inventory_unit_id
    where reservation.order_id = new.id;

    if v_inventory_count <> new.quantity
      or v_valid_inventory_count <> new.quantity
      or not exists (
        select 1
        from public.order_inventory_units as first_reservation
        where first_reservation.order_id = new.id
          and first_reservation.inventory_unit_id = new.inventory_unit_id
      ) then
      raise exception using errcode = '22000', message = 'Paid order inventory reservations are invalid.';
    end if;
  elsif exists (
    select 1
    from public.order_inventory_units as unexpected_reservation
    where unexpected_reservation.order_id = new.id
  ) then
    raise exception using errcode = '22000', message = 'Aggregate-stock order has unexpected unit reservations.';
  end if;

  v_commission_cents := (new.sale_price_cents * new.commission_bps) / 10000;
  v_profit_cents := new.sale_price_cents - v_commission_cents;

  if v_profit_cents > 0 then
    insert into public.ledger_entries (
      whitelist_entry_id,
      guild_id,
      order_id,
      kind,
      status,
      amount_cents,
      currency_code,
      description
    )
    values (
      new.seller_whitelist_entry_id,
      new.guild_id,
      new.id,
      'sale_profit',
      'pending',
      v_profit_cents,
      new.currency_code,
      'Lucro liquido da venda GWStore'
    )
    on conflict do nothing;
  end if;

  if v_commission_cents > 0 then
    insert into public.ledger_entries (
      whitelist_entry_id,
      guild_id,
      order_id,
      kind,
      status,
      amount_cents,
      currency_code,
      description
    )
    values (
      new.seller_whitelist_entry_id,
      new.guild_id,
      new.id,
      'commission',
      'pending',
      v_commission_cents,
      new.currency_code,
      'Comissao da plataforma GWStore'
    )
    on conflict do nothing;
  end if;

  return new;
end
$$;

revoke all on function private.finalize_paid_order_financials()
  from public, anon, authenticated, service_role;

create or replace function private.commit_paid_order_stock(
  p_order_id uuid,
  p_effective_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_order_id is null or p_effective_at is null then
    raise exception using errcode = '22023', message = 'Paid order and stock commit instant are required.';
  end if;

  select order_row.*
  into strict v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if v_order.stock_committed_at is not null then
    return true;
  end if;

  if v_order.stock_commit_failed_at is not null
    or v_order.payment_status <> 'paid'
    or v_order.status not in ('paid', 'processing', 'delivered')
    or v_order.paid_at is null then
    return false;
  end if;

  perform product.id
  from public.products as product
  join (
    select item.product_id
    from public.order_items as item
    where item.order_id = v_order.id
    group by item.product_id
  ) as order_products on order_products.product_id = product.id
  order by product.id
  for update of product;

  if exists (
    select 1
    from (
      select item.product_id, sum(item.quantity)::bigint as quantity
      from public.order_items as item
      where item.order_id = v_order.id
      group by item.product_id
    ) as required
    left join public.products as product on product.id = required.product_id
    where product.id is null
      or product.stock_quantity < required.quantity
  ) then
    update public.orders
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, p_effective_at),
      stock_commit_failed_at = p_effective_at,
      stock_commit_failure_reason = 'insufficient_stock_after_payment'
    where id = v_order.id;

    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values (
      'bot.order.stock_commit_failed',
      'order',
      v_order.id,
      jsonb_build_object(
        'reason', 'insufficient_stock_after_payment',
        'paid_amount_cents', v_order.sale_price_cents,
        'requires_manual_review', true
      )
    );

    return false;
  end if;

  update public.products as product
  set stock_quantity = product.stock_quantity - required.quantity
  from (
    select item.product_id, sum(item.quantity)::bigint as quantity
    from public.order_items as item
    where item.order_id = v_order.id
    group by item.product_id
  ) as required
  where product.id = required.product_id;

  -- Including status and payment_status in the SET list re-fires the existing
  -- financial trigger after stock_committed_at becomes visible to it.
  update public.orders
  set
    stock_committed_at = p_effective_at,
    status = status,
    payment_status = payment_status
  where id = v_order.id
    and stock_committed_at is null
    and stock_commit_failed_at is null;

  if not found then
    raise exception using errcode = '40001', message = 'Concurrent paid stock commit must be retried.';
  end if;

  insert into public.audit_events (action, entity_type, entity_id, metadata)
  values (
    'bot.order.stock_committed',
    'order',
    v_order.id,
    jsonb_build_object(
      'quantity', (
        select coalesce(sum(item.quantity), 0)
        from public.order_items as item
        where item.order_id = v_order.id
      ),
      'trigger', 'verified_livepix_payment',
      'committed_at', p_effective_at
    )
  );

  return true;
end
$$;

comment on function private.commit_paid_order_stock(uuid, timestamptz) is
  'Consumes every normalized order item exactly once after verified payment; the last-stock winner is serialized by product locks.';

revoke all on function private.commit_paid_order_stock(uuid, timestamptz)
  from public, anon, authenticated, service_role;

alter function public.confirm_livepix_payment(
  text, text, text, bigint, text, timestamptz, text
) rename to confirm_livepix_payment_without_stock_commit;

revoke all on function public.confirm_livepix_payment_without_stock_commit(
  text, text, text, bigint, text, timestamptz, text
) from public, anon, authenticated, service_role;

create function public.confirm_livepix_payment(
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
  v_result record;
  v_order public.orders%rowtype;
begin
  select *
  into strict v_result
  from public.confirm_livepix_payment_without_stock_commit(
    p_provider_checkout_id,
    p_provider_proof_id,
    p_provider_reference,
    p_amount_cents,
    p_currency_code,
    p_provider_created_at,
    p_reconciliation_sha256
  );

  if v_result.resulting_order_status in ('paid', 'processing', 'delivered') then
    perform private.commit_paid_order_stock(
      v_result.processed_order_id,
      clock_timestamp()
    );
  end if;

  select order_row.*
  into strict v_order
  from public.orders as order_row
  where order_row.id = v_result.processed_order_id;

  return query
  select
    v_result.processed_order_id::uuid,
    v_result.discord_guild_id::text,
    v_result.buyer_discord_id::text,
    v_result.product_name::text,
    v_result.paid_amount_cents::bigint,
    v_order.status,
    v_result.first_confirmation::boolean,
    v_result.existing_ticket_channel_id::text,
    v_result.ticket_status::public.discord_ticket_status;
end
$$;

comment on function public.confirm_livepix_payment(text, text, text, bigint, text, timestamptz, text) is
  'Idempotently reconciles LivePix and commits stock only after verified payment within the thirty-minute window.';

revoke all on function public.confirm_livepix_payment(
  text, text, text, bigint, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.confirm_livepix_payment(
  text, text, text, bigint, text, timestamptz, text
) to service_role;

drop index if exists public.orders_unpaid_payment_expiration_idx;
create index orders_unpaid_payment_expiration_idx
  on public.orders (payment_expires_at, id)
  where payment_provider = 'livepix'
    and status in ('pending', 'awaiting_payment')
    and payment_status in ('uninitialized', 'pending')
    and paid_at is null
    and stock_released_at is null;

create index if not exists orders_stock_commit_review_idx
  on public.orders (stock_commit_failed_at desc, id)
  where stock_commit_failed_at is not null
    and stock_commit_failure_reason = 'insufficient_stock_after_payment';

-- Pending checkouts are no longer inventory reservations. Paid/processing
-- orders and giveaways remain included when reconstructing historical totals.
create or replace view public.product_stock_summary
with (security_invoker = true)
as
select
  product.id as product_id,
  product.name as product_name,
  product.substore_id,
  product.stock_quantity::bigint as available_count,
  (
    coalesce(order_totals.reserved_count, 0)
    + coalesce(giveaway_totals.reserved_count, 0)
  )::bigint as reserved_count,
  (
    product.stock_quantity
    + coalesce(order_totals.reserved_count, 0)
    + coalesce(giveaway_totals.reserved_count, 0)
    + coalesce(order_totals.delivered_count, 0)
    + coalesce(giveaway_totals.delivered_count, 0)
  )::bigint as total_count,
  product.low_stock_threshold,
  (product.stock_quantity <= product.low_stock_threshold) as is_low_stock,
  (
    coalesce(order_totals.delivered_count, 0)
    + coalesce(giveaway_totals.delivered_count, 0)
  )::bigint as delivered_count,
  0::bigint as quarantined_count,
  0::bigint as revoked_count,
  product.status as product_status
from public.products as product
left join lateral (
  select
    coalesce(
      sum(item.quantity) filter (
        where order_row.status in ('paid', 'processing')
          and order_row.stock_committed_at is not null
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(item.quantity) filter (
        where order_row.status = 'delivered'
          and order_row.stock_committed_at is not null
      ),
      0
    )::bigint as delivered_count
  from public.order_items as item
  join public.orders as order_row on order_row.id = item.order_id
  where item.product_id = product.id
) as order_totals on true
left join lateral (
  select
    coalesce(
      sum(prize.quantity) filter (
        where giveaway.status in ('scheduled', 'active', 'drawing')
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(prize.quantity) filter (where giveaway.status = 'completed'),
      0
    )::bigint as delivered_count
  from public.giveaway_prizes as prize
  join public.giveaways as giveaway on giveaway.id = prize.giveaway_id
  where prize.product_id = product.id
) as giveaway_totals on true;

comment on view public.product_stock_summary is
  'Available aggregate stock plus committed commerce and giveaway inventory; unpaid checkouts never reduce available_count.';

commit;
