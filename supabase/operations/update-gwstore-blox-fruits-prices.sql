-- Apply only the requested Blox Fruits sale prices in the isolated GWStore.
-- Confirm project athucowvfccegkzgcnli in the SAME database session first:
-- set app.gwstore_confirmed_project_ref = 'athucowvfccegkzgcnli';
-- Prices are BRL cents: 1 Robux = R$ 0.04, so minimum_price_cents = robux * 4.
-- Product identity, stock, names, photos, ordering and existing orders are preserved.
-- Slugs below were reviewed against the live catalog on 2026-10-13.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;

create temporary table gwstore_blox_fruit_price_targets (
  product_id uuid primary key,
  product_slug text not null unique,
  category text not null check (category in ('gamepass', 'permanent-fruit')),
  robux integer not null check (robux > 0),
  catalog_store_id uuid not null,
  substore_id uuid not null
) on commit drop;

insert into pg_temp.gwstore_blox_fruit_price_targets (
  product_id, product_slug, category, robux, catalog_store_id, substore_id
)
select seed.product_id, seed.product_slug, seed.category, seed.robux,
       case seed.category
         when 'gamepass' then '247e40a3-9205-4ac5-96e2-77aa28fe2924'::uuid
         else 'f629ea16-c538-455c-a671-02f4a52edec1'::uuid
       end,
       case seed.category
         when 'gamepass' then '83396e8c-f6e4-447d-b663-47e4447b5687'::uuid
         else '0eb87e38-4219-461f-bdad-fd5b8682fd4f'::uuid
       end
