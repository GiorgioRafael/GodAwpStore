-- The roulette holds up to ten slots, added and removed from the panel.
--
-- Five was written into six CHECK constraints, two validators and every
-- ordering, so growing the wheel meant a migration. Worse, the constraints
-- enumerated the keys: a slot removed from the wheel would have had its key
-- outlawed, and the prizes players were still holding would have become
-- unsellable.
--
-- The constraints now describe the SHAPE of a slot label rather than listing
-- which ones exist. How many slices the wheel may have is a policy the editor
-- enforces, not a fact the data has to be migrated for — and a retired slot
-- stays legal forever, so held prizes keep working.

begin;

set local lock_timeout = '5s';

-- Every check that enumerates the five keys, rebuilt as a format rule. Doing it
-- by inspection rather than by name catches any constraint this migration does
-- not know about, and refuses to touch one whose shape it does not recognise.
do $$
declare
  v_constraint record;
  v_rebuilt integer := 0;
begin
  for v_constraint in
    select
      cls.relname as table_name,
      con.conname as constraint_name,
      pg_get_constraintdef(con.oid) as definition
    from pg_constraint as con
    join pg_class as cls on cls.oid = con.conrelid
    join pg_namespace as ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%premio_5%'
  loop
    if v_constraint.definition !~ 'CHECK \(\(prize_key = ANY' then
      raise exception using
        errcode = '22023',
        message = format(
          'Constraint %s on %s mentions the prize keys in a shape this migration cannot rebuild: %s',
          v_constraint.constraint_name, v_constraint.table_name, v_constraint.definition
        );
    end if;

    execute format(
      'alter table public.%I drop constraint %I',
      v_constraint.table_name, v_constraint.constraint_name
    );
    execute format(
      $sql$alter table public.%I add constraint %I check (prize_key ~ '^premio_[1-9][0-9]?$')$sql$,
      v_constraint.table_name, v_constraint.constraint_name
    );
    v_rebuilt := v_rebuilt + 1;
  end loop;

  raise notice 'Rebuilt % prize-key constraint(s) as a format rule.', v_rebuilt;
end
$$;

/**
 * Reads the prize selection a player sent. Ten lines now, because a player can
 * hold ten distinct prizes and selling them one at a time is not a feature.
 */
create or replace function private.read_roulette_item_selection(p_items jsonb)
returns table (selected_prize_key text, selected_quantity integer)
language plpgsql
immutable
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must be an array.';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_items);
  if v_count < 1 or v_count > 10 then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must hold 1 to 10 prizes.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry
    where entry.value ->> 'prize_key' is null
      or entry.value ->> 'prize_key' !~ '^premio_[1-9][0-9]?$'
      or (entry.value ->> 'quantity') is null
      or (entry.value ->> 'quantity') !~ '^[0-9]+$'
      or (entry.value ->> 'quantity')::bigint < 1
      or (entry.value ->> 'quantity')::bigint > 10000
  ) then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection has an invalid line.';
  end if;

  select count(distinct entry.value ->> 'prize_key')
  into v_distinct
  from jsonb_array_elements(p_items) as entry;

  if v_distinct <> v_count then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection repeats a prize.';
  end if;

  return query
  select
    entry.value ->> 'prize_key',
    (entry.value ->> 'quantity')::integer
  from jsonb_array_elements(p_items) as entry;
end;
$$;

revoke all on function private.read_roulette_item_selection(jsonb)
  from public, anon, authenticated, service_role;

/**
 * Replaces the whole wheel. Up to ten slices, and a slice may only leave the
 * wheel once nobody is holding its prize: the held units keep working either
 * way, but a player watching their prize vanish from the wheel has no way to
 * know it is still theirs.
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

    -- Repointing a slot somebody holds units of would rewrite what they own.
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

  -- Removal was unguarded: the loop above only sees slots that are staying, and
  -- the deferred trigger cannot see a slot that no longer exists.
  select coalesce(sum(item.quantity), 0)
  into v_held
  from public.roulette_demo_inventory as item
  join public.roulette_prize_products as slot on slot.prize_key = item.prize_key
  where slot.prize_key not in (
    select entry.value ->> 'prize_key'
    from jsonb_array_elements(p_slots) as entry(value)
  );

  if v_held > 0 then
    raise exception using
      errcode = 'P0022',
      message = format(
        'A slot being removed still holds %s prize(s) in player inventories.', v_held
      );
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

-- Ordering: premio_10 sorts between premio_1 and premio_2 as text, which would
-- put the tenth slice second on the wheel while the rotation aimed elsewhere.
create or replace function public.admin_roulette_wheel()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_value_cents bigint,
  slot_stock_quantity bigint,
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

-- The player's wheel and inventory ordered the same way, and text order put
-- the tenth slice second. The rotation aims by position, so a mis-ordered
-- wheel stops on the wrong wedge.
create or replace function public.get_roulette_prizes()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_product_image_url text,
  slot_value_cents bigint,
  slot_sale_value_cents bigint,
  slot_draw_weight integer,
  slot_draw_chance_bps integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_sale_rate_bps integer;
  v_total_weight bigint;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select settings.roulette_sale_rate_bps
  into v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;
  v_sale_rate_bps := coalesce(v_sale_rate_bps, 5000);

  select sum(slot.draw_weight)
  into v_total_weight
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  return query
  select
    slot.prize_key,
    product.id,
    product.name,
    product.image_url,
    product.minimum_price_cents::bigint,
    (product.minimum_price_cents::bigint * v_sale_rate_bps) / 10000,
    slot.draw_weight,
    case
      when coalesce(v_total_weight, 0) > 0
        then ((slot.draw_weight::bigint * 10000) / v_total_weight)::integer
      else 0
    end
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null
  order by (substring(slot.prize_key from '\d+'))::integer;
end;
$$;

create or replace function public.get_demo_roulette_inventory()
returns table (
  prize_key text,
  quantity integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  return query
  select
    inventory.prize_key,
    inventory.quantity,
    inventory.updated_at
  from public.roulette_demo_inventory as inventory
  where inventory.auth_user_id = v_auth_user_id
  order by (substring(inventory.prize_key from '\d+'))::integer;
end;
$$;

commit;
