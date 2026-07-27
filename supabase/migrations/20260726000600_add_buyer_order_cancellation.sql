-- Let a Discord buyer close an unpaid Pix checkout and immediately rebuild
-- the cart. The order row is the serialization point shared with payment
-- confirmation, so a payment and a cancellation cannot both win.

begin;

set local lock_timeout = '10s';

alter table public.orders
  drop constraint if exists orders_stock_release_state,
  add constraint orders_stock_release_state check (
    (
      stock_released_at is null
      and stock_release_reason is null
    )
    or (
      stock_released_at is not null
      and stock_release_reason in ('payment_timeout', 'buyer_cancelled')
      and status = 'cancelled'
      and payment_expires_at is not null
      and (
        stock_release_reason = 'buyer_cancelled'
        or stock_released_at >= payment_expires_at
      )
    )
  ),
  drop constraint if exists orders_late_payment_state,
  add constraint orders_late_payment_state check (
    late_payment_detected_at is null
    or (
      stock_released_at is not null
      and stock_release_reason in ('payment_timeout', 'buyer_cancelled')
      and status = 'cancelled'
      and payment_status = 'paid'
      and paid_at is not null
    )
  );

comment on column public.orders.stock_release_reason is
  'Auditable payment-window closure reason: payment_timeout, buyer_cancelled or null.';

-- The existing deadline trigger is also the single guard for a provider
-- notification that arrives after either kind of cancellation.
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

  if tg_op = 'UPDATE' then
    if old.payment_status in ('cancelled', 'expired')
      and new.payment_status = 'paid'
      and old.stock_released_at is not null
      and old.stock_release_reason in ('payment_timeout', 'buyer_cancelled') then
      new.late_payment_detected_at := coalesce(
        new.late_payment_detected_at,
        clock_timestamp()
      );
    end if;
  end if;

  return new;
end
$$;

revoke all on function private.enforce_order_payment_deadline()
  from public, anon, authenticated, service_role;