from (values
  ('0260d3f0-20b4-49d7-9f88-37ba9d733234'::uuid, '2x-drops-blox-fruits', 'gamepass', 350),
  ('b4260a36-5c63-402e-bbee-d82772485ea6'::uuid, 'barcos-rapidos-blox-fruits', 'gamepass', 350),
  ('4fda9c30-725e-40f7-bfdd-1be277512af9'::uuid, 'storage-blox-fruits', 'gamepass', 400),
  ('f9861dc5-b5ca-4e51-a1c8-21ab9caffa5d'::uuid, '2x-money-blox-fruits', 'gamepass', 450),
  ('cb6dc2d6-f9cd-453f-8e49-2dc1854d6d4f'::uuid, '2x-maestria-blox-fruits', 'gamepass', 450),
  ('f8e09356-bb90-4a4e-99a5-a546ea8c9214'::uuid, 'yoru-darkblade-blox-fruits', 'gamepass', 1200),
  ('c21769e9-4b5e-489e-bcd0-4c1d91c1a39c'::uuid, 'notificador-de-frutas-blox-fruits', 'gamepass', 2700),
  ('5771b853-bee5-5bd4-95f6-0d8b26c2cb19'::uuid, 'rocket-permanente-blox-fruits', 'permanent-fruit', 50),
  ('470f6ffa-c93b-5fa1-a9bc-e1b0be47a562'::uuid, 'spin-permanente-blox-fruits', 'permanent-fruit', 75),
  ('ef56f5e0-5ec3-5e64-b008-8fe1909214e2'::uuid, 'blade-permanente-blox-fruits', 'permanent-fruit', 100),
  ('77545a20-ea91-58bc-b315-0eb76029ad1b'::uuid, 'spring-permanente-blox-fruits', 'permanent-fruit', 180),
  ('0ed8283b-8e0e-5fa6-854e-3c3650b202e5'::uuid, 'bomb-permanente-blox-fruits', 'permanent-fruit', 220),
  ('4f08ca76-c542-5696-8151-2ecc2427dd62'::uuid, 'smoke-permanente-blox-fruits', 'permanent-fruit', 250),
  ('68344c8b-c74c-58a2-a584-bfec97b1b248'::uuid, 'spike-permanente-blox-fruits', 'permanent-fruit', 380),
  ('d3efad91-d723-5b88-afee-071894c7cf6c'::uuid, 'flame-permanente-blox-fruits', 'permanent-fruit', 550),
  ('da1210dc-7b47-43ff-a0ac-3701eb951be8'::uuid, 'ice-permanente-blox-fruits', 'permanent-fruit', 750),
  ('8a3f1cc3-c241-4b67-b09a-aae1df822907'::uuid, 'sand-permanente-blox-fruits', 'permanent-fruit', 850),
  ('2b1f60e4-6141-4180-b794-652f6a9db0ed'::uuid, 'dark-permanente-blox-fruits', 'permanent-fruit', 950),
  ('ed2706cb-c818-5272-b8e1-90c98474e3c1'::uuid, 'eagle-permanente-blox-fruits', 'permanent-fruit', 975),
  ('3a35f02a-6394-5b4b-ba6d-d6f79b396bb7'::uuid, 'diamond-permanente-blox-fruits', 'permanent-fruit', 1000),
  ('bb24ba49-44a4-5221-9254-55b715f8b34e'::uuid, 'light-permanente-blox-fruits', 'permanent-fruit', 1100),
  ('58cc91c9-589f-5eef-9afe-6bef3f958ba4'::uuid, 'rubber-permanente-blox-fruits', 'permanent-fruit', 1200),
  ('b9161d98-9b0d-524d-bded-32687747d144'::uuid, 'ghost-permanente-blox-fruits', 'permanent-fruit', 1275),
  ('9f45657b-2d90-436b-bcd6-7a04cbab60ed'::uuid, 'magma-permanente-blox-fruits', 'permanent-fruit', 1300),
  ('cb9101b8-2472-57f5-aa2a-0fbaf6de6eb7'::uuid, 'quake-permanente-blox-fruits', 'permanent-fruit', 1500),
  ('a0040aa3-2336-4cd6-a74e-9bd00ee3dd12'::uuid, 'budha-permanente-blox-fruits', 'permanent-fruit', 1650),
  ('a8cf46a7-9b1d-5f7d-a48c-99167641cae5'::uuid, 'love-permanente-blox-fruits', 'permanent-fruit', 1700),
  ('182e8049-468e-5bd5-b96a-96b6a78d8e11'::uuid, 'creation-permanente-blox-fruits', 'permanent-fruit', 1750),
  ('2647a60b-558c-55ee-bb85-0d57cec6bbbb'::uuid, 'spider-permanente-blox-fruits', 'permanent-fruit', 1800),
  ('c9f72baa-c891-58b6-88ce-5d5c966e36ae'::uuid, 'sound-permanente-blox-fruits', 'permanent-fruit', 1900),
  ('bab77be6-b324-5213-bb9f-c5a4e781c698'::uuid, 'phoenix-permanente-blox-fruits', 'permanent-fruit', 2000),
  ('81e8e102-7cb8-4a52-887b-db728e8cf305'::uuid, 'portal-permanente', 'permanent-fruit', 2000),
  ('682da64a-6822-40d0-97be-018151b00f9e'::uuid, 'rumble-permanente-blox-fruits', 'permanent-fruit', 2100),
  ('0f57f60c-6ad4-5497-ba0d-a15c1df05c37'::uuid, 'pain-permanente-blox-fruits', 'permanent-fruit', 2200),
  ('4e01cc72-2555-5e81-94c1-47f091c3ff8f'::uuid, 'blizzard-permanente-blox-fruits', 'permanent-fruit', 2250),
  ('ea16d0f0-8b20-578d-b323-f0f5d1b13306'::uuid, 'gravity-permanente-blox-fruits', 'permanent-fruit', 2300),
  ('23fec06f-a5dd-5612-a3e3-64cb7ebe0b28'::uuid, 't-rex-permanente-blox-fruits', 'permanent-fruit', 2350),
  ('d795b208-caed-5441-82c2-63352a61480e'::uuid, 'mammoth-permanente-blox-fruits', 'permanent-fruit', 2350),
  ('51f618c0-8d83-4086-95df-d57be3b313b1'::uuid, 'dough-permanente-blox-fruits', 'permanent-fruit', 2400),
  ('e9d634e5-9396-5c4f-8952-a18945426fbb'::uuid, 'shadow-permanente', 'permanent-fruit', 2425),
  ('b27e3b4b-30b9-55a6-b959-a3a92972c738'::uuid, 'venom-permanente-blox-fruits', 'permanent-fruit', 2450),
  ('2bd73328-4271-525c-90e4-de8f969c6834'::uuid, 'gas-permanente-blox-fruits', 'permanent-fruit', 2500),
  ('79a605bf-fe74-5472-9dad-97e20a63db26'::uuid, 'spirit-permanente-blox-fruits', 'permanent-fruit', 2550),
  ('ef32bcd2-ff60-4899-8afa-c0a7bbe26e00'::uuid, 'tiger-permanente', 'permanent-fruit', 3000),
  ('79a75f89-616a-48b7-aa3b-015c9d10b687'::uuid, 'yeti-permanente', 'permanent-fruit', 3000),
  ('010ce7a4-37b3-4b1c-8d12-260af0597689'::uuid, 'magnetic-permanente-blox-fruits', 'permanent-fruit', 3500),
  ('92c81487-7b51-4270-bbec-7af82923ab9a'::uuid, 'kitsune-permanente', 'permanent-fruit', 4000),
  ('37e9f0cc-9853-404b-9be3-8ca4512ef53c'::uuid, 'dragon-permanente-blox-fruits', 'permanent-fruit', 5000)
) as seed(product_id, product_slug, category, robux);

do $gw_prices$
declare
  v_game_id constant uuid := '4ae2512f-a698-4f2c-976e-3719ff6b0299';
  v_price_changes jsonb;
  v_changed_count integer;
