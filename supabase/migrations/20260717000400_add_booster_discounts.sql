begin;

alter table public.orders
  add column if not exists subtotal_price_cents bigint,
  add column if not exists discount_bps integer not null default 0,
  add column if not exists discount_amount_cents bigint not null default 0,
  add column if not exists discount_reason text;

update public.orders
set subtotal_price_cents = sale_price_cents
where subtotal_price_cents is null;

alter table public.orders
  alter column subtotal_price_cents set not null,
  drop constraint if exists orders_price_floor,
  drop constraint if exists orders_discount_consistency,
  drop constraint if exists orders_discount_range,
  add constraint orders_discount_range check (discount_bps between 0 and 9000),
  add constraint orders_discount_consistency check (
    subtotal_price_cents >= sale_price_cents
    and discount_amount_cents = subtotal_price_cents - sale_price_cents
    and discount_amount_cents = trunc(
      subtotal_price_cents::numeric * discount_bps::numeric / 10000
    )::bigint
    and (
      (discount_bps = 0 and discount_amount_cents = 0 and discount_reason is null)
      or
      (discount_bps > 0 and discount_amount_cents > 0 and discount_reason = 'server_booster')
    )
  );

comment on column public.orders.subtotal_price_cents is
  'Server-calculated product subtotal before any customer discount.';
comment on column public.orders.discount_bps is
  'Discount rate snapshotted at order creation in basis points.';
comment on column public.orders.discount_amount_cents is
  'Discount amount snapshotted at order creation in BRL cents.';
comment on column public.orders.discount_reason is
  'Auditable discount origin. Currently server_booster or null.';

