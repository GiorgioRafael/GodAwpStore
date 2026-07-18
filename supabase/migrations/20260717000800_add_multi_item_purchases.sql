begin;

create table if not exists public.order_items (
  order_id uuid not null references public.orders (id) on delete restrict,
  position smallint not null,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity integer not null,
  unit_price_cents bigint not null,
  subtotal_price_cents bigint not null,
  sale_price_cents bigint not null,
  discount_amount_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (order_id, position),
  constraint order_items_product_unique unique (order_id, product_id),
  constraint order_items_position_range check (position between 1 and 3),
  constraint order_items_quantity_range check (quantity between 1 and 10000),
  constraint order_items_price_consistency check (
    unit_price_cents > 0
    and subtotal_price_cents = unit_price_cents * quantity
    and sale_price_cents > 0
    and sale_price_cents <= subtotal_price_cents
    and discount_amount_cents = subtotal_price_cents - sale_price_cents
  )
);

comment on table public.order_items is
  'Server-priced product lines belonging to one Discord order and one LivePix checkout.';

insert into public.order_items (
  order_id,
  position,
  product_id,
  quantity,
  unit_price_cents,
  subtotal_price_cents,
  sale_price_cents,
  discount_amount_cents,
  created_at
)
select
  order_row.id,
  1,
  order_row.product_id,
  order_row.quantity,
  order_row.minimum_price_cents,
  order_row.subtotal_price_cents,
  order_row.sale_price_cents,
  order_row.discount_amount_cents,
  order_row.created_at
from public.orders as order_row
on conflict (order_id, position) do nothing;

create index if not exists order_items_product_order_idx
  on public.order_items (product_id, order_id);

alter table public.order_items enable row level security;
alter table public.order_items force row level security;

drop policy if exists order_items_admin_select on public.order_items;
create policy order_items_admin_select
on public.order_items
for select
to authenticated
using (private.is_admin());

revoke all on table public.order_items from public, anon, authenticated;
grant select on table public.order_items to authenticated;

-- Preserve one line for every order created through the existing single-item
-- RPC. The cart RPC replaces this provisional line before its transaction is
-- visible, keeping rolling deployments compatible.
create or replace function private.sync_single_order_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  -- A cart keeps aggregate totals on the parent order. Its real normalized
  -- lines are inserted by the cart RPC in the same transaction.
  if new.subtotal_price_cents <> new.minimum_price_cents * new.quantity then
    return new;
  end if;

  insert into public.order_items (
    order_id,
    position,
    product_id,
    quantity,
    unit_price_cents,
    subtotal_price_cents,
    sale_price_cents,
    discount_amount_cents,
    created_at
  )
  values (
    new.id,
    1,
    new.product_id,
    new.quantity,
    new.minimum_price_cents,
    new.subtotal_price_cents,
    new.sale_price_cents,
    new.discount_amount_cents,
    new.created_at
  )
  on conflict (order_id, position) do nothing;
  return new;
end
$$;

revoke all on function private.sync_single_order_item()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_sync_single_order_item on public.orders;
create trigger orders_sync_single_order_item
after insert on public.orders
for each row execute function private.sync_single_order_item();

-- Product stock summaries now read the normalized lines instead of assuming
-- one product per checkout.
create or replace view public.product_stock_summary
with (security_invoker = true)
as
select
  product.id as product_id,
  product.name as product_name,
  product.substore_id,
  product.stock_quantity::bigint as available_count,
  coalesce(order_totals.reserved_count, 0)::bigint as reserved_count,
  (
    product.stock_quantity
    + coalesce(order_totals.reserved_count, 0)
    + coalesce(order_totals.delivered_count, 0)
  )::bigint as total_count,
  product.low_stock_threshold,
  (product.stock_quantity <= product.low_stock_threshold) as is_low_stock,
  coalesce(order_totals.delivered_count, 0)::bigint as delivered_count,
  0::bigint as quarantined_count,
  0::bigint as revoked_count,
  product.status as product_status
from public.products as product
left join lateral (
  select
    coalesce(
      sum(item.quantity) filter (
        where order_row.status in ('pending', 'awaiting_payment', 'paid', 'processing')
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(item.quantity) filter (where order_row.status = 'delivered'),
      0
    )::bigint as delivered_count
  from public.order_items as item
  join public.orders as order_row on order_row.id = item.order_id
  where item.product_id = product.id
) as order_totals on true;

drop function if exists public.create_bot_cart_with_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
);

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
  v_payment_reference text;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_product_ids uuid[];
  v_quantities integer[];
  v_item_count integer;
  v_position integer;
  v_total_quantity integer := 0;
  v_line_subtotal bigint;
  v_total_subtotal bigint := 0;
  v_total_discount bigint;
  v_base_discount bigint;
  v_allocated_discount bigint := 0;
  v_discount_remainder bigint;
  v_discount_remainder_position integer;
  v_line_discount bigint;
  v_total_sale bigint;
  v_normalized_items jsonb;
  v_existing_items jsonb;
