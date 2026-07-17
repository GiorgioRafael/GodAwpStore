begin;

alter table public.orders
  add column if not exists quantity integer not null default 1;

alter table public.orders
  drop constraint if exists orders_quantity_range;
alter table public.orders
  add constraint orders_quantity_range check (quantity between 1 and 10000);

create table if not exists public.order_inventory_units (
  order_id uuid not null references public.orders (id) on delete restrict,
  inventory_unit_id uuid not null references public.inventory_units (id) on delete restrict,
  position integer not null,
  created_at timestamptz not null default now(),
  primary key (order_id, inventory_unit_id),
  constraint order_inventory_units_inventory_unique unique (inventory_unit_id),
  constraint order_inventory_units_position_unique unique (order_id, position),
  constraint order_inventory_units_position_positive check (position > 0)
);

comment on table public.order_inventory_units is
  'Maps every encrypted inventory unit reserved by a multi-quantity order without exposing secret payloads.';

insert into public.order_inventory_units (order_id, inventory_unit_id, position)
select order_row.id, order_row.inventory_unit_id, 1
from public.orders as order_row
where order_row.inventory_unit_id is not null
on conflict do nothing;

create index if not exists order_inventory_units_order_position_idx
  on public.order_inventory_units (order_id, position);

alter table public.order_inventory_units enable row level security;
alter table public.order_inventory_units force row level security;

drop policy if exists order_inventory_units_admin_select on public.order_inventory_units;
create policy order_inventory_units_admin_select
on public.order_inventory_units
for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.order_inventory_units from public, anon, authenticated;
grant select on table public.order_inventory_units to authenticated;

drop function if exists public.create_bot_order_with_reservation(
  text,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  integer
);

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
  v_inventory_unit_ids uuid[];
  v_reserved_count integer;
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
    and product.archived_at is null;

  if not found
    or v_product.minimum_price_cents < 1
    or v_product.minimum_price_cents::numeric * p_quantity::numeric <> p_sale_price_cents::numeric then
    raise exception using errcode = '22000', message = 'Product, quantity or server-side price is invalid.';
  end if;

  select coalesce(array_agg(locked.id order by locked.created_at, locked.id), '{}'::uuid[])
  into v_inventory_unit_ids
  from (
    select unit.id, unit.created_at
    from public.inventory_units as unit
    where unit.product_id = p_product_id
      and unit.status = 'available'
    order by unit.created_at, unit.id
    for update skip locked
    limit p_quantity
  ) as locked;

  if cardinality(v_inventory_unit_ids) <> p_quantity then
    return query
    select null::uuid, 'awaiting_payment'::public.order_status, false, true;
    return;
  end if;

  insert into public.orders (
    guild_id,
    seller_whitelist_entry_id,
    product_id,
    inventory_unit_id,
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
    v_inventory_unit_ids[1],
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
      raise exception using errcode = '40001', message = 'Concurrent inventory reservation must be retried.';
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

  insert into public.order_inventory_units (order_id, inventory_unit_id, position)
  select v_order.id, reserved.id, reserved.position::integer
  from unnest(v_inventory_unit_ids) with ordinality as reserved(id, position);

  update public.inventory_units
  set
    status = 'reserved',
    reservation_expires_at = null
  where id = any(v_inventory_unit_ids)
    and status = 'available';

  get diagnostics v_reserved_count = row_count;
  if v_reserved_count <> p_quantity then
    raise exception using errcode = '40001', message = 'Concurrent inventory reservation must be retried.';
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
      'inventory_reserved', true,
      'source', 'discord_http_interaction'
    )
  );

  return query select v_order.id, v_order.status, true, false;
end
$$;

comment on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer) is
  'Idempotently creates a Discord order and atomically reserves the exact requested quantity before LivePix checkout.';

revoke all on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, integer)
  to service_role;

-- Keep the previous one-unit signature during the rolling deployment so an
-- already-running serverless instance cannot lose order creation mid-release.
create or replace function public.create_bot_order_with_reservation(
  p_interaction_id text,
  p_guild_id uuid,
  p_whitelist_entry_id uuid,
  p_product_id uuid,
  p_buyer_discord_id text,
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
    1,
    p_sale_price_cents,
    p_commission_bps
  )
$$;

comment on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, bigint, integer) is
  'Compatibility wrapper for one-unit orders during the quantity-aware rolling deployment.';

revoke all on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, bigint, integer)
  to service_role;

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

  if new.inventory_unit_id is null then
    raise exception using errcode = '22000', message = 'Paid order has no reserved inventory unit.';
  end if;
  if new.seller_whitelist_entry_id is null then
    raise exception using errcode = '22000', message = 'Paid order has no authorized seller.';
  end if;

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
      'Lucro líquido da venda GWStore'
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
      'Comissão da plataforma GWStore'
    )
    on conflict do nothing;
  end if;

  return new;
end
$$;

commit;
