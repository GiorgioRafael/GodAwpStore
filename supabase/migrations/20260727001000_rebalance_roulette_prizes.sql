-- Rebalance the roulette prize ladder without moving the house edge.
-- The old wheel paid 0,03 or 0,05 on 61% of spins, so almost two out of three
-- spins felt like nothing, and a single slot ever beat the one-coin cost. The
-- new ladder floors every prize at 0,15 and puts three of the five slots at or
-- above one coin.
--
-- The expected return is preserved by construction: the migration measures the
-- current wheel first, then solves the jackpot weight so the new wheel lands on
-- the same expected value. The store keeps exactly the margin it had.

begin;

set local lock_timeout = '5s';

do $$
declare
  -- Price ladder the wheel should aim for, cheapest first. The floor is the
  -- 0,15 minimum; the last tier is the jackpot whose weight absorbs the
  -- rounding so the expected value matches the old wheel.
  v_targets integer[] := array[15, 50, 100, 250, 1000];
  -- Relative shape of the four non-jackpot slots.
  v_shape integer[] := array[48000, 28000, 15000, 7000];
  v_minimum_value_cents integer := 15;
  v_target_ev numeric;
  v_chosen uuid[] := array[]::uuid[];
  v_values bigint[] := array[]::bigint[];
  v_product record;
  v_target integer;
  v_index integer;
  v_weighted numeric := 0;
  v_weight_total numeric := 0;
  v_jackpot_weight integer;
  v_new_ev numeric;
begin
  -- 1. What the wheel returns today, in cents per spin.
  select sum(slot.draw_weight::numeric * product.minimum_price_cents)
       / nullif(sum(slot.draw_weight::numeric), 0)
  into v_target_ev
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  -- A fresh database has no wheel yet; fall back to the shipped house edge.
  v_target_ev := coalesce(v_target_ev, 69.365);

  -- 2. Pick one active product per price tier, never below the floor and never
  -- repeating a product. Ties go to the healthier stock, because a redeemed
  -- prize is handed over by hand.
  foreach v_target in array v_targets loop
    select product.id, product.minimum_price_cents::bigint as value_cents
    into v_product
    from public.products as product
    where product.status = 'active'
      and product.archived_at is null
      and product.minimum_price_cents >= v_minimum_value_cents
      and not (product.id = any (v_chosen))
    order by abs(product.minimum_price_cents - v_target), product.stock_quantity desc
    limit 1;

    if v_product.id is null then
      raise exception using
        errcode = 'P0014',
        message = 'The catalog has too few products above the roulette floor.';
    end if;

    v_chosen := v_chosen || v_product.id;
    v_values := v_values || v_product.value_cents;
  end loop;

  -- 3. Solve the jackpot weight so the new expected value equals the old one:
  --    (S + w*vJ) / (W + w) = EV  =>  w = (EV*W - S) / (vJ - EV)
  for v_index in 1..4 loop
    v_weighted := v_weighted + v_shape[v_index]::numeric * v_values[v_index];
    v_weight_total := v_weight_total + v_shape[v_index];
  end loop;

  if v_values[5] <= v_target_ev then
    raise exception using
      errcode = 'P0015',
      message = 'The jackpot must be worth more than the expected return.';
  end if;

  v_jackpot_weight := greatest(
    1,
    round((v_target_ev * v_weight_total - v_weighted) / (v_values[5] - v_target_ev))::integer
  );

  -- 4. Replace the wheel in place.
  delete from public.roulette_prize_products;
  for v_index in 1..5 loop
    insert into public.roulette_prize_products (prize_key, product_id, draw_weight)
    values (
      'premio_' || v_index::text,
      v_chosen[v_index],
      case when v_index = 5 then v_jackpot_weight else v_shape[v_index] end
    );
  end loop;

  -- 5. Refuse to ship a wheel that moved the house edge by more than a hundredth
  -- of a cent per spin.
  select sum(slot.draw_weight::numeric * product.minimum_price_cents)
       / nullif(sum(slot.draw_weight::numeric), 0)
  into v_new_ev
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id;

  if abs(v_new_ev - v_target_ev) > 0.01 then
    raise exception using
      errcode = 'P0016',
      message = format(
        'The rebalanced wheel returns %s cents per spin instead of %s.',
        round(v_new_ev, 4),
        round(v_target_ev, 4)
      );
  end if;

  raise notice 'Roulette rebalanced: % cents per spin (was %).',
    round(v_new_ev, 4), round(v_target_ev, 4);
end
$$;

commit;