create or replace function public.cancel_discord_unpaid_order(
  p_order_id uuid,
  p_discord_guild_id text,
  p_buyer_discord_id text
)
returns table (
  cancelled_order_id uuid,
  was_cancelled boolean,
  already_cancelled boolean,
  payment_confirmed boolean,
  unavailable boolean,
  can_rebuild boolean,
  stock_changed boolean,
  recovery_dm_channel_id text,
  recovery_dm_message_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_inventory_unit_ids uuid[];
  v_restored_quantity integer := 0;
  v_effective_at timestamptz := clock_timestamp();
  v_updated_count integer;
  v_can_rebuild boolean;
  v_recovery_dm_channel_id text;
  v_recovery_dm_message_id text;
begin
  if p_order_id is null
    or p_discord_guild_id is null
    or p_discord_guild_id !~ '^[0-9]{15,22}$'
    or p_buyer_discord_id is null
    or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord order cancellation input is invalid.';
  end if;

  -- A row variable cannot share a multiple-item INTO list, so the order is
  -- locked first and its guild resolved after.
  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if found then
    select guild.discord_guild_id
    into v_discord_guild_id
    from public.guilds as guild
    where guild.id = v_order.guild_id;
  end if;

  if v_order.id is null
    or v_discord_guild_id is null
    or v_discord_guild_id <> p_discord_guild_id
    or v_order.buyer_discord_id <> p_buyer_discord_id then
    return query
    select
      p_order_id,
      false,
      false,
      false,
      true,
      false,
      false,
      null::text,
      null::text;
    return;
  end if;

  if v_order.paid_at is not null
    or v_order.payment_status in ('paid', 'refunded')
    or v_order.stock_committed_at is not null
    or v_order.stock_commit_failed_at is not null then
    return query
    select
      v_order.id,
      false,
      false,
      true,
      false,
      false,
      false,
      null::text,
      null::text;
    return;
  end if;

  if v_order.status in ('cancelled', 'expired')
    or v_order.payment_status in ('cancelled', 'expired')
    or v_order.stock_released_at is not null then
    v_can_rebuild :=
      v_order.stock_released_at is not null
      and v_order.payment_status in ('cancelled', 'expired');

    if not v_can_rebuild then
      return query
      select
        v_order.id,
        false,
        true,
        false,
        false,
        false,
        false,
        null::text,
        null::text;
      return;
    end if;

    -- An explicit click after the timeout opts this buyer out of any recovery
    -- offer that may already be queued or visible in their DMs.
    update public.orders
    set stock_release_reason = 'buyer_cancelled'
    where id = v_order.id
      and stock_release_reason = 'payment_timeout'
      and paid_at is null;

    update public.lead_recovery_offers
    set
      status = 'invalidated',
      delivery_claim_token = null,
      delivery_claimed_at = null,
      resolved_at = v_effective_at,
      last_error = 'Buyer chose to rebuild the cart.'
    where source_order_id = v_order.id
      and status in ('pending', 'sending', 'sent')
    returning dm_channel_id, dm_message_id
    into v_recovery_dm_channel_id, v_recovery_dm_message_id;

    return query
    select
      v_order.id,
      false,
      true,
      false,
      false,
      v_can_rebuild,
      false,
      v_recovery_dm_channel_id,
      v_recovery_dm_message_id;
    return;
  end if;

  if v_order.payment_provider <> 'livepix'
    or v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending')
    or v_order.stock_committed_at is not null then
    return query
    select
      v_order.id,
      false,
      false,
      false,
      true,
      false,
      false,
      null::text,
      null::text;
    return;
  end if;

  -- Historical orders may still contain encrypted-unit reservations. Modern
  -- aggregate orders have no mappings and therefore restore zero stock.
  select
    coalesce(
      array_agg(locked.inventory_unit_id order by locked.inventory_unit_id),
      '{}'::uuid[]
    )
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
    cancelled_at = coalesce(cancelled_at, v_effective_at),
    stock_released_at = v_effective_at,
    stock_release_reason = 'buyer_cancelled',
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
    raise exception using
      errcode = '40001',
      message = 'Concurrent order cancellation must be retried.';
  end if;

  update public.lead_recovery_offers
  set
    status = 'invalidated',
    delivery_claim_token = null,
    delivery_claimed_at = null,
    resolved_at = v_effective_at,
    last_error = 'Buyer cancelled the source checkout.'
  where source_order_id = v_order.id
    and status in ('pending', 'sending', 'sent')
  returning dm_channel_id, dm_message_id
  into v_recovery_dm_channel_id, v_recovery_dm_message_id;

  insert into public.audit_events (action, entity_type, entity_id, metadata)
  values (
    'bot.order.buyer_cancelled',
    'order',
    v_order.id,
    jsonb_build_object(
      'buyer_discord_id', p_buyer_discord_id,
      'discord_guild_id', p_discord_guild_id,
      'quantity', v_order.quantity,
      'stock_restored', v_restored_quantity,
      'cancelled_at', v_effective_at
    )
  );

  return query
  select
    v_order.id,
    true,
    false,
    false,
    false,
    true,
    v_restored_quantity > 0,
    v_recovery_dm_channel_id,
    v_recovery_dm_message_id;
end
$$;

comment on function public.cancel_discord_unpaid_order(uuid, text, text) is
  'Atomically cancels an unpaid buyer-owned Discord checkout without consuming modern aggregate stock.';

revoke all on function public.cancel_discord_unpaid_order(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_discord_unpaid_order(uuid, text, text)
  to service_role;

-- A delivery can be in flight while the buyer cancels the source checkout.
-- Recheck the source order before recording a DM as usable. If cancellation
-- won, the sender deletes the just-created Discord message and this function
-- leaves the offer unresolved for the failure handler below.
create or replace function public.complete_lead_recovery_delivery(
  p_offer_id uuid,
  p_claim_token uuid,
  p_dm_channel_id text,
  p_dm_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_updated boolean;
begin
  if p_offer_id is null
    or p_claim_token is null
    or p_dm_channel_id is null
    or p_dm_channel_id !~ '^[0-9]{15,22}$'
    or p_dm_message_id is null
    or p_dm_message_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Recovery delivery confirmation is invalid.';
  end if;

  update public.lead_recovery_offers as offer
  set
    status = 'sent',
    delivery_claim_token = null,
    delivery_claimed_at = null,
    dm_channel_id = p_dm_channel_id,
    dm_message_id = p_dm_message_id,
    sent_at = coalesce(offer.sent_at, now()),
    last_error = null
  from public.orders as source
  where offer.id = p_offer_id
    and source.id = offer.source_order_id
    and offer.status = 'sending'
    and offer.delivery_claim_token = p_claim_token
    and offer.expires_at > now()
    and source.status = 'cancelled'
    and source.payment_provider = 'livepix'
    and source.payment_status = 'cancelled'
    and source.stock_release_reason = 'payment_timeout'
    and source.paid_at is null
    and source.late_payment_detected_at is null;

  v_updated := found;
  return v_updated;
end;
$$;

revoke all on function public.complete_lead_recovery_delivery(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_lead_recovery_delivery(uuid, uuid, text, text)
  to service_role;

-- If the source stopped being eligible while a DM was in flight, terminate the
-- offer instead of putting it back on the queue and messaging the buyer again.
create or replace function public.fail_lead_recovery_delivery(
  p_offer_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_updated boolean;
begin
  update public.lead_recovery_offers as offer
  set
    status = case
      when source.id is null
        or source.status <> 'cancelled'
        or source.payment_provider <> 'livepix'
        or source.payment_status <> 'cancelled'
        or source.stock_release_reason <> 'payment_timeout'
        or source.paid_at is not null
        or source.late_payment_detected_at is not null
        then 'invalidated'
      when offer.delivery_attempts >= 5 then 'failed'
      else 'pending'
    end,
    delivery_claim_token = null,
    delivery_claimed_at = null,
    next_delivery_attempt_at = case
      when source.id is null
        or source.status <> 'cancelled'
        or source.payment_provider <> 'livepix'
        or source.payment_status <> 'cancelled'
        or source.stock_release_reason <> 'payment_timeout'
        or source.paid_at is not null
        or source.late_payment_detected_at is not null
        then offer.next_delivery_attempt_at
      else now() + make_interval(mins => greatest(offer.delivery_attempts, 1) * 5)
    end,
    resolved_at = case
      when source.id is null
        or source.status <> 'cancelled'
        or source.payment_provider <> 'livepix'
        or source.payment_status <> 'cancelled'
        or source.stock_release_reason <> 'payment_timeout'
        or source.paid_at is not null
        or source.late_payment_detected_at is not null
        or offer.delivery_attempts >= 5
        then now()
      else null
    end,
    last_error = left(
      coalesce(nullif(btrim(p_error), ''), 'delivery_failed'),
      500
    )
  from public.orders as source
  where offer.id = p_offer_id
    and source.id = offer.source_order_id
    and offer.status = 'sending'
    and offer.delivery_claim_token = p_claim_token;

  if not found then
    update public.lead_recovery_offers as offer
    set
      status = 'invalidated',
      delivery_claim_token = null,
      delivery_claimed_at = null,
      resolved_at = now(),
      last_error = left(
        coalesce(nullif(btrim(p_error), ''), 'delivery_failed'),
        500
      )
    where offer.id = p_offer_id
      and offer.status = 'sending'
      and offer.delivery_claim_token = p_claim_token;
  end if;

  v_updated := found;
  return v_updated;
end;
$$;

revoke all on function public.fail_lead_recovery_delivery(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_lead_recovery_delivery(uuid, uuid, text)
  to service_role;

commit;
