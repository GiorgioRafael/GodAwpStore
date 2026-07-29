-- Let the panel own the wheel.
--
-- Which product sits in each slot and how often it comes up lived only in
-- migrations, so tuning the roulette meant writing SQL and deploying. The two
-- numbers that decide whether it is worth running — the payout and the margin —
-- were not visible anywhere while making that decision.
--
-- The wheel is now editable from the admin panel, with the same guards the
-- migrations enforced by hand: a live product, a positive weight, and no
-- repointing a slot whose prize somebody is still holding.

begin;

set local lock_timeout = '5s';

alter table public.platform_settings
  add column if not exists roulette_enabled boolean not null default true;

comment on column public.platform_settings.roulette_enabled is
  'Kill switch for the roulette. Spinning stops; inventories, redemptions and balances are untouched.';

/** Every slot as the panel needs it, with the odds already worked out. */
create or replace function public.admin_roulette_wheel()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_value_cents bigint,
  slot_stock_quantity integer,
  slot_draw_weight integer,
  slot_draw_chance_bps integer,
  slot_held_units bigint,
  slot_archived boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_total_weight bigint;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  select coalesce(sum(slot.draw_weight), 0)
  into v_total_weight
  from public.roulette_prize_products as slot;

  return query
  select
    slot.prize_key,
    product.id,
    coalesce(product.name, 'Produto removido'),
    coalesce(product.minimum_price_cents, 0)::bigint,
    coalesce(product.stock_quantity, 0),
    slot.draw_weight,
    case
      when v_total_weight > 0 then ((slot.draw_weight::bigint * 10000) / v_total_weight)::integer
      else 0
    end,
    coalesce(
      (
        select sum(item.quantity)
        from public.roulette_demo_inventory as item
        where item.prize_key = slot.prize_key
      ),
      0
    )::bigint,
    product.archived_at is not null
  from public.roulette_prize_products as slot
  left join public.products as product on product.id = slot.product_id
  order by slot.prize_key;
end;
$$;

revoke all on function public.admin_roulette_wheel()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_wheel() to authenticated;

