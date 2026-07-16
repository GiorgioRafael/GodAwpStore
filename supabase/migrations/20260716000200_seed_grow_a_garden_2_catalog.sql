-- GWStore catalog v1: Grow a Garden 2.
--
-- This seed is deliberately non-destructive: it updates only the catalog rows
-- identified by the slugs below and never archives or deletes unrelated rows.
-- Reapplying it preserves row IDs through the active-slug unique indexes.

do $$
declare
  v_game_id uuid;
  v_seeds_id uuid;
  v_gears_id uuid;
  v_pets_id uuid;
  v_sheckles_id uuid;
begin
  insert into public.games (
    name,
    slug,
    description,
    status,
    sort_order,
    archived_at
  )
  values (
    'Grow a Garden 2',
    'grow-a-garden-2',
    'Catálogo Grow a Garden 2 da GWStore.',
    'active',
    10,
    null
  )
  on conflict ((lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    sort_order = excluded.sort_order,
    archived_at = null
  returning id into v_game_id;

  insert into public.substores (
    game_id,
    name,
    slug,
    title,
    description,
    color_hex,
    status,
    sort_order,
    archived_at
  )
  values (
    v_game_id,
    'Seeds',
    'seeds',
    'Grow a Garden — Seeds',
    'Sementes disponíveis para Grow a Garden 2.',
    '#65A30D',
    'active',
    10,
    null
  )
  on conflict (game_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    title = excluded.title,
    description = excluded.description,
    color_hex = excluded.color_hex,
    status = excluded.status,
    sort_order = excluded.sort_order,
    archived_at = null
  returning id into v_seeds_id;

  insert into public.substores (
    game_id,
    name,
    slug,
    title,
    description,
    color_hex,
    status,
    sort_order,
    archived_at
  )
  values (
    v_game_id,
    'Gears',
    'gears',
    'Grow a Garden — Gears',
    'Equipamentos disponíveis para Grow a Garden 2.',
    '#7C3AED',
    'active',
    20,
    null
  )
  on conflict (game_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    title = excluded.title,
    description = excluded.description,
    color_hex = excluded.color_hex,
    status = excluded.status,
    sort_order = excluded.sort_order,
    archived_at = null
  returning id into v_gears_id;

  insert into public.substores (
    game_id,
    name,
    slug,
    title,
    description,
    color_hex,
    status,
    sort_order,
    archived_at
  )
  values (
    v_game_id,
    'Pets Exclusivos',
    'pets-exclusivos',
    'Pets Exclusivos',
    'Pets exclusivos disponíveis para Grow a Garden 2.',
    '#EA580C',
    'active',
    30,
    null
  )
  on conflict (game_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    title = excluded.title,
    description = excluded.description,
    color_hex = excluded.color_hex,
    status = excluded.status,
    sort_order = excluded.sort_order,
    archived_at = null
  returning id into v_pets_id;

  insert into public.substores (
    game_id,
    name,
    slug,
    title,
    description,
    color_hex,
    status,
    sort_order,
    archived_at
  )
  values (
    v_game_id,
    'Sheckles',
    'sheckles',
    'Sheckles',
    'Moeda do jogo disponível para Grow a Garden 2.',
    '#D4AF37',
    'active',
    40,
    null
  )
  on conflict (game_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    title = excluded.title,
    description = excluded.description,
    color_hex = excluded.color_hex,
    status = excluded.status,
    sort_order = excluded.sort_order,
    archived_at = null
  returning id into v_sheckles_id;

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
  values
    (v_seeds_id, '2x Moon Bloom', '2x-moon-bloom', null, 100, 'active', 10, 5, null),
    (v_seeds_id, '2x Venom Spitter', '2x-venom-spitter', null, 100, 'active', 20, 5, null),
    (v_seeds_id, '2x Hypno Bloom', '2x-hypno-bloom', null, 100, 'active', 30, 5, null),
    (v_seeds_id, '1x Dragon Breath', '1x-dragon-breath', null, 200, 'active', 40, 5, null),
    (v_seeds_id, '3x Dragon Breath', '3x-dragon-breath', null, 500, 'active', 50, 5, null),
    (v_seeds_id, '1x Sunbloom', '1x-sunbloom', null, 900, 'active', 60, 5, null)
  on conflict (substore_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    description = coalesce(excluded.description, products.description),
    minimum_price_cents = excluded.minimum_price_cents,
    status = excluded.status,
    sort_order = excluded.sort_order,
    low_stock_threshold = excluded.low_stock_threshold,
    archived_at = null;

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
  values
    (v_gears_id, '10x Super Watering Can', '10x-super-watering-can', null, 100, 'active', 10, 5, null),
    (v_gears_id, '10x Super Sprinkler', '10x-super-sprinkler', null, 100, 'active', 20, 5, null)
  on conflict (substore_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    description = coalesce(excluded.description, products.description),
    minimum_price_cents = excluded.minimum_price_cents,
    status = excluded.status,
    sort_order = excluded.sort_order,
    low_stock_threshold = excluded.low_stock_threshold,
    archived_at = null;

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
  values
    (
      v_pets_id,
      'Serpent Ice',
      'serpent-ice',
      'Preço pendente de definição; produto indisponível para venda.',
      0,
      'inactive',
      10,
      5,
      null
    ),
    (v_pets_id, '1x Unicórnio', '1x-unicornio', null, 200, 'active', 20, 5, null),
    (v_pets_id, '1x Dragonfly', '1x-dragonfly', null, 200, 'active', 30, 5, null),
    (v_pets_id, 'Raccoon', 'raccoon', null, 1000, 'active', 40, 5, null)
  on conflict (substore_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    description = coalesce(excluded.description, products.description),
    minimum_price_cents = excluded.minimum_price_cents,
    status = excluded.status,
    sort_order = excluded.sort_order,
    low_stock_threshold = excluded.low_stock_threshold,
    archived_at = null;

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
    v_sheckles_id,
    '1b Sheckles',
    '1b-sheckles',
    null,
    1000,
    'active',
    10,
    5,
    null
  )
  on conflict (substore_id, (lower(slug))) where archived_at is null
  do update set
    name = excluded.name,
    description = coalesce(excluded.description, products.description),
    minimum_price_cents = excluded.minimum_price_cents,
    status = excluded.status,
    sort_order = excluded.sort_order,
    low_stock_threshold = excluded.low_stock_threshold,
    archived_at = null;
end
$$;
