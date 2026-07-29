-- The wheel belongs to the administrator again.
--
-- Two guards refused to let a held slice be repointed or removed. They were
-- right for the shape the data had: the inventory row was keyed by the slice,
-- so repointing one rewrote what its holders owned. Now a row is keyed by the
-- item it is, the page reads the frozen identity, and the slice is only where
-- the prize came from. Nothing is left for the guards to protect, and they were
-- costing the store the ability to run the wheel.

begin;

set local lock_timeout = '5s';

-- The deferred constraint trigger and the check inside the save both existed to
-- keep a held slice pointing at the same product. Neither has anything to
-- defend now.
drop trigger if exists roulette_prize_products_keep_inventory on public.roulette_prize_products;
drop function if exists private.assert_roulette_inventory_intact();

/**
 * Replaces the whole wheel. Up to ten slices, and the wheel is the
 * administrator's to change: a slice may be repointed at another product or
 * taken off entirely at any moment. Nothing already won moves, because an
 * inventory row froze the product and the price it was won at and is keyed by
 * them -- the wheel describes what can be won next, not what anyone owns.
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
  v_count integer := 0;
  v_total_weight bigint := 0;
  v_expected_value numeric := 0;
  v_spin_cost_cents constant integer := 100;
  v_maximum_slots constant integer := 10;
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

  if jsonb_array_length(p_slots) < 1 or jsonb_array_length(p_slots) > v_maximum_slots then
    raise exception using
      errcode = '22023',
      message = format('The wheel holds 1 to %s slots.', v_maximum_slots);
  end if;

  if (
    select count(distinct entry.value ->> 'prize_key')
    from jsonb_array_elements(p_slots) as entry(value)
  ) <> jsonb_array_length(p_slots) then
    raise exception using
      errcode = '22023',
      message = 'The wheel repeats a slot.';
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
    if v_slot.prize_key is null or v_slot.prize_key !~ '^premio_[1-9][0-9]?$' then
      raise exception using
        errcode = '22023',
        message = format('Slot %s is not a roulette slot.', coalesce(v_slot.prize_key, 'null'));
    end if;
    if (substring(v_slot.prize_key from '\d+'))::integer > v_maximum_slots then
      raise exception using
        errcode = '22023',
        message = format('The wheel holds 1 to %s slots.', v_maximum_slots);
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

    v_count := v_count + 1;
    v_total_weight := v_total_weight + v_slot.draw_weight;
    v_expected_value := v_expected_value + v_slot.draw_weight * v_product.minimum_price_cents;
  end loop;

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

-- The panel used to show one number: every unit ever won on this slice. That
-- was the same thing as "units of this product" only because the slice could
-- never change product. Now it can, so the count is split -- otherwise the
-- operator reads a number that describes two different items at once.
drop function if exists public.admin_roulette_wheel();

create function public.admin_roulette_wheel()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_value_cents bigint,
  slot_stock_quantity bigint,
  slot_draw_weight integer,
  slot_draw_chance_bps integer,
  slot_held_units bigint,
  slot_retired_units bigint,
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
    coalesce(product.stock_quantity, 0)::bigint,
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
          and item.product_id = slot.product_id
      ),
      0
    )::bigint,
    coalesce(
      (
        select sum(item.quantity)
        from public.roulette_demo_inventory as item
        where item.prize_key = slot.prize_key
          and item.product_id <> slot.product_id
      ),
      0
    )::bigint,
    product.archived_at is not null
  from public.roulette_prize_products as slot
  left join public.products as product on product.id = slot.product_id
  order by (substring(slot.prize_key from '\d+'))::integer;
end;
$$;

revoke all on function public.admin_roulette_wheel()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_wheel() to authenticated;

commit;