/** Products that can go on the wheel: live, priced and not archived. */
create or replace function public.admin_roulette_prize_candidates()
returns table (
  candidate_id uuid,
  candidate_name text,
  candidate_value_cents bigint,
  candidate_stock_quantity integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  return query
  select
    product.id,
    product.name,
    product.minimum_price_cents::bigint,
    product.stock_quantity
  from public.products as product
  where product.archived_at is null
    and product.status = 'active'
    and product.minimum_price_cents > 0
  order by product.minimum_price_cents, product.name
  limit 500;
end;
$$;

revoke all on function public.admin_roulette_prize_candidates()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_prize_candidates() to authenticated;

/**
 * Replaces the whole wheel in one transaction. Whole-wheel rather than
 * per-slot because the odds are relative: changing one weight moves every other
 * slot's chance, and a half-applied edit would leave a wheel nobody chose.
 */
create or replace function public.admin_save_roulette_wheel(p_slots jsonb)
returns table (
  saved_slot_count integer,
  saved_total_weight bigint,
  saved_return_bps integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_slot record;
  v_product record;
  v_held bigint;
  v_count integer := 0;
  v_total_weight bigint := 0;
  v_expected_value numeric := 0;
  v_spin_cost_cents constant integer := 100;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'The wheel must be sent as an array of slots.';
  end if;

  if jsonb_array_length(p_slots) between 1 and 5 then
    null;
  else
    raise exception using
      errcode = '22023',
      message = 'The wheel holds 1 to 5 slots.';
  end if;

  -- Validate the whole wheel before touching a single slot, so a rejected edit
  -- leaves the live wheel exactly as it was.
  for v_slot in
    select
      entry.value ->> 'prize_key' as prize_key,
      (entry.value ->> 'product_id')::uuid as product_id,
      (entry.value ->> 'draw_weight')::integer as draw_weight
    from jsonb_array_elements(p_slots) as entry(value)
  loop
    if v_slot.prize_key is null
      or v_slot.prize_key not in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5') then
      raise exception using
        errcode = '22023',
        message = format('Slot %s is not a roulette slot.', coalesce(v_slot.prize_key, 'null'));
    end if;
    if v_slot.draw_weight is null or v_slot.draw_weight < 1 or v_slot.draw_weight > 1000000 then
      raise exception using
        errcode = '22023',
        message = 'A slot weight must be between 1 and 1000000.';
    end if;

    select product.id, product.name, product.minimum_price_cents, product.archived_at, product.status
    into v_product
    from public.products as product
    where product.id = v_slot.product_id;

    if not found or v_product.archived_at is not null or v_product.status <> 'active' then
      raise exception using
        errcode = '23503',
        message = 'A slot points at a product that is not on sale.';
    end if;
    if v_product.minimum_price_cents <= 0 then
      raise exception using
        errcode = '22023',
        message = format('%s has no price and cannot be a prize.', v_product.name);
    end if;

    -- Repointing a slot somebody holds units of would rewrite what they own.
    -- The deferred constraint would catch it at commit; naming the slot here
    -- tells the operator which one to leave alone.
    select coalesce(sum(item.quantity), 0)
    into v_held
    from public.roulette_demo_inventory as item
    where item.prize_key = v_slot.prize_key
      and item.product_id <> v_slot.product_id;

    if v_held > 0 then
      raise exception using
        errcode = 'P0014',
        message = format(
          'Slot %s still holds %s unit(s) of another product and cannot be repointed.',
          v_slot.prize_key, v_held
        );
    end if;

    v_count := v_count + 1;
    v_total_weight := v_total_weight + v_slot.draw_weight;
    v_expected_value := v_expected_value + v_slot.draw_weight * v_product.minimum_price_cents;
  end loop;

  if v_count <> jsonb_array_length(p_slots) then
    raise exception using
      errcode = '22023',
      message = 'The wheel has a slot that could not be read.';
  end if;

  delete from public.roulette_prize_products as slot
  where slot.prize_key not in (
    select entry.value ->> 'prize_key'
    from jsonb_array_elements(p_slots) as entry(value)
  );

  insert into public.roulette_prize_products (prize_key, product_id, draw_weight)
  select
    entry.value ->> 'prize_key',
    (entry.value ->> 'product_id')::uuid,
    (entry.value ->> 'draw_weight')::integer
  from jsonb_array_elements(p_slots) as entry(value)
  on conflict (prize_key)
  do update set
    product_id = excluded.product_id,
    draw_weight = excluded.draw_weight;

  return query
  select
    v_count,
    v_total_weight,
    case
      when v_total_weight > 0
        then round((v_expected_value / v_total_weight / v_spin_cost_cents) * 10000)::integer
      else 0
    end;
end;
$$;

revoke all on function public.admin_save_roulette_wheel(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_roulette_wheel(jsonb) to authenticated;

-- Spinning stops when the wheel is switched off. This is the live definition
-- from 20260727000800 with only the switch added: the Discord id check, the
-- advisory lock key and the two-second double-spin guard all stay.
create or replace function public.spin_roulette(
  p_discord_user_id text,
  p_display_name text
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  won_inventory_quantity integer,
  coin_balance_cents bigint,
  spun_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_enabled boolean;
  v_spin record;
  v_balance bigint;
  v_spun_at timestamptz := clock_timestamp();
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord user ID is invalid.';
  end if;

  -- The kill switch. Inventories, redemptions and balances stay exactly as they
  -- are; only new spins stop.
  select settings.roulette_enabled
  into v_enabled
  from public.platform_settings as settings
  where settings.id = 1;

  if not coalesce(v_enabled, true) then
    raise exception using
      errcode = 'P0020',
      message = 'The roulette is paused.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_auth_user_id::text));
  if exists (
    select 1
    from public.roulette_demo_spins as recent
    where recent.auth_user_id = v_auth_user_id
      and recent.created_at > v_spun_at - interval '2 seconds'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Wait for the current spin to finish.';
  end if;

  if private.roulette_coin_balance(v_auth_user_id) < 100 then
    raise exception using
      errcode = 'P0007',
      message = 'Not enough roulette coins.';
  end if;

  select * into v_spin
  from private.record_roulette_spin(
    v_auth_user_id,
    p_discord_user_id,
    p_display_name,
    v_spun_at
  );

  v_balance := private.move_roulette_coins(
    v_auth_user_id,
    p_discord_user_id,
    'spin',
    -100,
    null,
    v_spin.recorded_spin_id,
    v_spin.won_prize_key
  );

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.inventory_quantity,
    v_balance,
    v_spun_at;
end;
$$;


revoke all on function public.spin_roulette(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.spin_roulette(text, text) to authenticated;

commit;
