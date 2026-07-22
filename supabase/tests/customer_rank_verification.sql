-- Customer spend, discount eligibility, LivePix exclusions and rank checkout.
-- Every fixture is rolled back.

begin;

set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label)
values ('91000000-0000-4000-8000-000000000001', '910000000000000001', 'Rank seller');

insert into public.games (id, name, slug, status)
values ('92000000-0000-4000-8000-000000000001', 'Rank Game', 'rank-game', 'active');

insert into public.substores (
  id, game_id, name, slug, title, description, status
)
values (
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'Rank Store',
  'rank-store',
  'Rank Store',
  'Customer rank verification fixture.',
  'active'
);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status
)
values
  (
    '94000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    'Rank Product',
    'rank-product',
    10000,
    10,
    'active'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000001',
    'Rank Cart Product',
    'rank-cart-product',
    5000,
    10,
    'active'
  );

insert into public.guilds (
  id, discord_guild_id, owner_discord_id, whitelist_entry_id, name, status
)
values (
  '95000000-0000-4000-8000-000000000001',
  '950000000000000001',
  '910000000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Rank Guild',
  'active'
);

-- R$ 120,00 confirmed and valid: Prata III with 2%.
insert into public.orders (
  id,
  guild_id,
  seller_whitelist_entry_id,
  product_id,
  buyer_discord_id,
  quantity,
  status,
  subtotal_price_cents,
  sale_price_cents,
  minimum_price_cents,
  commission_bps,
  payment_reference,
  payment_status,
  paid_at
)
values (
  '96000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '970000000000000001',
  1,
  'paid',
  12000,
  12000,
  12000,
  1000,
  'rank-fixture-paid',
  'paid',
  now()
);

-- A paid webhook arriving after cancellation must not increase the rank.
insert into public.orders (
  id,
  guild_id,
  seller_whitelist_entry_id,
  product_id,
  buyer_discord_id,
  quantity,
  status,
  subtotal_price_cents,
  sale_price_cents,
  minimum_price_cents,
  commission_bps,
  payment_reference,
  payment_status,
  payment_expires_at,
  stock_released_at,
  stock_release_reason,
  paid_at,
  cancelled_at,
  created_at
)
values (
  '96000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '970000000000000001',
  1,
  'cancelled',
  500000,
  500000,
  500000,
  1000,
  'rank-fixture-late-payment',
  'paid',
  now() - interval '1 hour',
  now(),
  'payment_timeout',
  now(),
  now(),
  now() - interval '2 hours'
);

do $$
declare
  progress record;
  created record;
  cart record;
  order_row public.orders%rowtype;
  first_claim uuid := '99000000-0000-4000-8000-000000000001';
  second_claim uuid := '99000000-0000-4000-8000-000000000002';
begin
  if not public.claim_customer_rank_role_sync(
    '95000000-0000-4000-8000-000000000001',
    first_claim
  ) then
    raise exception 'first customer rank role lease was not granted';
  end if;
  if public.claim_customer_rank_role_sync(
    '95000000-0000-4000-8000-000000000001',
    second_claim
  ) then
    raise exception 'concurrent customer rank role lease was granted';
  end if;
  if not public.release_customer_rank_role_sync(
    '95000000-0000-4000-8000-000000000001',
    first_claim,
    true,
    null
  ) or not public.claim_customer_rank_role_sync(
    '95000000-0000-4000-8000-000000000001',
    second_claim
  ) then
    raise exception 'customer rank role lease was not reusable after release';
  end if;
  perform public.release_customer_rank_role_sync(
    '95000000-0000-4000-8000-000000000001',
    second_claim,
    true,
    null
  );

  select * into strict progress
  from public.get_customer_rank_progress(
    '95000000-0000-4000-8000-000000000001',
    '970000000000000001'
  );

  if progress.total_spent_cents <> 12000
    or progress.current_rank_code <> 'prata_iii'
    or progress.current_rank_discount_bps <> 200
    or progress.next_rank_code <> 'ouro_i'
    or progress.amount_to_next_rank_cents <> 13000 then
    raise exception 'customer rank progress did not use only valid paid sales';
  end if;

  select * into strict created
  from public.create_ranked_bot_order_with_reservation(
    '980000000000000001',
    '95000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    '970000000000000001',
    1,
    10000,
    9800,
    200,
    200,
    'customer_rank',
    1000
  );

  select * into strict order_row
  from public.orders
  where id = created.created_order_id;

  if not created.was_created
    or order_row.sale_price_cents <> 9800
    or order_row.discount_reason <> 'customer_rank' then
    raise exception 'eligible rank discount was not snapshotted on the order';
  end if;

  select * into strict cart
  from public.create_ranked_bot_cart_with_reservation(
    '980000000000000002',
    '95000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '970000000000000001',
    '[{"product_id":"94000000-0000-4000-8000-000000000001","quantity":1},{"product_id":"94000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    200,
    'customer_rank',
    1000
  );

  select * into strict order_row
  from public.orders
  where id = cart.checkout_order_id;

  if not cart.was_created
    or order_row.subtotal_price_cents <> 15000
    or order_row.sale_price_cents <> 14700
    or order_row.discount_reason <> 'customer_rank' then
    raise exception 'eligible rank discount was not applied to the cart total';
  end if;
end
$$;

do $$
begin
  begin
    perform *
    from public.create_ranked_bot_order_with_reservation(
      '980000000000000003',
      '95000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      '970000000000000001',
      1,
      10000,
      9000,
      1000,
      1000,
      'customer_rank',
      1000
    );
    raise exception 'ineligible Diamond discount was accepted for a Prata customer';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

rollback;

select 'Customer rank checks passed' as result;
