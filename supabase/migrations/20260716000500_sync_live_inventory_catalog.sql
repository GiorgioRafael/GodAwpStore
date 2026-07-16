-- Align the live Grow a Garden catalog with the stock/prices supplied for GWStore.
-- Existing slugs are intentionally preserved so historical references and product
-- UUIDs remain stable. Inventory is imported separately through the encrypted
-- admin flow after this migration is applied.

do $$
declare
  v_game_id uuid;
  v_seeds_id uuid;
  v_gears_id uuid;
begin
  select id
  into strict v_game_id
  from public.games
  where slug = 'grow-a-garden-2'
    and archived_at is null;

  select id
  into strict v_seeds_id
  from public.substores
  where game_id = v_game_id
    and slug = 'seeds'
    and archived_at is null;

  select id
  into strict v_gears_id
  from public.substores
  where game_id = v_game_id
    and slug = 'gears'
    and archived_at is null;

  update public.products
  set
    name = 'Super Watering',
    description = '💦🌈 Equipamento com entrega manual pelo ticket privado da GWStore.',
    minimum_price_cents = 5,
    status = 'active',
    archived_at = null
  where substore_id = v_gears_id
    and slug = '10x-super-watering-can';

  update public.products
  set
    name = 'Super Sprinkler',
    description = '🌧️💜 Equipamento com entrega manual pelo ticket privado da GWStore.',
    minimum_price_cents = 2,
    status = 'active',
    archived_at = null
  where substore_id = v_gears_id
    and slug = '10x-super-sprinkler';

  update public.products
  set
    name = 'Sun Bloom',
    description = '🌻☀️ Semente especial com entrega manual pelo ticket privado da GWStore.',
    minimum_price_cents = 400,
    status = 'active',
    archived_at = null
  where substore_id = v_seeds_id
    and slug = '1x-sunbloom';

  update public.products
  set
    name = 'Dragon''s Breath',
    description = '🐉🔥 Semente especial com entrega manual pelo ticket privado da GWStore.',
    minimum_price_cents = 40,
    status = 'active',
    archived_at = null
  where substore_id = v_seeds_id
    and slug = '1x-dragon-breath';

  insert into public.products (
    substore_id,
    name,
    slug,
    description,
    minimum_price_cents,
    status,
    sort_order,
    low_stock_threshold,
    archived_at
  )
  values (
    v_seeds_id,
    'Ghost Pepper',
    'ghost-pepper',
    '🌶️👻 Semente especial com entrega manual pelo ticket privado da GWStore.',
    10,
    'active',
    70,
    10,
    null
  )
  on conflict (substore_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    description = excluded.description,
    minimum_price_cents = excluded.minimum_price_cents,
    status = excluded.status,
    sort_order = excluded.sort_order,
    low_stock_threshold = excluded.low_stock_threshold,
    archived_at = null;
end
$$;
