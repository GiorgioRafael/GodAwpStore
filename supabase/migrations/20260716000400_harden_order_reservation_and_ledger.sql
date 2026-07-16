begin;

-- A click can only become payable after one inventory unit is locked and
-- reserved in the same database transaction. This removes the stock-count /
-- insert race between concurrent buyers.
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
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payment_reference text;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_inventory_unit_id uuid;
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
  if p_sale_price_cents is null or p_sale_price_cents < 100 then
    raise exception using errcode = '22023', message = 'Order price is invalid.';
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

  if not found or v_product.minimum_price_cents <> p_sale_price_cents then
    raise exception using errcode = '22000', message = 'Product or server-side price is invalid.';
  end if;

  select unit.id
  into v_inventory_unit_id
  from public.inventory_units as unit
  where unit.product_id = p_product_id
    and unit.status = 'available'
  order by unit.created_at, unit.id
  for update skip locked
  limit 1;

  if not found then
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
    v_inventory_unit_id,
    p_buyer_discord_id,
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
      or v_existing.buyer_discord_id <> p_buyer_discord_id then
      raise exception using errcode = '22000', message = 'Discord interaction is already bound to another order.';
    end if;
    return query select v_existing.id, v_existing.status, false, false;
    return;
  end if;

  update public.inventory_units
  set
    status = 'reserved',
    reservation_expires_at = null
  where id = v_inventory_unit_id
    and status = 'available';

  if not found then
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
      'inventory_reserved', true,
      'source', 'discord_http_interaction'
    )
  );

  return query select v_order.id, v_order.status, true, false;
end
$$;

comment on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, bigint, integer) is
  'Idempotently creates a Discord order and atomically reserves exactly one encrypted inventory unit before checkout.';

revoke all on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_order_with_reservation(text, uuid, uuid, uuid, text, bigint, integer)
  to service_role;

-- Financial entries are one-per-order/kind. The platform commission remains in
-- the same ledger for audit and reporting, but is excluded from seller balance.
create unique index if not exists ledger_entries_order_financial_kind_unique
  on public.ledger_entries (order_id, kind)
  where order_id is not null and kind in ('sale_profit', 'commission');

create or replace function private.finalize_paid_order_financials()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_inventory_status public.inventory_unit_status;
  v_inventory_product_id uuid;
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

  select unit.status, unit.product_id
  into v_inventory_status, v_inventory_product_id
  from public.inventory_units as unit
  where unit.id = new.inventory_unit_id
  for update;

  if not found
    or v_inventory_product_id <> new.product_id
    or v_inventory_status not in ('reserved', 'delivered') then
    raise exception using errcode = '22000', message = 'Paid order inventory reservation is invalid.';
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

drop trigger if exists orders_finalize_paid_order_financials on public.orders;
create trigger orders_finalize_paid_order_financials
after update of status, payment_status on public.orders
for each row execute function private.finalize_paid_order_financials();

create or replace view public.whitelist_balances
with (security_invoker = true)
as
select
  entry.id as whitelist_entry_id,
  entry.discord_id,
  coalesce(
    sum(ledger.amount_cents) filter (
      where ledger.status in ('pending', 'available')
        and ledger.kind <> 'commission'
    ),
    0
  )::bigint as balance_cents,
  coalesce(
    sum(ledger.amount_cents) filter (
      where ledger.status = 'pending'
        and ledger.kind <> 'commission'
    ),
    0
  )::bigint as pending_balance_cents,
  coalesce(
    sum(ledger.amount_cents) filter (
      where ledger.status = 'available'
        and ledger.kind <> 'commission'
    ),
    0
  )::bigint as available_balance_cents,
  coalesce(
    sum(ledger.amount_cents) filter (
      where ledger.kind = 'sale_profit'
        and ledger.status <> 'reversed'
    ),
    0
  )::bigint as total_profit_cents,
  coalesce(
    sum(-ledger.amount_cents) filter (
      where ledger.kind in ('payout', 'payout_reversal')
        and ledger.status <> 'reversed'
    ),
    0
  )::bigint as total_paid_out_cents
from public.whitelist_entries as entry
left join public.ledger_entries as ledger on ledger.whitelist_entry_id = entry.id
group by entry.id;

revoke all on table public.whitelist_balances from anon, authenticated;
grant select on table public.whitelist_balances to authenticated;

commit;
