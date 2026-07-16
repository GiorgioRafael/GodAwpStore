-- Verifies the versioned Grow a Garden 2 seed against a local migrated database.
-- The seed is deliberately applied twice to prove stable IDs and no duplicates.

begin;

set local client_min_messages = warning;

create temporary table grow_a_garden_expected_products (
  substore_slug text not null,
  product_slug text not null,
  price_cents bigint not null,
  status public.catalog_status not null,
  primary key (substore_slug, product_slug)
);

insert into grow_a_garden_expected_products (
  substore_slug,
  product_slug,
  price_cents,
  status
)
values
  ('seeds', '2x-moon-bloom', 100, 'active'),
  ('seeds', '2x-venom-spitter', 100, 'active'),
  ('seeds', '2x-hypno-bloom', 100, 'active'),
  ('seeds', '1x-dragon-breath', 200, 'active'),
  ('seeds', '3x-dragon-breath', 500, 'active'),
  ('seeds', '1x-sunbloom', 900, 'active'),
  ('gears', '10x-super-watering-can', 100, 'active'),
  ('gears', '10x-super-sprinkler', 100, 'active'),
  ('pets-exclusivos', 'serpent-ice', 0, 'inactive'),
  ('pets-exclusivos', '1x-unicornio', 200, 'active'),
  ('pets-exclusivos', '1x-dragonfly', 200, 'active'),
  ('pets-exclusivos', 'raccoon', 1000, 'active'),
  ('sheckles', '1b-sheckles', 1000, 'active');

create temporary table grow_a_garden_catalog_ids (
  entity_type text not null,
  slug text not null,
  id uuid not null,
  primary key (entity_type, slug)
);

insert into grow_a_garden_catalog_ids (entity_type, slug, id)
select 'game'::text as entity_type, game.slug, game.id
from public.games as game
where game.slug = 'grow-a-garden-2'
  and game.archived_at is null
union all
select 'substore', substore.slug, substore.id
from public.substores as substore
join public.games as game on game.id = substore.game_id
where game.slug = 'grow-a-garden-2'
  and game.archived_at is null
  and substore.slug in ('seeds', 'gears', 'pets-exclusivos', 'sheckles')
  and substore.archived_at is null
union all
select 'product', product.slug, product.id
from public.products as product
join public.substores as substore on substore.id = product.substore_id
join public.games as game on game.id = substore.game_id
join grow_a_garden_expected_products as expected
  on expected.substore_slug = substore.slug
 and expected.product_slug = product.slug
where game.slug = 'grow-a-garden-2'
  and game.archived_at is null
  and substore.archived_at is null
  and product.archived_at is null;

\ir ../migrations/20260716000200_seed_grow_a_garden_2_catalog.sql
\ir ../migrations/20260716000200_seed_grow_a_garden_2_catalog.sql

do $$
declare
  v_game_id uuid;
  v_current_ids integer;
  v_original_ids integer;
  v_preserved_ids integer;
begin
  select game.id
  into strict v_game_id
  from public.games as game
  where game.slug = 'grow-a-garden-2'
    and game.name = 'Grow a Garden 2'
    and game.status = 'active'
    and game.archived_at is null;

  if (
    select count(*)
    from public.substores as substore
    where substore.game_id = v_game_id
      and substore.slug in ('seeds', 'gears', 'pets-exclusivos', 'sheckles')
      and substore.status = 'active'
      and substore.archived_at is null
  ) <> 4 then
    raise exception 'Grow a Garden 2 must have four active versioned substores';
  end if;

  if exists (
    select 1
    from grow_a_garden_expected_products as expected
    where not exists (
      select 1
      from public.substores as substore
      join public.products as product on product.substore_id = substore.id
      where substore.game_id = v_game_id
        and substore.slug = expected.substore_slug
        and substore.archived_at is null
        and product.slug = expected.product_slug
        and product.minimum_price_cents = expected.price_cents
        and product.status = expected.status
        and product.archived_at is null
    )
  ) then
    raise exception 'One or more Grow a Garden 2 products do not match catalog v1';
  end if;

  select count(*)
  into v_current_ids
  from (
    select 'game'::text as entity_type, game.slug, game.id
    from public.games as game
    where game.id = v_game_id
      and game.archived_at is null
    union all
    select 'substore', substore.slug, substore.id
    from public.substores as substore
    where substore.game_id = v_game_id
      and substore.slug in ('seeds', 'gears', 'pets-exclusivos', 'sheckles')
      and substore.archived_at is null
    union all
    select 'product', product.slug, product.id
    from public.products as product
    join public.substores as substore on substore.id = product.substore_id
    join grow_a_garden_expected_products as expected
      on expected.substore_slug = substore.slug
     and expected.product_slug = product.slug
    where substore.game_id = v_game_id
      and substore.archived_at is null
      and product.archived_at is null
  ) as catalog_rows;

  select count(*) into v_original_ids from grow_a_garden_catalog_ids;

  select count(*)
  into v_preserved_ids
  from grow_a_garden_catalog_ids as original
  join (
    select 'game'::text as entity_type, game.slug, game.id
    from public.games as game
    where game.id = v_game_id
      and game.archived_at is null
    union all
    select 'substore', substore.slug, substore.id
    from public.substores as substore
    where substore.game_id = v_game_id
      and substore.slug in ('seeds', 'gears', 'pets-exclusivos', 'sheckles')
      and substore.archived_at is null
    union all
    select 'product', product.slug, product.id
    from public.products as product
    join public.substores as substore on substore.id = product.substore_id
    join grow_a_garden_expected_products as expected
      on expected.substore_slug = substore.slug
     and expected.product_slug = product.slug
    where substore.game_id = v_game_id
      and substore.archived_at is null
      and product.archived_at is null
  ) as current_rows
    on current_rows.entity_type = original.entity_type
   and current_rows.slug = original.slug
   and current_rows.id = original.id;

  -- If the test starts after normal migrations, all 18 rows already exist and
  -- both reapplications must preserve every ID. A pre-seed schema is supported
  -- too: the exact final row count still proves the second run did not duplicate.
  if v_original_ids > 0 and v_preserved_ids <> v_original_ids then
    raise exception 'Reapplying catalog v1 changed one or more stable row IDs';
  end if;

  if v_current_ids <> 18 then
    raise exception 'Grow a Garden 2 catalog v1 must contain 18 versioned rows';
  end if;
end
$$;

rollback;

select 'Grow a Garden 2 catalog v1 verification passed' as result;