begin
  if p_interaction_id is null or p_interaction_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord interaction ID is invalid.';
  end if;
  if p_buyer_discord_id is null or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord buyer ID is invalid.';
  end if;
  if p_whitelist_entry_id is null then
    raise exception using errcode = '42501', message = 'Guild owner is not authorized to sell.';
  end if;
  if p_items is null or case
    when jsonb_typeof(p_items) = 'array'
      then jsonb_array_length(p_items) not between 1 and 3
    else true
  end then
    raise exception using errcode = '22023', message = 'Cart must contain between one and three products.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(item)
    where case
      when jsonb_typeof(entry.item) <> 'object' then true
      when jsonb_typeof(entry.item -> 'product_id') is distinct from 'string' then true
      when coalesce(entry.item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then true
      when jsonb_typeof(entry.item -> 'quantity') is distinct from 'number' then true
      when coalesce(entry.item ->> 'quantity', '') !~ '^[0-9]{1,5}$' then true
      else (entry.item ->> 'quantity')::integer not between 1 and 10000
    end
  ) then
    raise exception using errcode = '22023', message = 'Cart item is invalid.';
  end if;
  if p_discount_bps is null or p_discount_bps not between 0 and 9000 then
    raise exception using errcode = '22023', message = 'Cart discount is invalid.';
  end if;
  if (p_discount_bps = 0 and p_discount_reason is not null)
    or (p_discount_bps > 0 and p_discount_reason is distinct from 'server_booster') then
    raise exception using errcode = '22023', message = 'Cart discount reason is invalid.';
  end if;
  if p_commission_bps is null or p_commission_bps not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'Order commission is invalid.';
  end if;

  select
    array_agg((entry.item ->> 'product_id')::uuid order by entry.position),
    array_agg((entry.item ->> 'quantity')::integer order by entry.position),
    jsonb_agg(
      jsonb_build_object(
        'product_id', lower(entry.item ->> 'product_id'),
        'quantity', (entry.item ->> 'quantity')::integer
      )
      order by entry.position
    )
  into v_product_ids, v_quantities, v_normalized_items
  from jsonb_array_elements(p_items) with ordinality as entry(item, position);

  v_item_count := cardinality(v_product_ids);
  if (
    select count(distinct product_id)
    from unnest(v_product_ids) as product_id
  ) <> v_item_count then
    raise exception using errcode = '22023', message = 'Cart products must be unique.';
  end if;

  v_payment_reference := 'discord:' || p_interaction_id;
  perform pg_advisory_xact_lock(hashtextextended(v_payment_reference, 0));

  select order_row.*
  into v_existing
  from public.orders as order_row
  where order_row.payment_reference = v_payment_reference;

  if found then
    select jsonb_agg(
      jsonb_build_object(
        'product_id', item.product_id::text,
        'quantity', item.quantity
      )
      order by item.position
    )
    into v_existing_items
    from public.order_items as item
    where item.order_id = v_existing.id;

    if v_existing.guild_id <> p_guild_id
      or v_existing.seller_whitelist_entry_id <> p_whitelist_entry_id
      or v_existing.buyer_discord_id <> p_buyer_discord_id
      or v_existing.discount_bps <> p_discount_bps
      or v_existing.discount_reason is distinct from p_discount_reason
      or v_existing.commission_bps <> p_commission_bps
      or v_existing_items is distinct from v_normalized_items then
      raise exception using errcode = '22000', message = 'Discord interaction is already bound to another purchase.';
    end if;
    return query select v_existing.id, false, false;
    return;
  end if;

  if not exists (
    select 1
    from public.guilds as guild
    join public.whitelist_entries as whitelist
      on whitelist.id = guild.whitelist_entry_id
    where guild.id = p_guild_id
      and guild.whitelist_entry_id = p_whitelist_entry_id
      and guild.status = 'active'
      and whitelist.is_active
      and whitelist.archived_at is null
  ) then
    raise exception using errcode = '42501', message = 'Guild owner is not authorized to sell.';
  end if;

  -- Lock every product in stable UUID order to make concurrent carts safe.
  perform product.id
  from public.products as product
  where product.id = any(v_product_ids)
  order by product.id
  for update;

  if (
    select count(*)
    from public.products as product
    where product.id = any(v_product_ids)
      and product.status = 'active'
      and product.archived_at is null
      and product.minimum_price_cents > 0
  ) <> v_item_count then
    raise exception using errcode = '22000', message = 'One or more cart products are unavailable.';
  end if;

  for v_position in 1..v_item_count loop
    select product.*
    into strict v_product
    from public.products as product
    where product.id = v_product_ids[v_position];

    if v_product.stock_quantity < v_quantities[v_position] then
      return query select null::uuid, false, true;
      return;
    end if;

    v_line_subtotal := v_product.minimum_price_cents * v_quantities[v_position];
    v_total_subtotal := v_total_subtotal + v_line_subtotal;
    v_total_quantity := v_total_quantity + v_quantities[v_position];
    v_base_discount := trunc(
      v_line_subtotal::numeric * p_discount_bps::numeric / 10000
    )::bigint;
    v_allocated_discount := v_allocated_discount + v_base_discount;
  end loop;

  v_total_discount := trunc(
    v_total_subtotal::numeric * p_discount_bps::numeric / 10000
  )::bigint;
  v_discount_remainder := v_total_discount - v_allocated_discount;
  v_total_sale := v_total_subtotal - v_total_discount;

  select position
  into strict v_discount_remainder_position
  from generate_subscripts(v_product_ids, 1) as positions(position)
  join public.products as product on product.id = v_product_ids[position]
  order by
    product.minimum_price_cents * v_quantities[position] desc,
    position
  limit 1;

  if v_total_sale < 100 then
    raise exception using errcode = '22023', message = 'Cart total is below the LivePix BRL minimum.';
  end if;

  select product.*
  into strict v_product
  from public.products as product
  where product.id = v_product_ids[1];

  insert into public.orders (
    guild_id,
    seller_whitelist_entry_id,
    product_id,
    buyer_discord_id,
    quantity,
    status,
    currency_code,
    subtotal_price_cents,
    sale_price_cents,
    minimum_price_cents,
    discount_bps,
    discount_amount_cents,
    discount_reason,
    commission_bps,
    payment_reference,
    payment_provider,
    payment_status
  )
  values (
    p_guild_id,
    p_whitelist_entry_id,
    v_product_ids[1],
    p_buyer_discord_id,
    v_total_quantity,
    'awaiting_payment',
    'BRL',
    v_total_subtotal,
    v_total_sale,
    v_product.minimum_price_cents,
    p_discount_bps,
    v_total_discount,
    p_discount_reason,
    p_commission_bps,
    v_payment_reference,
    'livepix',
    'uninitialized'
  )
  returning * into v_order;

  -- Replace the compatibility trigger's aggregate line with the real cart.
  delete from public.order_items where order_id = v_order.id;

  for v_position in 1..v_item_count loop
    select product.*
    into strict v_product
    from public.products as product
    where product.id = v_product_ids[v_position];

    v_line_subtotal := v_product.minimum_price_cents * v_quantities[v_position];
    v_line_discount := trunc(
      v_line_subtotal::numeric * p_discount_bps::numeric / 10000
    )::bigint;
    if v_position = v_discount_remainder_position then
      v_line_discount := v_line_discount + v_discount_remainder;
    end if;

    insert into public.order_items (
      order_id,
      position,
      product_id,
      quantity,
      unit_price_cents,
      subtotal_price_cents,
      sale_price_cents,
      discount_amount_cents
    )
    values (
      v_order.id,
      v_position,
      v_product.id,
      v_quantities[v_position],
      v_product.minimum_price_cents,
      v_line_subtotal,
      v_line_subtotal - v_line_discount,
      v_line_discount
    );

    update public.products
    set stock_quantity = stock_quantity - v_quantities[v_position]
    where id = v_product.id
      and stock_quantity >= v_quantities[v_position];

    if not found then
      raise exception using errcode = '40001', message = 'Concurrent cart stock reservation must be retried.';
    end if;
  end loop;

  insert into public.audit_events (
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'bot.order.cart.create',
    'order',
    v_order.id,
    jsonb_build_object(
      'buyer_discord_id', p_buyer_discord_id,
      'guild_id', p_guild_id,
      'items', v_normalized_items,
      'subtotal_price_cents', v_total_subtotal,
      'discount_bps', p_discount_bps,
      'discount_amount_cents', v_total_discount,
      'discount_reason', p_discount_reason,
      'total_price_cents', v_total_sale,
      'stock_reserved', true,
      'inventory_mode', 'aggregate',
      'source', 'discord_http_interaction'
    )
  );

  return query select v_order.id, true, false;
