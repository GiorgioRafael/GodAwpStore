-- Transactional verification for LivePix minimum amount and exact multi-unit reservation.

begin;

set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label, is_active)
values (
  '70000000-0000-4000-8000-000000000001',
  '710000000000000002',
  'Quantity test seller',
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
  '71000000-0000-4000-8000-000000000001',
  '710000000000000001',
  '710000000000000002',
  '70000000-0000-4000-8000-000000000001',
  'Quantity integration guild',
  'active'
);

insert into public.games (id, name, slug, status)
values (
  '71100000-0000-4000-8000-000000000001',
  'Quantity verification game',
  'quantity-verification-game',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '71200000-0000-4000-8000-000000000001',
  '71100000-0000-4000-8000-000000000001',
  'Quantity verification store',
  'quantity-verification-store',
  'Quantity verification store',
  'active'
);

insert into public.products (
  id,
  substore_id,
  name,
  slug,
  minimum_price_cents,
  status,
  low_stock_threshold
)
values (
  '71300000-0000-4000-8000-000000000001',
  '71200000-0000-4000-8000-000000000001',
  'Dynamic price product',
  'dynamic-price-product',
  2,
  'active',
  1
);

insert into public.inventory_batches (id, product_id, source, import_method, unit_count)
values (
  '71500000-0000-4000-8000-000000000001',
  '71300000-0000-4000-8000-000000000001',
  'quantity-test',
  'manual',
  50
);

insert into public.inventory_units (
  product_id,
  batch_id,
  encrypted_payload,
  iv,
  auth_tag,
  fingerprint,
  status
)
select
  '71300000-0000-4000-8000-000000000001',
  '71500000-0000-4000-8000-000000000001',
  decode('01', 'hex'),
  decode(repeat('00', 12), 'hex'),
  decode(repeat('00', 16), 'hex'),
  digest('gwstore-quantity-test-' || fixture.number::text, 'sha256'),
  'available'
from generate_series(1, 50) as fixture(number);

do $$
begin
  begin
    perform public.create_bot_order_with_reservation(
      '720000000000000101',
      '71000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      '71300000-0000-4000-8000-000000000001',
      '720000000000000001',
      49,
      98,
      1000
    );
    raise exception 'quantity below the LivePix BRL minimum was accepted';
  exception
    when invalid_parameter_value then null;
  end;
end
$$;

-- Changing an administrative product price must immediately recalculate the
-- LivePix minimum; there is no product-specific hardcoded quantity.
update public.products
set minimum_price_cents = 5
where id = '71300000-0000-4000-8000-000000000001';

do $$
begin
  begin
    perform public.create_bot_order_with_reservation(
      '720000000000000103',
      '71000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      '71300000-0000-4000-8000-000000000001',
      '720000000000000001',
      19,
      95,
      1000
    );
    raise exception 'updated price did not recalculate the LivePix minimum';
  exception
    when invalid_parameter_value then null;
  end;
end
$$;

select *
from public.create_bot_order_with_reservation(
  '720000000000000102',
  '71000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '71300000-0000-4000-8000-000000000001',
  '720000000000000001',
  20,
  100,
  1000
);

do $$
declare
  v_first record;
  v_concurrent record;
  v_registered record;
  v_existing record;
begin
  select * into strict v_first
  from public.claim_livepix_checkout(
    (select id from public.orders where payment_reference = 'discord:720000000000000102'),
    '73000000-0000-4000-8000-000000000001'
  );
  if not v_first.claimed or v_first.provider_reference is not null then
    raise exception 'first LivePix checkout claim was not acquired';
  end if;

  select * into strict v_concurrent
  from public.claim_livepix_checkout(
    v_first.claimed_order_id,
    '73000000-0000-4000-8000-000000000002'
  );
  if v_concurrent.claimed or v_concurrent.provider_reference is not null then
    raise exception 'concurrent LivePix checkout claim was not blocked';
  end if;

  select * into strict v_registered
  from public.register_claimed_livepix_checkout(
    v_first.claimed_order_id,
    '73000000-0000-4000-8000-000000000001',
    'quantity-provider-reference',
    'https://checkout.livepix.gg/quantity-provider-reference',
    null
  );
  if not v_registered.was_created then
    raise exception 'claimed LivePix checkout was not registered';
  end if;

  select * into strict v_existing
  from public.claim_livepix_checkout(
    v_first.claimed_order_id,
    '73000000-0000-4000-8000-000000000002'
  );
  if v_existing.claimed
    or v_existing.provider_reference <> 'quantity-provider-reference' then
    raise exception 'registered LivePix checkout was not reused';
  end if;
end
$$;

do $$
declare
  v_order public.orders%rowtype;
  v_link_count integer;
  v_reserved_count integer;
begin
  select order_row.*
  into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:720000000000000102';

  select count(*)::integer
  into v_link_count
  from public.order_inventory_units
  where order_id = v_order.id;

  select count(*)::integer
  into v_reserved_count
  from public.order_inventory_units as reservation
  join public.inventory_units as unit on unit.id = reservation.inventory_unit_id
  where reservation.order_id = v_order.id
    and unit.product_id = v_order.product_id
    and unit.status = 'reserved';

  if v_order.quantity <> 20
    or v_order.minimum_price_cents <> 5
    or v_order.sale_price_cents <> 100
    or v_link_count <> 20
    or v_reserved_count <> 20 then
    raise exception 'dynamic-price order did not reserve exactly 20 inventory units';
  end if;
end
$$;

rollback;

select 'Order quantity verification passed' as result;