create or replace function public.create_bot_order_with_reservation(
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
  v_payment_reference text;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
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
  if p_quantity is null or p_quantity not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'Order quantity is invalid.';
  end if;
  if p_subtotal_price_cents is null or p_subtotal_price_cents < 1 then
    raise exception using errcode = '22023', message = 'Order subtotal is invalid.';
  end if;
  if p_sale_price_cents is null or p_sale_price_cents < 100 then
    raise exception using errcode = '22023', message = 'Order price is below the LivePix BRL minimum.';
  end if;
  if p_discount_bps is null or p_discount_bps not between 0 and 9000 then
    raise exception using errcode = '22023', message = 'Order discount is invalid.';
  end if;
  if p_discount_amount_cents is null
    or p_discount_amount_cents <> trunc(
      p_subtotal_price_cents::numeric * p_discount_bps::numeric / 10000
    )::bigint
    or p_sale_price_cents <> p_subtotal_price_cents - p_discount_amount_cents
    or (
      p_discount_bps = 0
      and (p_discount_amount_cents <> 0 or p_discount_reason is not null)
    )
    or (
      p_discount_bps > 0
      and (p_discount_amount_cents <= 0 or p_discount_reason <> 'server_booster')
    ) then
    raise exception using errcode = '22023', message = 'Order discount calculation is invalid.';
  end if;
  if p_commission_bps is null or p_commission_bps not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'Order commission is invalid.';
  end if;

  v_payment_reference := 'discord:' || p_interaction_id;

  select order_row.*
  into v_existing
  from public.orders as order_row
  where order_row.payment_reference = v_payment_reference;

  if found then
    if v_existing.guild_id <> p_guild_id
      or v_existing.seller_whitelist_entry_id <> p_whitelist_entry_id
      or v_existing.product_id <> p_product_id
      or v_existing.buyer_discord_id <> p_buyer_discord_id
      or v_existing.quantity <> p_quantity
      or v_existing.subtotal_price_cents <> p_subtotal_price_cents
      or v_existing.sale_price_cents <> p_sale_price_cents
      or v_existing.discount_bps <> p_discount_bps
      or v_existing.discount_amount_cents <> p_discount_amount_cents
      or v_existing.discount_reason is distinct from p_discount_reason
      or v_existing.commission_bps <> p_commission_bps then
      raise exception using errcode = '22000', message = 'Discord interaction is already bound to another order.';
    end if;
    return query select v_existing.id, v_existing.status, false, false;
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

  select product.*
  into v_product
  from public.products as product
  where product.id = p_product_id
    and product.status = 'active'
    and product.archived_at is null
  for update;

  if not found
    or v_product.minimum_price_cents < 1
    or v_product.minimum_price_cents::numeric * p_quantity::numeric <> p_subtotal_price_cents::numeric then
    raise exception using errcode = '22000', message = 'Product, quantity or server-side subtotal is invalid.';
  end if;

  if v_product.stock_quantity < p_quantity then
    return query
    select null::uuid, 'awaiting_payment'::public.order_status, false, true;
    return;
  end if;

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
    p_product_id,
    p_buyer_discord_id,
    p_quantity,
    'awaiting_payment',
    'BRL',
    p_subtotal_price_cents,
    p_sale_price_cents,
    v_product.minimum_price_cents,
    p_discount_bps,
    p_discount_amount_cents,
    p_discount_reason,
    p_commission_bps,
    v_payment_reference,
    'livepix',
    'uninitialized'
  )
  on conflict do nothing
  returning * into v_order;

  if not found then
    select order_row.*
    into v_existing
    from public.orders as order_row
    where order_row.payment_reference = v_payment_reference;

    if not found then
      raise exception using errcode = '40001', message = 'Concurrent stock reservation must be retried.';
    end if;
    if v_existing.guild_id <> p_guild_id
      or v_existing.seller_whitelist_entry_id <> p_whitelist_entry_id
      or v_existing.product_id <> p_product_id
      or v_existing.buyer_discord_id <> p_buyer_discord_id
      or v_existing.quantity <> p_quantity
      or v_existing.subtotal_price_cents <> p_subtotal_price_cents
      or v_existing.sale_price_cents <> p_sale_price_cents
      or v_existing.discount_bps <> p_discount_bps
      or v_existing.discount_amount_cents <> p_discount_amount_cents
      or v_existing.discount_reason is distinct from p_discount_reason
      or v_existing.commission_bps <> p_commission_bps then
      raise exception using errcode = '22000', message = 'Discord interaction is already bound to another order.';
    end if;
    return query select v_existing.id, v_existing.status, false, false;
    return;
  end if;

  update public.products
  set stock_quantity = stock_quantity - p_quantity
  where id = p_product_id
    and stock_quantity >= p_quantity;

  if not found then
    raise exception using errcode = '40001', message = 'Concurrent stock reservation must be retried.';
  end if;

  insert into public.audit_events (
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'bot.order.create',
    'order',
    v_order.id,
    jsonb_build_object(
      'buyer_discord_id', p_buyer_discord_id,
      'guild_id', p_guild_id,
      'product_id', p_product_id,
      'quantity', p_quantity,
      'unit_price_cents', v_product.minimum_price_cents,
      'subtotal_price_cents', p_subtotal_price_cents,
      'discount_bps', p_discount_bps,
      'discount_amount_cents', p_discount_amount_cents,
      'discount_reason', p_discount_reason,
      'total_price_cents', p_sale_price_cents,
      'stock_reserved', true,
      'inventory_mode', 'aggregate',
      'source', 'discord_http_interaction'
    )
  );

  return query select v_order.id, v_order.status, true, false;
end
$$;

comment on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer) is
  'Idempotently creates a Discord order, snapshots any verified server-booster discount and reserves aggregate stock.';

revoke all on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer)
  to service_role;

-- Preserve the old RPC signature for a safe rolling deployment. It creates an
-- undiscounted order and delegates all validation to the new implementation.
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

comment on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer) is
  'Compatibility wrapper that creates an undiscounted order through the discount-aware RPC.';

revoke all on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer)
  to service_role;

commit;