begin
  if current_setting('app.gwstore_confirmed_project_ref', true)
       is distinct from 'athucowvfccegkzgcnli'
    or (select count(*) from public.guilds
        where discord_guild_id = '1401264061101899820') <> 1
    or exists (select 1 from public.guilds
               where discord_guild_id is distinct from '1401264061101899820') then
    raise exception 'Confirm the isolated GWStore project before changing prices.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gwstore:blox-fruits:prices', 0));

  if (select count(*) from pg_temp.gwstore_blox_fruit_price_targets) <> 48
    or (select count(*) from pg_temp.gwstore_blox_fruit_price_targets
        where category = 'gamepass') <> 7
    or (select count(*) from pg_temp.gwstore_blox_fruit_price_targets
        where category = 'permanent-fruit') <> 41 then
    raise exception 'The requested price list must contain exactly 7 gamepasses and 41 fruits.';
  end if;

  -- Lock parent scopes against archival or reassignment during this operation.
  perform game.id from public.games as game
    where game.id = v_game_id for share;
  perform store.id from public.catalog_stores as store
    where store.id in (select target.catalog_store_id
                       from pg_temp.gwstore_blox_fruit_price_targets as target)
    order by store.id for share;
  perform substore.id from public.substores as substore
    where substore.id in (select target.substore_id
                          from pg_temp.gwstore_blox_fruit_price_targets as target)
    order by substore.id for share;
  perform product.id from public.products as product
    join pg_temp.gwstore_blox_fruit_price_targets as target on target.product_id = product.id
    order by product.id for update of product;

  if not exists (select 1 from public.games
                 where id = v_game_id and slug = 'blox-fruits'
                   and status = 'active' and archived_at is null)
    or (select count(*) from public.catalog_stores as store
        where store.id in (select target.catalog_store_id
                           from pg_temp.gwstore_blox_fruit_price_targets as target)
          and store.game_id = v_game_id
          and store.status = 'active' and store.archived_at is null) <> 2
    or (select count(*) from public.substores as substore
        where substore.id in (select target.substore_id
                              from pg_temp.gwstore_blox_fruit_price_targets as target)
          and substore.game_id = v_game_id
          and substore.status = 'active' and substore.archived_at is null) <> 2 then
    raise exception 'The reviewed GWStore Blox Fruits catalog scope changed.';
  end if;

  if (select count(*) from pg_temp.gwstore_blox_fruit_price_targets as target
      join public.products as product on product.id = target.product_id
      where product.slug = target.product_slug
        and product.catalog_store_id = target.catalog_store_id
        and product.substore_id = target.substore_id
        and product.archived_at is null) <> 48 then
    raise exception 'A requested product is missing, archived, moved, or has a different slug.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', product.id,
    'slug', product.slug,
    'previous_price_cents', product.minimum_price_cents,
    'price_cents', target.robux::bigint * 4
  ) order by product.id), '[]'::jsonb)
  into v_price_changes
  from public.products as product
  join pg_temp.gwstore_blox_fruit_price_targets as target on target.product_id = product.id
  where product.minimum_price_cents is distinct from target.robux::bigint * 4;

  update public.products as product
  set minimum_price_cents = target.robux::bigint * 4
  from pg_temp.gwstore_blox_fruit_price_targets as target
  where product.id = target.product_id
    and product.slug = target.product_slug
    and product.catalog_store_id = target.catalog_store_id
    and product.substore_id = target.substore_id
    and product.archived_at is null
    and product.minimum_price_cents is distinct from target.robux::bigint * 4;
  get diagnostics v_changed_count = row_count;

  if v_changed_count <> jsonb_array_length(v_price_changes)
    or (select count(*) from pg_temp.gwstore_blox_fruit_price_targets as target
        join public.products as product on product.id = target.product_id
        where product.slug = target.product_slug
          and product.catalog_store_id = target.catalog_store_id
          and product.substore_id = target.substore_id
          and product.archived_at is null
          and product.minimum_price_cents = target.robux::bigint * 4) <> 48 then
    raise exception 'Price verification failed; the entire operation is rolled back.';
  end if;

  -- Service-role maintenance is skipped by the normal admin audit trigger.
  -- Record only public catalog identity and previous/new sale prices; reruns
  -- with no differences perform no product updates and create no audit event.
  if v_changed_count > 0 then
    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values ('catalog.gwstore.blox_fruits_prices_updated', 'catalog', v_game_id,
      jsonb_build_object('project_ref', 'athucowvfccegkzgcnli',
        'requested_products', 48, 'changed_products', v_changed_count,
        'prices', v_price_changes));
  end if;
  raise notice '% product prices changed; all 48 requested prices verified.', v_changed_count;
end
$gw_prices$;

select count(*)::integer as requested_products,
       count(*) filter (where product.minimum_price_cents = target.robux::bigint * 4)::integer as verified_prices
from pg_temp.gwstore_blox_fruit_price_targets as target
join public.products as product on product.id = target.product_id;
commit;
