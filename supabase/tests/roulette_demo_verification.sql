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
    'roulette_redemption_items',
    'roulette_overlay_events'
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
    'spin_roulette(text, text)',
    'spin_roulette_as_admin(uuid, text, text)',
    'sell_roulette_prizes(jsonb)',
    'redeem_roulette_prizes(jsonb)',
    'claim_roulette_redemption_ticket(uuid, uuid)',
    'complete_roulette_redemption_ticket(uuid, text)',
    'fail_roulette_redemption_ticket(uuid, text)',
    'admin_settle_roulette_redemption(uuid, text)',
    'admin_roulette_metrics()',
    'admin_roulette_wheel()',
    'admin_roulette_prize_candidates()',
    'admin_save_roulette_wheel(jsonb)'
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
    'public.spin_roulette_as_admin(uuid, text, text)',
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

  if not has_function_privilege('authenticated', 'public.spin_roulette(text, text)', 'EXECUTE')
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

  if has_function_privilege('anon', 'public.spin_roulette(text, text)', 'EXECUTE')
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

-- A second product so the repointing guard has somewhere to repoint to.
insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status, created_by
) values (
  '9c000000-0000-4000-8000-000000000005',
  '9c000000-0000-4000-8000-000000000002',
  'Roulette Verification Rival',
  'roulette-verification-rival',
  15,
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
    perform * from public.spin_roulette('900000000000000001', 'Jogador Teste');
    raise exception 'A player spun the roulette without coins';
  exception
    when sqlstate 'P0007' then null;
  end;

  begin
    perform *
    from public.spin_roulette_as_admin(
      '9a000000-0000-4000-8000-000000000001',
      '900000000000000001',
      'Jogador Teste'
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
  select * into v_spin from public.spin_roulette('900000000000000001', 'Jogador Teste');
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
    perform * from public.spin_roulette('900000000000000001', 'Jogador Teste');
    raise exception 'A double click produced two spins';
  exception
    when sqlstate 'P0001' then null;
  end;

  select * into v_sale
  from public.sell_roulette_prizes('[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":1}]'::jsonb);
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
    perform * from public.sell_roulette_prizes('[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":1}]'::jsonb);
    raise exception 'A prize was sold twice';
  exception
    when sqlstate 'P0008' then null;
  end;

  -- A selection cannot repeat the same prize twice.
  begin
    perform * from public.sell_roulette_prizes(
      '[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":1},{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":1}]'::jsonb
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
  select * into v_spin from public.spin_roulette('900000000000000001', 'Jogador Teste');
  if v_spin.won_prize_key <> 'premio_1' then
    raise exception 'The pinned wheel returned %', v_spin.won_prize_key;
  end if;
  perform pg_sleep(2.1);
  select * into v_spin from public.spin_roulette('900000000000000001', 'Jogador Teste');
  if v_spin.won_inventory_quantity <> 2 then
    raise exception 'Two spins should stack to two units, found %',
      v_spin.won_inventory_quantity;
  end if;

  -- More units than the player owns is refused before anything moves.
  begin
    perform * from public.redeem_roulette_prizes(
      '[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":3}]'::jsonb
    );
    raise exception 'A redemption took more units than the player owned';
  exception
    when sqlstate 'P0008' then null;
  end;

  select * into v_redemption
  from public.redeem_roulette_prizes('[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":2}]'::jsonb);
  if v_redemption.redeemed_item_count <> 2 then
    raise exception 'The redemption bundled % units', v_redemption.redeemed_item_count;
  end if;
  if v_redemption.redeemed_total_value_cents <> 800 then
    raise exception 'The redemption valued the bundle at %',
      v_redemption.redeemed_total_value_cents;
  end if;
  -- The prizes left the inventory, so they cannot be redeemed again.
  begin
    perform * from public.redeem_roulette_prizes(
      '[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":1}]'::jsonb
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
  if v_first.claimed_item_summary <> '2x Roulette Verification Prize' then
    raise exception 'The lease summarised the bundle as %', v_first.claimed_item_summary;
  end if;
  if v_first.claimed_total_value_cents <> 800 then
    raise exception 'The lease valued the bundle at %', v_first.claimed_total_value_cents;
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
    '900000000000000002',
    'Admin Teste'
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

  -- The public overlay feed may never carry a full player name.
  if exists (
    select 1
    from public.roulette_overlay_events as event
    where event.masked_display_name like '%Jogador%'
      or event.masked_display_name like '%Admin%'
      or char_length(event.masked_display_name) > 6
  ) then
    raise exception 'The overlay feed leaked a player name';
  end if;

  if (select count(*) from public.roulette_overlay_events) < 1 then
    raise exception 'The spins did not reach the overlay feed';
  end if;

  -- One redemption line per prize, carrying both units.
  if (
    select count(*)
    from public.roulette_redemption_items as line
    join public.roulette_redemptions as redemption on redemption.id = line.redemption_id
    where redemption.auth_user_id = '9a000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'The redemption did not record one line per prize';
  end if;

  if (
    select sum(line.quantity)
    from public.roulette_redemption_items as line
    join public.roulette_redemptions as redemption on redemption.id = line.redemption_id
    where redemption.auth_user_id = '9a000000-0000-4000-8000-000000000001'
  ) <> 2 then
    raise exception 'The redemption lines do not add up to the redeemed units';
  end if;
end
$$;

-- The panel is admin-only, and its split has to close on the spins.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  begin
    perform * from public.admin_roulette_metrics();
    raise exception 'A player read the roulette metrics';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_metrics record;
begin
  select * into v_metrics from public.admin_roulette_metrics();

  -- One 5,00 recharge, taxed at the configured share.
  if v_metrics.deposit_gross_cents <> 500 or v_metrics.deposit_count <> 1 then
    raise exception 'The metrics counted % cents in % deposit(s)',
      v_metrics.deposit_gross_cents, v_metrics.deposit_count;
  end if;
  if v_metrics.provider_fee_cents <> (500 * v_metrics.fee_bps) / 10000 then
    raise exception 'The provider fee does not follow the configured rate';
  end if;

  -- The player spun three times; the free administrator spin is internal
  -- testing and may not reach a single number on the panel.
  if v_metrics.spin_count <> 3 or v_metrics.spinner_count <> 1 then
    raise exception 'The metrics saw % spin(s) from % player(s)',
      v_metrics.spin_count, v_metrics.spinner_count;
  end if;
  if v_metrics.coins_spent_cents <> 300 then
    raise exception 'The paid spins consumed % cents', v_metrics.coins_spent_cents;
  end if;
  -- The prize is pinned at 4,00, so the value is frozen even after a rebalance.
  -- 1600 would mean the administrator prize leaked into the total.
  if v_metrics.awarded_value_cents <> 1200 then
    raise exception 'The metrics awarded % cents', v_metrics.awarded_value_cents;
  end if;

  -- Every prize a spin created has to land in exactly one bucket.
  if v_metrics.sold_unit_count + v_metrics.redeemed_unit_count + v_metrics.held_unit_count
    <> v_metrics.spin_count then
    raise exception 'The prize split does not close: % sold, % redeemed, % held for % spin(s)',
      v_metrics.sold_unit_count, v_metrics.redeemed_unit_count,
      v_metrics.held_unit_count, v_metrics.spin_count;
  end if;
  -- The administrator still holds the prize from the free spin, so a held count
  -- of 1 would mean the inventory filter is missing.
  if v_metrics.sold_unit_count <> 1
    or v_metrics.redeemed_unit_count <> 2
    or v_metrics.held_unit_count <> 0 then
    raise exception 'Expected 1 sold, 2 redeemed and 0 held, found %, % and %',
      v_metrics.sold_unit_count, v_metrics.redeemed_unit_count, v_metrics.held_unit_count;
  end if;
  if v_metrics.sold_credited_cents <> 200 then
    raise exception 'The resale credited % cents', v_metrics.sold_credited_cents;
  end if;

  -- Nothing was handed over yet, so no cost of goods has landed.
  if v_metrics.delivered_unit_count <> 0 or v_metrics.delivered_cost_cents <> 0 then
    raise exception 'The metrics delivered % unit(s) costing % cents',
      v_metrics.delivered_unit_count, v_metrics.delivered_cost_cents;
  end if;
  if v_metrics.pending_redemption_count <> 1 then
    raise exception 'The redemption queue holds % request(s)',
      v_metrics.pending_redemption_count;
  end if;
  if v_metrics.net_profit_cents <> 500 - v_metrics.provider_fee_cents then
    raise exception 'The net profit is % cents', v_metrics.net_profit_cents;
  end if;

  -- Coins still in wallets are a liability, never profit.
  if v_metrics.coin_liability_cents <> 400 then
    raise exception 'The wallets hold % cents', v_metrics.coin_liability_cents;
  end if;

  -- The cost of goods is the listed price taken back through the markup.
  if v_metrics.pending_cost_cents <> (800 * 10000) / (10000 + v_metrics.markup_bps) then
    raise exception 'The pending cost of % cents ignores the markup',
      v_metrics.pending_cost_cents;
  end if;
  if v_metrics.held_value_cents <> 0 or v_metrics.held_cost_cents <> 0 then
    raise exception 'The administrator inventory reached the panel: % cents at % cost',
      v_metrics.held_value_cents, v_metrics.held_cost_cents;
  end if;
end
$$;

-- An administrator whose authorization lapsed was still testing, not playing.
-- The fixture is written with the session role, like the setup at the top:
-- service_role cannot insert into auth.users.
reset role;
select set_config('request.jwt.claims', '', true);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9a000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'roulette-former-admin@example.invalid',
  '',
  now(),
  '{"provider":"discord","providers":["discord"]}'::jsonb,
  '{"sub":"900000000000000003"}'::jsonb,
  now(),
  now()
);

insert into public.admin_profiles (
  auth_user_id, discord_user_id, display_name, is_active, authorization_expires_at
) values (
  '9a000000-0000-4000-8000-000000000003',
  '900000000000000003',
  'Roulette Verification Former Admin',
  false,
  now() - interval '1 day'
);

insert into public.roulette_demo_spins (auth_user_id, discord_user_id, prize_key, prize_value_cents)
values ('9a000000-0000-4000-8000-000000000003', '900000000000000003', 'premio_1', 400);

insert into public.roulette_demo_inventory (
  auth_user_id, discord_user_id, prize_key, product_id, unit_value_cents, quantity
) values (
  '9a000000-0000-4000-8000-000000000003',
  '900000000000000003',
  'premio_1',
  '9c000000-0000-4000-8000-000000000003',
  400,
  1
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_metrics record;
begin
  select * into v_metrics from public.admin_roulette_metrics();

  if v_metrics.spin_count <> 3
    or v_metrics.awarded_value_cents <> 1200
    or v_metrics.held_unit_count <> 0 then
    raise exception 'A lapsed administrator moved the panel: % spin(s), % cents, % held',
      v_metrics.spin_count, v_metrics.awarded_value_cents, v_metrics.held_unit_count;
  end if;
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- The resale rounds half up, and a held prize keeps the product and the price
-- it was won at no matter what happens to the catalog afterwards.
do $$
declare
  v_held record;
begin
  -- Flooring turned the 15 cent prize into 7 cents while the store advertised
  -- half of the value. Every rung of the real ladder is checked.
  if private.roulette_sale_credit(15, 5000) <> 8 then
    raise exception 'A 15 cent prize credits % cents', private.roulette_sale_credit(15, 5000);
  end if;
  if private.roulette_sale_credit(50, 5000) <> 25
    or private.roulette_sale_credit(100, 5000) <> 50
    or private.roulette_sale_credit(250, 5000) <> 125
    or private.roulette_sale_credit(1000, 5000) <> 500 then
    raise exception 'The resale no longer pays half of an even price';
  end if;
  -- 25 cents at 50% is 12,5 and has to round up, not down.
  if private.roulette_sale_credit(25, 5000) <> 13 then
    raise exception 'The resale rounds 12,5 cents down';
  end if;
  if private.roulette_sale_credit(0, 5000) <> 0 then
    raise exception 'A worthless prize credits coins';
  end if;

  -- The administrator still holds the prize from the free spin.
  select item.*
  into v_held
  from public.roulette_demo_inventory as item
  where item.auth_user_id = '9a000000-0000-4000-8000-000000000002';

  if v_held.product_id <> '9c000000-0000-4000-8000-000000000003'
    or v_held.unit_value_cents <> 400 then
    raise exception 'The spin did not freeze the product and the price: % at % cents',
      v_held.product_id, v_held.unit_value_cents;
  end if;

  -- Editing the catalog price must not reprice what somebody already owns.
  update public.products
  set minimum_price_cents = 999
  where id = '9c000000-0000-4000-8000-000000000003';

  if (
    select item.unit_value_cents
    from public.roulette_demo_inventory as item
    where item.auth_user_id = '9a000000-0000-4000-8000-000000000002'
  ) <> 400 then
    raise exception 'A catalog price edit reached a prize already won';
  end if;

  update public.products
  set minimum_price_cents = 400
  where id = '9c000000-0000-4000-8000-000000000003';
end
$$;

-- Pedir o resgate não mexe no catálogo: a unidade sai na entrega.
do $$
begin
  if (
    select product.stock_quantity
    from public.products as product
    where product.id = '9c000000-0000-4000-8000-000000000003'
  ) <> 10 then
    raise exception 'The pending redemption already took units out of the catalog';
  end if;
end
$$;

-- Cancelar devolve o prêmio ao jogador e não toca no estoque.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_redemption_id uuid;
begin
  select redemption.id
  into v_redemption_id
  from public.roulette_redemptions as redemption
  where redemption.auth_user_id = '9a000000-0000-4000-8000-000000000001'
    and redemption.status = 'pending'
  limit 1;

  perform * from public.admin_settle_roulette_redemption(v_redemption_id, 'cancelled');
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (
    select product.stock_quantity
    from public.products as product
    where product.id = '9c000000-0000-4000-8000-000000000003'
  ) <> 10 then
    raise exception 'Cancelling moved the catalog stock';
  end if;

  -- E o prêmio voltou para o inventário, com o produto e o preço do ticket.
  if (
    select item.quantity
    from public.roulette_demo_inventory as item
    where item.auth_user_id = '9a000000-0000-4000-8000-000000000001'
      and item.product_id = '9c000000-0000-4000-8000-000000000003'
      and item.unit_value_cents = 400
  ) <> 2 then
    raise exception 'The cancelled prize did not go back to the inventory';
  end if;

  update public.products
  set stock_quantity = 0
  where id = '9c000000-0000-4000-8000-000000000003';
end
$$;

-- Sem estoque, o resgate é recusado antes de mover qualquer prêmio.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  begin
    perform * from public.redeem_roulette_prizes(
      '[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":1}]'::jsonb
    );
    raise exception 'The roulette promised an item with no stock';
  exception
    when sqlstate 'P0016' then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (
    select item.quantity
    from public.roulette_demo_inventory as item
    where item.auth_user_id = '9a000000-0000-4000-8000-000000000001'
  ) <> 2 then
    raise exception 'The refused redemption still took the prize from the inventory';
  end if;

  update public.products
  set stock_quantity = 10
  where id = '9c000000-0000-4000-8000-000000000003';
end
$$;

-- Um novo pedido, agora para exercitar a entrega.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  perform * from public.redeem_roulette_prizes(
    '[{"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","unit_value_cents":400,"quantity":2}]'::jsonb
  );
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- O estoque cai entre o pedido e a entrega: a entrega tem que ser recusada.
update public.products
set stock_quantity = 1
where id = '9c000000-0000-4000-8000-000000000003';

select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_redemption_id uuid;
begin
  select redemption.id
  into v_redemption_id
  from public.roulette_redemptions as redemption
  where redemption.auth_user_id = '9a000000-0000-4000-8000-000000000001'
    and redemption.status = 'pending'
  limit 1;

  begin
    perform * from public.admin_settle_roulette_redemption(v_redemption_id, 'delivered');
    raise exception 'A delivery went through with only one unit left';
  exception
    when sqlstate 'P0016' then null;
  end;

  if (
    select redemption.status
    from public.roulette_redemptions as redemption
    where redemption.id = v_redemption_id
  ) <> 'pending' then
    raise exception 'The refused delivery still settled the redemption';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

update public.products
set stock_quantity = 10
where id = '9c000000-0000-4000-8000-000000000003';

select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_redemption_id uuid;
begin
  select redemption.id
  into v_redemption_id
  from public.roulette_redemptions as redemption
  where redemption.auth_user_id = '9a000000-0000-4000-8000-000000000001'
    and redemption.status = 'pending'
  limit 1;

  perform * from public.admin_settle_roulette_redemption(v_redemption_id, 'delivered');
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  -- Entregar é o que tira a unidade do catálogo.
  if (
    select product.stock_quantity
    from public.products as product
    where product.id = '9c000000-0000-4000-8000-000000000003'
  ) <> 8 then
    raise exception 'The delivery did not take the units out of the catalog';
  end if;

  -- E a movimentação ficou registrada com o administrador que entregou.
  if not exists (
    select 1
    from public.audit_events as event
    where event.entity_type = 'product'
      and event.actor_auth_user_id = '9a000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'The stock movement was not attributed to the administrator';
  end if;
end
$$;

-- Repointing a slot somebody holds units of is the administrator's to make, and
-- it must not touch a single thing already won. The guard that refused this had
-- to exist while the inventory row was keyed by the slot; now the row is keyed
-- by the item, so there is nothing left to protect and refusing only cost the
-- store the ability to run its own wheel.
do $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select jsonb_agg(jsonb_build_array(item.id, item.product_id, item.unit_value_cents, item.quantity)
                   order by item.id)
  into v_before
  from public.roulette_demo_inventory as item
  where item.prize_key = 'premio_1';

  if v_before is null then
    raise exception 'The fixture holds no premio_1 units, so this proves nothing';
  end if;

  update public.roulette_prize_products
  set product_id = '9c000000-0000-4000-8000-000000000005'
  where prize_key = 'premio_1';
  -- The old guard was a deferred constraint trigger: it only fired when the
  -- work was about to become permanent, so the check has to reach that point.
  set constraints all immediate;

  select jsonb_agg(jsonb_build_array(item.id, item.product_id, item.unit_value_cents, item.quantity)
                   order by item.id)
  into v_after
  from public.roulette_demo_inventory as item
  where item.prize_key = 'premio_1';

  if v_after is distinct from v_before then
    raise exception 'Repointing a slot rewrote what its holders own: % -> %', v_before, v_after;
  end if;

  -- Put it back so the assertions further down still describe the same wheel.
  update public.roulette_prize_products
  set product_id = '9c000000-0000-4000-8000-000000000003'
  where prize_key = 'premio_1';
  set constraints all immediate;
end
$$;

-- And the guard is actually gone, not merely unreachable.
do $$
begin
  if to_regprocedure('private.assert_roulette_inventory_intact()') is not null then
    raise exception 'The inventory guard survived the migration';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'roulette_prize_products_keep_inventory'
  ) then
    raise exception 'The deferred constraint trigger survived the migration';
  end if;
end
$$;

-- Uma décima fatia tem que atravessar toda constraint. Enumerá-las por chave
-- fazia o giro nela morrer com 23514, e trancava o prêmio de quem já tinha
-- ganho numa fatia depois removida.
select set_config('request.jwt.claims', '', true);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status, created_by
) values (
  '9c000000-0000-4000-8000-000000000006',
  '9c000000-0000-4000-8000-000000000002',
  'Roulette Verification Tenth',
  'roulette-verification-tenth',
  800,
  10,
  'active',
  '9a000000-0000-4000-8000-000000000002'
);

insert into public.roulette_prize_products (prize_key, product_id, draw_weight)
values ('premio_10', '9c000000-0000-4000-8000-000000000006', 3);

insert into public.roulette_demo_spins (auth_user_id, discord_user_id, prize_key, prize_value_cents)
values ('9a000000-0000-4000-8000-000000000002', '900000000000000002', 'premio_10', 800);

insert into public.roulette_demo_inventory (
  auth_user_id, discord_user_id, prize_key, product_id, unit_value_cents, quantity
) values (
  '9a000000-0000-4000-8000-000000000002',
  '900000000000000002',
  'premio_10',
  '9c000000-0000-4000-8000-000000000006',
  800,
  1
);

insert into public.roulette_overlay_events (
  prize_key, product_name, value_cents, masked_display_name, is_top_prize
) values ('premio_10', 'Décimo', 800, 'Tes...', false);

-- E o editor tem que carregar. Um tipo declarado errado na saída derruba a
-- função inteira, e a página some com o editor sem dizer o motivo.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_slot record;
  v_count integer := 0;
  v_chance_total integer := 0;
  v_previous integer := 0;
begin
  for v_slot in select * from public.admin_roulette_wheel() loop
    v_count := v_count + 1;
    v_chance_total := v_chance_total + v_slot.slot_draw_chance_bps;

    if v_slot.slot_prize_key is null or v_slot.slot_draw_weight < 1 then
      raise exception 'The wheel returned a slot with no key or no weight';
    end if;

    -- premio_10 vem depois de premio_1 em ordem de texto, e a rotação mira
    -- pela posição: fora de ordem, a roda para na fatia errada.
    if (substring(v_slot.slot_prize_key from '\d+'))::integer <= v_previous then
      raise exception 'The wheel came back out of order at %', v_slot.slot_prize_key;
    end if;
    v_previous := (substring(v_slot.slot_prize_key from '\d+'))::integer;
  end loop;

  if v_count <> 2 then
    raise exception 'The wheel returned % slot(s), expected the pinned one plus the tenth', v_count;
  end if;
  if v_chance_total > 10000 then
    raise exception 'The slot chances add up to more than the whole wheel: %', v_chance_total;
  end if;

  if (select count(*) from public.admin_roulette_prize_candidates()) < 1 then
    raise exception 'No product can be put on the wheel';
  end if;
end
$$;

do $$
begin
  -- E onze fatias não existem.
  begin
    perform * from public.admin_save_roulette_wheel(
      (
        select jsonb_agg(
          jsonb_build_object(
            'prize_key', 'premio_' || step,
            'product_id', '9c000000-0000-4000-8000-000000000003',
            'draw_weight', 1
          )
        )
        from generate_series(1, 11) as step
      )
    );
    raise exception 'The wheel accepted eleven slots';
  exception
    when sqlstate '22023' then null;
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- O pedido do dono, provado de ponta a ponta: o admin troca e remove o que
-- quiser, e quem já ganhou recebe exatamente o que ganhou.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status, created_by
) values
  (
    '9c000000-0000-4000-8000-000000000007',
    '9c000000-0000-4000-8000-000000000002',
    'Item Antigo',
    'item-antigo',
    900,
    10,
    'active',
    '9a000000-0000-4000-8000-000000000002'
  ),
  (
    '9c000000-0000-4000-8000-000000000008',
    '9c000000-0000-4000-8000-000000000002',
    'Item Novo',
    'item-novo',
    100,
    10,
    'active',
    '9a000000-0000-4000-8000-000000000002'
  );

insert into public.roulette_prize_products (prize_key, product_id, draw_weight)
values ('premio_9', '9c000000-0000-4000-8000-000000000007', 1);

-- O jogador ganhou duas unidades do Item Antigo por 9,00 cada.
insert into public.roulette_demo_inventory (
  auth_user_id, discord_user_id, prize_key, product_id, unit_value_cents, quantity
) values (
  '9a000000-0000-4000-8000-000000000001',
  '900000000000000001',
  'premio_9',
  '9c000000-0000-4000-8000-000000000007',
  900,
  2
);

-- O admin reescreve a roda inteira: premio_9 passa a valer outro item e
-- premio_10 sai da roda de vez, ambos com prêmio na mão de gente.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_saved record;
begin
  select * into v_saved
  from public.admin_save_roulette_wheel(
    '[
      {"prize_key":"premio_1","product_id":"9c000000-0000-4000-8000-000000000003","draw_weight":1},
      {"prize_key":"premio_9","product_id":"9c000000-0000-4000-8000-000000000008","draw_weight":1}
    ]'::jsonb
  );

  if v_saved.saved_slot_count <> 2 then
    raise exception 'The wheel saved % slot(s), expected 2', v_saved.saved_slot_count;
  end if;
  if exists (select 1 from public.roulette_prize_products where prize_key = 'premio_10') then
    raise exception 'The removed slot is still on the wheel';
  end if;
end
$$;

reset role;

-- Nada do que foi ganho se mexeu.
do $$
declare
  v_item public.roulette_demo_inventory%rowtype;
begin
  select * into v_item
  from public.roulette_demo_inventory as item
  where item.auth_user_id = '9a000000-0000-4000-8000-000000000001'
    and item.prize_key = 'premio_9';

  if not found
    or v_item.product_id <> '9c000000-0000-4000-8000-000000000007'
    or v_item.unit_value_cents <> 900
    or v_item.quantity <> 2 then
    raise exception 'Repointing premio_9 changed what the player owns: %', v_item;
  end if;

  -- E a fatia removida não levou o prêmio de ninguém junto.
  select * into v_item
  from public.roulette_demo_inventory as item
  where item.auth_user_id = '9a000000-0000-4000-8000-000000000002'
    and item.prize_key = 'premio_10';

  if not found
    or v_item.product_id <> '9c000000-0000-4000-8000-000000000006'
    or v_item.unit_value_cents <> 800 then
    raise exception 'Removing premio_10 took the prize with it: %', v_item;
  end if;
end
$$;

-- A tela do jogador tem que receber o item congelado, não a fatia de hoje.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_row record;
  v_rate integer;
begin
  select coalesce(settings.roulette_sale_rate_bps, 5000)
  into v_rate
  from public.platform_settings as settings
  where settings.id = 1;

  select * into v_row
  from public.get_demo_roulette_inventory()
  where prize_key = 'premio_9';

  if not found then
    raise exception 'The inventory RPC dropped the prize';
  end if;
  if v_row.product_id <> '9c000000-0000-4000-8000-000000000007'
    or v_row.product_name <> 'Item Antigo'
    or v_row.unit_value_cents <> 900 then
    raise exception 'The inventory RPC described the slot instead of the prize: %', v_row;
  end if;
  -- O botão promete o mesmo número que a venda credita.
  if v_row.unit_sale_value_cents <> (900 * v_rate + 5000) / 10000 then
    raise exception 'The quoted resale % is not what the sale pays', v_row.unit_sale_value_cents;
  end if;
end
$$;

-- Resgatar entrega o item que foi ganho, pelo valor de quando foi ganho.
do $$
declare
  v_redemption record;
  v_line record;
begin
  select * into v_redemption
  from public.redeem_roulette_prizes(
    '[{"prize_key":"premio_9","product_id":"9c000000-0000-4000-8000-000000000007","unit_value_cents":900,"quantity":1}]'::jsonb
  );

  select * into v_line
  from public.roulette_redemption_items as line
  where line.redemption_id = v_redemption.created_redemption_id;

  if v_line.product_id <> '9c000000-0000-4000-8000-000000000007'
    or v_line.product_name <> 'Item Antigo'
    or v_line.value_cents <> 900 then
    raise exception 'The ticket promised the new slot item instead of the prize: %', v_line;
  end if;
end
$$;

-- Duas identidades convivem na mesma fatia, e vender uma não some com a outra.
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.roulette_demo_inventory (
  auth_user_id, discord_user_id, prize_key, product_id, unit_value_cents, quantity
) values (
  '9a000000-0000-4000-8000-000000000001',
  '900000000000000001',
  'premio_9',
  '9c000000-0000-4000-8000-000000000008',
  100,
  1
);

-- Um giro na fatia trocada abre a segunda linha em vez de engordar a primeira.
-- A roda fica com uma fatia só para o giro ser determinístico.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select * from public.admin_save_roulette_wheel(
  '[{"prize_key":"premio_9","product_id":"9c000000-0000-4000-8000-000000000008","draw_weight":1}]'::jsonb
);

reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  v_spin record;
  v_antigo integer;
  v_novo integer;
begin
  select * into v_spin
  from public.spin_roulette_as_admin(
    '9a000000-0000-4000-8000-000000000001',
    '900000000000000001',
    'Jogador Teste'
  );

  select item.quantity into v_antigo
  from public.roulette_demo_inventory as item
  where item.auth_user_id = '9a000000-0000-4000-8000-000000000001'
    and item.prize_key = 'premio_9'
    and item.product_id = '9c000000-0000-4000-8000-000000000007';

  select item.quantity into v_novo
  from public.roulette_demo_inventory as item
  where item.auth_user_id = '9a000000-0000-4000-8000-000000000001'
    and item.prize_key = 'premio_9'
    and item.product_id = '9c000000-0000-4000-8000-000000000008';

  -- Uma unidade foi resgatada, então a linha antiga tem que estar em 1 e
  -- intocada: só a linha do item que saiu agora pode ter mudado.
  if coalesce(v_antigo, 0) <> 1 then
    raise exception 'A spin merged the old prize into the new one: % un.', v_antigo;
  end if;
  if v_spin.won_prize_key <> 'premio_9'
    or v_spin.won_product_id <> '9c000000-0000-4000-8000-000000000008'
    or v_spin.won_unit_value_cents <> 100 then
    raise exception 'The spin did not freeze the slot it landed on: %', v_spin;
  end if;
  -- Duas unidades do item novo: a que foi semeada e a que acabou de sair.
  if coalesce(v_novo, 0) <> 2 then
    raise exception 'The spin opened % unit(s) on the new item, expected 2', v_novo;
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_sale record;
  v_rate integer;
  v_antigo record;
begin
  select coalesce(settings.roulette_sale_rate_bps, 5000)
  into v_rate
  from public.platform_settings as settings
  where settings.id = 1;

  select * into v_sale
  from public.sell_roulette_prizes(
    '[{"prize_key":"premio_9","product_id":"9c000000-0000-4000-8000-000000000008","unit_value_cents":100,"quantity":1}]'::jsonb
  );

  if v_sale.sold_total_credited_cents <> (100 * v_rate + 5000) / 10000 then
    raise exception 'The sale paid % for the cheap prize', v_sale.sold_total_credited_cents;
  end if;

  select * into v_antigo
  from public.roulette_demo_inventory as item
  where item.auth_user_id = '9a000000-0000-4000-8000-000000000001'
    and item.prize_key = 'premio_9'
    and item.product_id = '9c000000-0000-4000-8000-000000000007';

  if not found or v_antigo.unit_value_cents <> 900 or v_antigo.quantity <> 1 then
    raise exception 'Selling one item on the slot damaged the other: %', v_antigo;
  end if;
  if not exists (
    select 1
    from public.roulette_demo_inventory as item
    where item.auth_user_id = '9a000000-0000-4000-8000-000000000001'
      and item.prize_key = 'premio_9'
      and item.product_id = '9c000000-0000-4000-8000-000000000008'
      and item.quantity = 1
  ) then
    raise exception 'The sale did not leave the second unit of the new item';
  end if;
end
$$;

-- Vender um prêmio de fatia que não existe mais tem que funcionar: é do jogador.
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $$
declare
  v_sale record;
  v_rate integer;
begin
  select coalesce(settings.roulette_sale_rate_bps, 5000)
  into v_rate
  from public.platform_settings as settings
  where settings.id = 1;

  select * into v_sale
  from public.sell_roulette_prizes(
    '[{"prize_key":"premio_10","product_id":"9c000000-0000-4000-8000-000000000006","unit_value_cents":800,"quantity":1}]'::jsonb
  );

  if v_sale.sold_total_credited_cents <> (800 * v_rate + 5000) / 10000 then
    raise exception 'A prize from a retired slot paid %', v_sale.sold_total_credited_cents;
  end if;
end
$$;

-- E a entrega baixa o estoque do item que foi ganho, não o do item novo.
set local role authenticated;

do $$
declare
  v_redemption_id uuid;
  v_antigo bigint;
  v_novo bigint;
begin
  select redemption.id
  into v_redemption_id
  from public.roulette_redemptions as redemption
  join public.roulette_redemption_items as line on line.redemption_id = redemption.id
  where line.product_id = '9c000000-0000-4000-8000-000000000007'
    and redemption.status = 'pending'
  limit 1;

  if v_redemption_id is null then
    raise exception 'The redemption of the old prize was not found';
  end if;

  perform * from public.admin_settle_roulette_redemption(v_redemption_id, 'delivered');

  select stock_quantity into v_antigo
  from public.products where id = '9c000000-0000-4000-8000-000000000007';
  select stock_quantity into v_novo
  from public.products where id = '9c000000-0000-4000-8000-000000000008';

  if v_antigo <> 9 then
    raise exception 'Delivery took % from the prize the player won, expected 1', 10 - v_antigo;
  end if;
  if v_novo <> 10 then
    raise exception 'Delivery took stock from the item the slot points at today';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

rollback;