end
$$;

comment on function public.create_bot_cart_with_reservation(text, uuid, uuid, text, jsonb, integer, text, integer) is
  'Idempotently prices a one-to-three item Discord cart, reserves every product under stable locks and creates one LivePix order.';

revoke all on function public.create_bot_cart_with_reservation(text, uuid, uuid, text, jsonb, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_cart_with_reservation(text, uuid, uuid, text, jsonb, integer, text, integer)
  to service_role;

-- Expiration must restore every product in a cart exactly once. Legacy
-- encrypted-unit orders keep their original reservation path.
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
    or v_order.stock_released_at is not null
    or v_order.payment_expires_at is null
    or v_order.payment_expires_at > p_effective_at then
    return;
  end if;

  select coalesce(array_agg(locked.inventory_unit_id order by locked.inventory_unit_id), '{}'::uuid[])
  into v_inventory_unit_ids
  from (
    select reservation.inventory_unit_id
    from public.order_inventory_units as reservation
    join public.inventory_units as unit on unit.id = reservation.inventory_unit_id
    where reservation.order_id = v_order.id
    order by reservation.inventory_unit_id
    for update of unit
  ) as locked;

  if cardinality(v_inventory_unit_ids) > 0 then
    if cardinality(v_inventory_unit_ids) <> v_order.quantity then
      raise exception using errcode = '22000', message = 'Expired order inventory reservation count is inconsistent.';
    end if;

    update public.inventory_units
    set status = 'available', reservation_expires_at = null
    where id = any(v_inventory_unit_ids)
      and product_id = v_order.product_id
      and status = 'reserved';
    get diagnostics v_updated_count = row_count;
    if v_updated_count <> v_order.quantity then
      raise exception using errcode = '22000', message = 'Expired order inventory reservation state is inconsistent.';
    end if;

    update public.products
    set stock_quantity = stock_quantity + v_updated_count
    where id = v_order.product_id;
    v_restored_quantity := v_updated_count;
  else
    if v_order.inventory_unit_id is not null then
      raise exception using errcode = '22000', message = 'Expired legacy order has no inventory reservation mapping.';
    end if;

    perform product.id
    from public.products as product
    join public.order_items as item on item.product_id = product.id
    where item.order_id = v_order.id
    order by product.id
    for update of product;

    update public.products as product
    set stock_quantity = product.stock_quantity + item.quantity
    from public.order_items as item
    where item.order_id = v_order.id
      and item.product_id = product.id;

    select coalesce(sum(item.quantity), 0)::integer
    into v_restored_quantity
    from public.order_items as item
    where item.order_id = v_order.id;

    if v_restored_quantity <> v_order.quantity then
      raise exception using errcode = '22000', message = 'Expired cart quantity is inconsistent.';
    end if;
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

  insert into public.audit_events (action, entity_type, entity_id, metadata)
  values (
    'bot.order.payment_timeout',
    'order',
    v_order.id,
    jsonb_build_object(
      'reason', 'payment_not_approved_within_2_hours',
      'source', p_source,
      'quantity', v_order.quantity,
      'stock_restored', v_restored_quantity,
      'deadline', v_order.payment_expires_at,
      'stock_released_at', p_effective_at,
      'item_count', (select count(*) from public.order_items where order_id = v_order.id)
    )
  );

  return query select v_order.id, v_order.product_id, v_restored_quantity;
end
$$;

comment on function private.expire_unpaid_order(uuid, timestamptz, text) is
  'Atomically cancels one overdue unpaid order and restores every normalized cart line exactly once.';

revoke all on function private.expire_unpaid_order(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;

-- A paid cart opens one ticket containing every selected product.
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
  v_order_quantity integer;
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

  select
    string_agg(
      product.name || ' ×' || item.quantity::text,
      ', '
      order by item.position
    ),
    sum(item.quantity)::integer
  into v_product_name, v_order_quantity
  from public.order_items as item
  join public.products as product on product.id = item.product_id
  where item.order_id = v_order.id;

  if v_product_name is null or v_order_quantity <> v_order.quantity then
    raise exception using errcode = '22000', message = 'Order cart is incomplete.';
  end if;
  if v_order.stock_released_at is not null then
    raise exception using errcode = '22000', message = 'Order stock was already released.';
  end if;

  if v_order.discord_ticket_status in ('open', 'closed') then
    return query select
      v_order.id, false, v_discord_guild_id, v_order.buyer_discord_id,
      v_product_name, v_order.sale_price_cents, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, v_order_quantity;
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
      v_order.discord_ticket_channel_id, v_order_quantity;
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
    v_order.discord_ticket_channel_id, v_order_quantity;
end
$$;

comment on function public.claim_discord_ticket(uuid) is
  'Claims one paid-order ticket and aggregates every normalized cart item for fulfillment.';

revoke all on function public.claim_discord_ticket(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_discord_ticket(uuid) to service_role;

commit;
