-- Run after migrations with a privileged local connection:
--   psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file supabase/tests/roulette_demo_verification.sql
-- Verifies the roulette coin economy: coins are bought through LivePix, a spin
-- costs exactly one coin, prizes can be sold back for the configured share, and
-- the administrator bypass stays out of reach of browser sessions.

do $$
declare
  required_table text;
  required_function text;
begin
  foreach required_table in array array[
    'roulette_demo_inventory',
    'roulette_demo_spins',
    'roulette_prize_products',
    'roulette_coin_balances',
    'roulette_coin_purchases',
    'roulette_coin_entries',
    'roulette_redemptions',
    'roulette_redemption_items'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Missing roulette table: %', required_table;
    end if;
    if not exists (
      select 1
      from pg_class
      where oid = ('public.' || required_table)::regclass
        and relrowsecurity
        and relforcerowsecurity
    ) then
      raise exception 'Roulette table % must force row level security', required_table;
    end if;
  end loop;

  foreach required_function in array array[
    'get_roulette_prizes()',
    'get_roulette_coin_balance()',
    'start_roulette_coin_purchase(text, integer)',
    'get_roulette_coin_purchase(uuid)',
    'claim_roulette_coin_checkout(uuid, uuid)',
    'register_roulette_coin_checkout(uuid, uuid, text, text)',
    'release_roulette_coin_checkout_claim(uuid, uuid)',
    'claim_roulette_coin_provider_check(uuid, integer)',
    'confirm_roulette_coin_purchase(text, text, text, integer, text, timestamptz, text)',
    'spin_roulette(text)',
    'spin_roulette_as_admin(uuid, text)',
    'sell_roulette_prizes(jsonb)',
    'redeem_roulette_prizes(jsonb)',
    'claim_roulette_redemption_ticket(uuid, uuid)',
    'complete_roulette_redemption_ticket(uuid, text)',
    'fail_roulette_redemption_ticket(uuid, text)',
    'admin_settle_roulette_redemption(uuid, text)'
  ] loop
    if to_regprocedure('public.' || required_function) is null then
      raise exception 'Missing roulette function: %', required_function;
    end if;
  end loop;
end
$$;

do $$
begin
  -- The pay-per-spin model is gone: no entry point may spin without a coin.
  if to_regprocedure('public.spin_demo_roulette(text)') is not null
    or to_regprocedure('public.spin_paid_roulette(text, uuid)') is not null then
    raise exception 'A legacy roulette spin entry point survived the coin migration';
  end if;
  if to_regclass('public.roulette_spin_charges') is not null then
    raise exception 'The per-spin charge table survived the coin migration';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.spin_roulette_as_admin(uuid, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not reach the free administrator spin';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.confirm_roulette_coin_purchase(text, text, text, integer, text, timestamptz, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not credit its own coins';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.claim_roulette_coin_checkout(uuid, uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.register_roulette_coin_checkout(uuid, uuid, text, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not forge a LivePix checkout';
  end if;

  if has_table_privilege('authenticated', 'public.roulette_coin_balances', 'SELECT')
    or has_table_privilege('authenticated', 'public.roulette_coin_balances', 'UPDATE')
    or has_table_privilege('authenticated', 'public.roulette_coin_purchases', 'INSERT')
    or has_table_privilege('authenticated', 'public.roulette_coin_entries', 'INSERT') then
    raise exception 'authenticated must reach the coin ledger only through the RPCs';
  end if;

  if not has_function_privilege('authenticated', 'public.spin_roulette(text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.sell_roulette_prizes(jsonb)', 'EXECUTE')
    or not has_function_privilege(
      'authenticated',
      'public.start_roulette_coin_purchase(text, integer)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.get_roulette_coin_balance()',
      'EXECUTE'
    ) then
    raise exception 'A player must be able to buy coins, spin and sell prizes';
  end if;

  if has_function_privilege('anon', 'public.spin_roulette(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.sell_roulette_prizes(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.redeem_roulette_prizes(jsonb)', 'EXECUTE') then
    raise exception 'The roulette must stay closed to anonymous visitors';
  end if;

  if not has_function_privilege('authenticated', 'public.redeem_roulette_prizes(jsonb)', 'EXECUTE') then
    raise exception 'A player must be able to redeem a prize';
  end if;

  -- Only the server-side worker opens or closes the delivery ticket.
  if has_function_privilege(
    'authenticated',
    'public.claim_roulette_redemption_ticket(uuid, uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_roulette_redemption_ticket(uuid, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not drive the redemption ticket directly';
  end if;

  if has_table_privilege('authenticated', 'public.roulette_redemptions', 'INSERT')
    or has_table_privilege('authenticated', 'public.roulette_redemptions', 'UPDATE')
    or has_table_privilege('anon', 'public.roulette_redemptions', 'SELECT') then
    raise exception 'Redemptions must be written only through the RPCs';
  end if;
end
$$;

do $$
declare
  v_slots integer;
begin
  select count(*) into v_slots from public.roulette_prize_products;
  if v_slots > 5 then
    raise exception 'The roulette cannot hold more than five slots, found %', v_slots;
  end if;

  if exists (
    select 1
    from public.roulette_prize_products as slot
    where slot.prize_key not in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5')
      or slot.draw_weight < 1
  ) then
    raise exception 'A roulette slot has an invalid key or weight';
  end if;

  if exists (
    select 1
    from public.roulette_prize_products as slot
    left join public.products as product on product.id = slot.product_id
    where product.id is null
  ) then
    raise exception 'A roulette slot points at a product that no longer exists';
  end if;
end
$$;

-- Structural checks alone let a spin that always raised 42702 reach production,
-- so the whole economy is exercised below against real rows.

begin;

set local client_min_messages = warning;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '9a000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'roulette-player@example.invalid',
    '',
    now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"900000000000000001"}'::jsonb,
    now(),
    now()
  ),
  (
    '9a000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'roulette-admin@example.invalid',
    '',
    now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"900000000000000002"}'::jsonb,
    now(),
    now()
  );

insert into public.admin_profiles (
  auth_user_id, discord_user_id, display_name, is_active, authorization_expires_at
) values (
  '9a000000-0000-4000-8000-000000000002',
  '900000000000000002',
  'Roulette Verification Admin',
  true,
  now() + interval '10 minutes'
);

insert into public.games (id, name, slug, status, created_by) values (
  '9c000000-0000-4000-8000-000000000001',
  'Roulette Verification Game',
  'roulette-verification-game',
  'active',
  '9a000000-0000-4000-8000-000000000002'
);
insert into public.substores (id, game_id, name, slug, title, status, created_by) values (
  '9c000000-0000-4000-8000-000000000002',
  '9c000000-0000-4000-8000-000000000001',
  'Roulette Verification Store',
  'roulette-verification-store',
  'Roulette Verification Store',
  'active',
  '9a000000-0000-4000-8000-000000000002'
);
insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status, created_by
) values (
  '9c000000-0000-4000-8000-000000000003',
  '9c000000-0000-4000-8000-000000000002',
  'Roulette Verification Prize',
  'roulette-verification-prize',
  400,
  10,
  'active',
  '9a000000-0000-4000-8000-000000000002'
);

insert into public.guilds (id, discord_guild_id, owner_discord_id, name, status) values (
  '9c000000-0000-4000-8000-000000000004',
  '401264061101899820',
  '900000000000000002',
  'Roulette Verification Guild',
  'active'
);

-- Pin the wheel to a single prize worth 4,00 coins so every assertion below is
-- exact instead of depending on the seeded catalog draw.
delete from public.roulette_prize_products;
insert into public.roulette_prize_products (prize_key, product_id, draw_weight)
values ('premio_1', '9c000000-0000-4000-8000-000000000003', 1);

select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select set_config(
  'roulette.purchase_id',
  (
    select purchase_id::text
    from public.start_roulette_coin_purchase('900000000000000001', 5)
  ),
  true
);

do $$
declare
  v_prize record;
begin
  if current_setting('roulette.purchase_id', true) is null then
    raise exception 'The player could not open a coin purchase';
  end if;

  -- The wheel shows the catalog price and the configured sale share.
  select * into v_prize from public.get_roulette_prizes();
  if v_prize.slot_value_cents <> 400 then
    raise exception 'Expected a 400 cent prize, found %', v_prize.slot_value_cents;
  end if;
  if v_prize.slot_sale_value_cents <> 200 then
    raise exception 'Expected a 200 cent sale value, found %', v_prize.slot_sale_value_cents;
  end if;

  if public.get_roulette_coin_balance() <> 0 then
    raise exception 'A new player must start with no coins';
  end if;

  begin
    perform * from public.spin_roulette('900000000000000001');
    raise exception 'A player spun the roulette without coins';
  exception
    when sqlstate 'P0007' then null;
  end;

  begin
    perform *
    from public.spin_roulette_as_admin(
      '9a000000-0000-4000-8000-000000000001',
      '900000000000000001'
    );
    raise exception 'A player reached the free administrator spin';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select *
from public.claim_roulette_coin_checkout(
  current_setting('roulette.purchase_id')::uuid,
  '9b000000-0000-4000-8000-000000000001'
);

select *
from public.register_roulette_coin_checkout(
  current_setting('roulette.purchase_id')::uuid,
  '9b000000-0000-4000-8000-000000000001',
  'roulette-coin-verification',
  'https://checkout.livepix.gg/roulette-coin-verification'
);

do $$
declare
  v_credit record;
begin
  select * into v_credit
  from public.confirm_roulette_coin_purchase(
    'roulette-coin-payment',
    'roulette-coin-proof',
    'roulette-coin-verification',
    500,
    'BRL',
    now(),
    repeat('a', 64)
  );
  if v_credit.confirmed_status <> 'credited' or not v_credit.first_confirmation then
    raise exception 'The LivePix confirmation did not credit the coins';
  end if;
  if v_credit.coin_balance_cents <> 500 then
    raise exception 'Expected a 500 cent balance, found %', v_credit.coin_balance_cents;
  end if;

  -- A webhook redelivery must not credit twice.
  select * into v_credit
  from public.confirm_roulette_coin_purchase(
    'roulette-coin-payment',
    'roulette-coin-proof',
    'roulette-coin-verification',
    500,
    'BRL',
    now(),
    repeat('a', 64)
  );
  if v_credit.first_confirmation then
    raise exception 'A replayed LivePix webhook credited the same coins twice';
  end if;
  if v_credit.coin_balance_cents <> 500 then
    raise exception 'A replayed webhook changed the balance to %', v_credit.coin_balance_cents;
  end if;
end
$$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_spin record;
  v_sale record;
begin
  select * into v_spin from public.spin_roulette('900000000000000001');
  if v_spin.won_prize_key <> 'premio_1' then
    raise exception 'The pinned wheel returned %', v_spin.won_prize_key;
  end if;
  if v_spin.won_inventory_quantity <> 1 then
    raise exception 'The first spin should leave one item, found %', v_spin.won_inventory_quantity;
  end if;
  if v_spin.coin_balance_cents <> 400 then
    raise exception 'A spin must cost exactly one coin, balance is %', v_spin.coin_balance_cents;
  end if;

  -- The same account cannot fire a second spin while the wheel is animating.
  begin
    perform * from public.spin_roulette('900000000000000001');
    raise exception 'A double click produced two spins';
  exception
    when sqlstate 'P0001' then null;
  end;

  select * into v_sale
  from public.sell_roulette_prizes('[{"prize_key":"premio_1","quantity":1}]'::jsonb);
  if v_sale.sold_total_credited_cents <> 200 then
    raise exception 'Selling must return half the value, credited %',
      v_sale.sold_total_credited_cents;
  end if;
  if v_sale.sold_item_count <> 1 then
    raise exception 'The sale settled % units', v_sale.sold_item_count;
  end if;
  if v_sale.coin_balance_cents <> 600 then
    raise exception 'Expected a 600 cent balance after the sale, found %', v_sale.coin_balance_cents;
  end if;

  begin
    perform * from public.sell_roulette_prizes('[{"prize_key":"premio_1","quantity":1}]'::jsonb);
    raise exception 'A prize was sold twice';
  exception
    when sqlstate 'P0008' then null;
  end;

  -- A selection cannot repeat the same prize twice.
  begin
    perform * from public.sell_roulette_prizes(
      '[{"prize_key":"premio_1","quantity":1},{"prize_key":"premio_1","quantity":1}]'::jsonb
    );
    raise exception 'A repeated prize was accepted in one selection';
  exception
    when sqlstate '22023' then null;
  end;
end
$$;

-- O jogador ganha outro item e pede o resgate em vez de vender.
do $$
declare
  v_spin record;
  v_redemption record;
begin
  perform pg_sleep(2.1);
  select * into v_spin from public.spin_roulette('900000000000000001');
  if v_spin.won_prize_key <> 'premio_1' then
    raise exception 'The pinned wheel returned %', v_spin.won_prize_key;
  end if;
  perform pg_sleep(2.1);
  select * into v_spin from public.spin_roulette('900000000000000001');
  if v_spin.won_inventory_quantity <> 2 then
    raise exception 'Two spins should stack to two units, found %',
      v_spin.won_inventory_quantity;
  end if;

  -- More units than the player owns is refused before anything moves.
  begin
    perform * from public.redeem_roulette_prizes(
      '[{"prize_key":"premio_1","quantity":3}]'::jsonb
    );
    raise exception 'A redemption took more units than the player owned';
  exception
    when sqlstate 'P0008' then null;
  end;

  select * into v_redemption
  from public.redeem_roulette_prizes('[{"prize_key":"premio_1","quantity":2}]'::jsonb);
  if v_redemption.redeemed_item_count <> 2 then
    raise exception 'The redemption bundled % units', v_redemption.redeemed_item_count;
  end if;
  if v_redemption.redeemed_total_value_cents <> 800 then
    raise exception 'The redemption valued the bundle at %',
      v_redemption.redeemed_total_value_cents;
  end if;
  if (
    select count(*)
    from public.roulette_redemption_items
    where redemption_id = v_redemption.created_redemption_id
  ) <> 1 then
    raise exception 'The redemption did not record one line per prize';
  end if;

  -- The prizes left the inventory, so they cannot be redeemed again.
  begin
    perform * from public.redeem_roulette_prizes(
      '[{"prize_key":"premio_1","quantity":1}]'::jsonb
    );
    raise exception 'A prize was redeemed twice';
  exception
    when sqlstate 'P0008' then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- The delivery ticket is leased exactly once.
do $$
declare
  v_redemption_id uuid;
  v_first record;
  v_second record;
begin
  select id into v_redemption_id
  from public.roulette_redemptions
  where auth_user_id = '9a000000-0000-4000-8000-000000000001'
  order by created_at desc
  limit 1;

  select * into v_first
  from public.claim_roulette_redemption_ticket(
    v_redemption_id,
    '9b000000-0000-4000-8000-000000000002'
  );
  if not v_first.claim_succeeded then
    raise exception 'The first redemption ticket lease was refused';
  end if;
  if v_first.claimed_product_name <> 'Roulette Verification Prize' then
    raise exception 'The lease returned the wrong prize';
  end if;

  select * into v_second
  from public.claim_roulette_redemption_ticket(
    v_redemption_id,
    '9b000000-0000-4000-8000-000000000003'
  );
  if v_second.claim_succeeded then
    raise exception 'Two workers leased the same redemption ticket';
  end if;

  perform public.complete_roulette_redemption_ticket(v_redemption_id, '401264061101899821');
  if (
    select discord_ticket_status
    from public.roulette_redemptions
    where id = v_redemption_id
  ) <> 'open' then
    raise exception 'The redemption ticket did not reach the open state';
  end if;
end
$$;

do $$
declare
  v_spin record;
begin
  select * into v_spin
  from public.spin_roulette_as_admin(
    '9a000000-0000-4000-8000-000000000002',
    '900000000000000002'
  );
  if v_spin.won_prize_key <> 'premio_1' then
    raise exception 'The administrator spin returned %', v_spin.won_prize_key;
  end if;
  if v_spin.coin_balance_cents <> 0 then
    raise exception 'The administrator spin must not create coins, balance is %',
      v_spin.coin_balance_cents;
  end if;
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (
    select balance_cents
    from public.roulette_coin_balances
    where auth_user_id = '9a000000-0000-4000-8000-000000000001'
  ) <> 400 then
    raise exception 'The player balance does not match the ledger path';
  end if;

  -- purchase +500, spin -100, sale +200, spin -100, spin -100 (redeemed pair).
  if (
    select count(*)
    from public.roulette_coin_entries
    where auth_user_id = '9a000000-0000-4000-8000-000000000001'
  ) <> 5 then
    raise exception 'The coin ledger did not record every movement';
  end if;

  if (
    select sum(amount_cents)
    from public.roulette_coin_entries
    where auth_user_id = '9a000000-0000-4000-8000-000000000001'
  ) <> 400 then
    raise exception 'The coin ledger does not add up to the balance';
  end if;

  if exists (
    select 1
    from public.roulette_coin_purchases
    where auth_user_id = '9a000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'The administrator spin opened a coin purchase';
  end if;
end
$$;

rollback;
