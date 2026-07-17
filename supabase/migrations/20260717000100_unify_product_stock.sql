begin;

-- Products sold by GWStore are delivered manually in Discord tickets. Keep the
-- encrypted unit tables as immutable history, but make the live stock a single
-- aggregate counter on the product instead of requiring one row per unit.
alter table public.products
  add column if not exists stock_quantity bigint;

update public.products as product
set stock_quantity = coalesce(stock.available_count, 0)
from (
  select
    existing_product.id as product_id,
    count(unit.id) filter (where unit.status = 'available')::bigint as available_count
  from public.products as existing_product
  left join public.inventory_units as unit on unit.product_id = existing_product.id
  group by existing_product.id
) as stock
where product.id = stock.product_id
  and product.stock_quantity is null;

update public.products
set stock_quantity = 0
where stock_quantity is null;

alter table public.products
  alter column stock_quantity set default 0,
  alter column stock_quantity set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_stock_quantity_range'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_stock_quantity_range
      check (stock_quantity between 0 and 1000000000);
  end if;
end
$$;

comment on column public.products.stock_quantity is
  'Immediately available aggregate stock. New orders reserve stock by atomically decrementing this counter.';

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
      sum(order_row.quantity) filter (
        where order_row.status in ('pending', 'awaiting_payment', 'paid', 'processing')
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(order_row.quantity) filter (where order_row.status = 'delivered'),
      0
    )::bigint as delivered_count
  from public.orders as order_row
  where order_row.product_id = product.id
) as order_totals on true;

create or replace view public.admin_dashboard_summary
with (security_invoker = true)
as
select
  (select count(*) from public.games where archived_at is null)::bigint as games_count,
  (select count(*) from public.substores where archived_at is null)::bigint as substores_count,
  (select count(*) from public.products where archived_at is null)::bigint as products_count,
  (
    select coalesce(sum(stock_quantity), 0)
    from public.products
    where archived_at is null
  )::bigint as available_units_count,
  (
    select count(*)
    from public.product_stock_summary
    where is_low_stock and product_status <> 'archived'
  )::bigint as low_stock_products_count,
  (select count(*) from public.guilds where archived_at is null)::bigint as guilds_count,
  (select count(*) from public.orders)::bigint as orders_count,
  (select count(*) from public.orders where status = 'delivered')::bigint as delivered_orders_count,
  (
    select coalesce(sum(amount_cents), 0)
    from public.ledger_entries
  )::bigint as ledger_balance_cents,
  (
    select coalesce(sum(amount_cents), 0)
    from public.payouts
    where status in ('requested', 'approved', 'processing')
  )::bigint as pending_payouts_cents;

-- Reserve the requested quantity by locking exactly one product row. The
-- order insert happens before the decrement so an idempotency conflict can
-- never consume stock twice.
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
  if p_sale_price_cents is null or p_sale_price_cents < 100 then
    raise exception using errcode = '22023', message = 'Order price is below the LivePix BRL minimum.';
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
      or v_existing.sale_price_cents <> p_sale_price_cents
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
    or v_product.minimum_price_cents::numeric * p_quantity::numeric <> p_sale_price_cents::numeric then
    raise exception using errcode = '22000', message = 'Product, quantity or server-side price is invalid.';
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
    sale_price_cents,
    minimum_price_cents,
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
    p_sale_price_cents,
    v_product.minimum_price_cents,
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
      or v_existing.sale_price_cents <> p_sale_price_cents
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
      'total_price_cents', p_sale_price_cents,
      'stock_reserved', true,
      'inventory_mode', 'aggregate',
      'source', 'discord_http_interaction'
    )
  );

  return query select v_order.id, v_order.status, true, false;
end
$$;

comment on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer) is
  'Idempotently creates a Discord order and atomically decrements the aggregate product stock by the requested quantity.';

revoke all on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer)
  to service_role;

-- Historical orders retain their encrypted unit links and are still validated.
-- Aggregate-stock orders deliberately have no inventory_unit_id.
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
    or new.status not in ('paid', 'processing', 'delivered') then
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

commit;
