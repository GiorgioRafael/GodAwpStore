-- One-time GWStore catalog operation, intentionally outside shared migrations.
-- Run against the GWStore database only after reviewing the target IDs below.
-- Adds the owner's 40 permanent fruits, preserves the 14 existing product IDs,
-- and keeps Control/Dragon prices, names, images and status. Existing statuses,
-- descriptions, slugs, image URLs and emoji metadata remain untouched.
-- New UUIDs are UUIDv5(namespace=catalog_store_id, name='permanent-fruit:<key>').
-- Prices are integer Robux * 4 cents, in the exact order supplied by the owner.
-- Reapplying is safe for IDs/images/status, but deliberately reapplies this
-- price/order/name/availability table. This is NOT a deploy/postbuild reset.
-- After COMMIT, synchronize the already-published Discord storefront once.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create temporary table gwstore_permanent_fruit_import (
  id uuid primary key,
  was_existing boolean not null,
  display_name text,
  slug text not null unique,
  robux integer,
  display_order integer not null unique,
  initial_image_url text,
  aliases text[] not null,
  check (robux is null or robux > 0),
  check (display_order between 0 and 41),
  check ((robux is null) = (display_name is null))
) on commit drop;

insert into gwstore_permanent_fruit_import (
  id, was_existing, display_name, slug, robux,
  display_order, initial_image_url, aliases
) values
  ('5771b853-bee5-5bd4-95f6-0d8b26c2cb19'::uuid, false, 'Rocket Permanente', 'rocket-permanente-blox-fruits', 50, 0, null, array['rocket']::text[]),
  ('470f6ffa-c93b-5fa1-a9bc-e1b0be47a562'::uuid, false, 'Spin Permanente', 'spin-permanente-blox-fruits', 75, 1, null, array['spin']::text[]),
  ('ef56f5e0-5ec3-5e64-b008-8fe1909214e2'::uuid, false, 'Blade Permanente', 'blade-permanente-blox-fruits', 100, 2, null, array['blade']::text[]),
  ('77545a20-ea91-58bc-b315-0eb76029ad1b'::uuid, false, 'Spring Permanente', 'spring-permanente-blox-fruits', 180, 3, null, array['spring']::text[]),
  ('0ed8283b-8e0e-5fa6-854e-3c3650b202e5'::uuid, false, 'Bomb Permanente', 'bomb-permanente-blox-fruits', 220, 4, null, array['bomb']::text[]),
  ('4f08ca76-c542-5696-8151-2ecc2427dd62'::uuid, false, 'Smoke Permanente', 'smoke-permanente-blox-fruits', 250, 5, null, array['smoke']::text[]),
  ('68344c8b-c74c-58a2-a584-bfec97b1b248'::uuid, false, 'Spike Permanente', 'spike-permanente-blox-fruits', 380, 6, null, array['spike']::text[]),
  ('d3efad91-d723-5b88-afee-071894c7cf6c'::uuid, false, 'Flame Permanente', 'flame-permanente-blox-fruits', 550, 7, null, array['flame']::text[]),
  ('da1210dc-7b47-43ff-a0ac-3701eb951be8'::uuid, true, 'Ice Permanente', 'ice-permanente-blox-fruits', 750, 8, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/444b1300-0d50-45ac-b694-2a6a227610b3.webp', array['ice']::text[]),
  ('8a3f1cc3-c241-4b67-b09a-aae1df822907'::uuid, true, 'Sand / Areia Permanente', 'sand-permanente-blox-fruits', 850, 9, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/bae383c9-401c-44c0-859b-dcf4ac672ec8.webp', array['areia', 'sand', 'sandareia']::text[]),
  ('2b1f60e4-6141-4180-b794-652f6a9db0ed'::uuid, true, 'Dark Permanente', 'dark-permanente-blox-fruits', 950, 10, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/d4acd72f-4d77-4282-882e-373f082f7a8b.webp', array['dark']::text[]),
  ('ed2706cb-c818-5272-b8e1-90c98474e3c1'::uuid, false, 'Eagle Permanente', 'eagle-permanente-blox-fruits', 975, 11, null, array['eagle']::text[]),
  ('3a35f02a-6394-5b4b-ba6d-d6f79b396bb7'::uuid, false, 'Diamond / Diamante Permanente', 'diamond-permanente-blox-fruits', 1000, 12, null, array['diamante', 'diamond', 'diamonddiamante']::text[]),
  ('bb24ba49-44a4-5221-9254-55b715f8b34e'::uuid, false, 'Light / Luz Permanente', 'light-permanente-blox-fruits', 1100, 13, null, array['light', 'lightluz', 'luz']::text[]),
  ('58cc91c9-589f-5eef-9afe-6bef3f958ba4'::uuid, false, 'Rubber Permanente', 'rubber-permanente-blox-fruits', 1200, 14, null, array['rubber']::text[]),
  ('b9161d98-9b0d-524d-bded-32687747d144'::uuid, false, 'Ghost Permanente', 'ghost-permanente-blox-fruits', 1275, 15, null, array['ghost']::text[]),
  ('9f45657b-2d90-436b-bcd6-7a04cbab60ed'::uuid, true, 'Magma Permanente', 'magma-permanente-blox-fruits', 1300, 16, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/ea8d38ca-945f-4679-aff3-825fb962ae8e.webp', array['magma']::text[]),
  ('cb9101b8-2472-57f5-aa2a-0fbaf6de6eb7'::uuid, false, 'Quake Permanente', 'quake-permanente-blox-fruits', 1500, 17, null, array['quake']::text[]),
  ('a0040aa3-2336-4cd6-a74e-9bd00ee3dd12'::uuid, true, 'Buddha Permanente', 'budha-permanente-blox-fruits', 1650, 18, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/6afef138-cf0b-4672-894e-957a12156cc8.webp', array['buddha', 'budha']::text[]),
  ('a8cf46a7-9b1d-5f7d-a48c-99167641cae5'::uuid, false, 'Love Permanente', 'love-permanente-blox-fruits', 1700, 19, null, array['love']::text[]),
  ('182e8049-468e-5bd5-b96a-96b6a78d8e11'::uuid, false, 'Creation Permanente', 'creation-permanente-blox-fruits', 1750, 20, null, array['creation']::text[]),
  ('2647a60b-558c-55ee-bb85-0d57cec6bbbb'::uuid, false, 'Spider Permanente', 'spider-permanente-blox-fruits', 1800, 21, null, array['spider']::text[]),
  ('c9f72baa-c891-58b6-88ce-5d5c966e36ae'::uuid, false, 'Sound Permanente', 'sound-permanente-blox-fruits', 1900, 22, null, array['sound']::text[]),
  ('bab77be6-b324-5213-bb9f-c5a4e781c698'::uuid, false, 'Phoenix Permanente', 'phoenix-permanente-blox-fruits', 2000, 23, null, array['phoenix']::text[]),
  ('81e8e102-7cb8-4a52-887b-db728e8cf305'::uuid, true, 'Portal Permanente', 'portal-permanente-blox-fruits', 2000, 24, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/2c723d99-180a-41c1-a346-d18147c0bdc7.webp', array['portal']::text[]),
  ('682da64a-6822-40d0-97be-018151b00f9e'::uuid, true, 'Lightning / Rumble Permanente', 'rumble-permanente-blox-fruits', 2100, 25, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/41dacb87-dabe-4270-a5e9-9599ad6cfdae.webp', array['lightning', 'lightningrumble', 'rumble']::text[]),
  ('0f57f60c-6ad4-5497-ba0d-a15c1df05c37'::uuid, false, 'Pain Permanente', 'pain-permanente-blox-fruits', 2200, 26, null, array['pain']::text[]),
  ('4e01cc72-2555-5e81-94c1-47f091c3ff8f'::uuid, false, 'Blizzard / Nevasca Permanente', 'blizzard-permanente-blox-fruits', 2250, 27, null, array['blizzard', 'blizzardnevasca', 'nevasca']::text[]),
  ('ea16d0f0-8b20-578d-b323-f0f5d1b13306'::uuid, false, 'Gravity Permanente', 'gravity-permanente-blox-fruits', 2300, 28, null, array['gravity']::text[]),
  ('23fec06f-a5dd-5612-a3e3-64cb7ebe0b28'::uuid, false, 'T-Rex Permanente', 't-rex-permanente-blox-fruits', 2350, 29, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/d390f243-537b-4154-bee1-2fab285ef4c0.webp', array['trex']::text[]),
  ('d795b208-caed-5441-82c2-63352a61480e'::uuid, false, 'Mammoth / Mamute Permanente', 'mammoth-permanente-blox-fruits', 2350, 30, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/64185393-c7dc-4ecb-92ce-6a7bfdec8981.webp', array['mammoth', 'mammothmamute', 'mamute']::text[]),
  ('51f618c0-8d83-4086-95df-d57be3b313b1'::uuid, true, 'Dough / Massa Permanente', 'dough-permanente-blox-fruits', 2400, 31, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/c233b6c8-d8a9-4885-aaaa-c77c2bfe43cb.webp', array['dough', 'doughmassa', 'massa']::text[]),
  ('e9d634e5-9396-5c4f-8952-a18945426fbb'::uuid, false, 'Shadow Permanente', 'shadow-permanente-blox-fruits', 2425, 32, null, array['shadow']::text[]),
  ('b27e3b4b-30b9-55a6-b959-a3a92972c738'::uuid, false, 'Venom Permanente', 'venom-permanente-blox-fruits', 2450, 33, null, array['venom']::text[]),
  ('2bd73328-4271-525c-90e4-de8f969c6834'::uuid, false, 'Gas Permanente', 'gas-permanente-blox-fruits', 2500, 34, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/1b1185d0-d2ca-4d67-91e8-69bc31b091d7.webp', array['gas']::text[]),
  ('79a605bf-fe74-5472-9dad-97e20a63db26'::uuid, false, 'Spirit Permanente', 'spirit-permanente-blox-fruits', 2550, 35, null, array['spirit']::text[]),
  ('ef32bcd2-ff60-4899-8afa-c0a7bbe26e00'::uuid, true, 'Tiger Permanente', 'tiger-permanente-blox-fruits', 3000, 36, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/f6a65c88-4cfa-48e2-952e-2ca91f8954ca.webp', array['tiger']::text[]),
  ('79a75f89-616a-48b7-aa3b-015c9d10b687'::uuid, true, 'Yeti Permanente', 'yeti-permanente-blox-fruits', 3000, 37, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/f034e4fe-006d-43da-8360-8c1d92b035be.webp', array['yeti']::text[]),
  ('010ce7a4-37b3-4b1c-8d12-260af0597689'::uuid, true, 'Magnet Permanente', 'magnetic-permanente-blox-fruits', 3500, 38, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/58dcbb5e-473d-4b9f-a372-712e6c42b20a.webp', array['magnet', 'magnetic']::text[]),
  ('92c81487-7b51-4270-bbec-7af82923ab9a'::uuid, true, 'Kitsune Permanente', 'kitsune-permanente-blox-fruits', 4000, 39, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/6b223142-b234-4410-8a45-01c3538f0a7b.webp', array['kitsune']::text[]),
  ('2bff2ad8-daf2-46cd-905b-c84f98b0dff4'::uuid, true, null, 'control-permanente-blox-fruits', null, 40, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/526c93b5-8ab5-461e-9686-02b7860a0078.webp', array['control']::text[]),
  ('37e9f0cc-9853-404b-9be3-8ca4512ef53c'::uuid, true, null, 'dragon-permanente-blox-fruits', null, 41, 'https://athucowvfccegkzgcnli.supabase.co/storage/v1/object/public/catalog-media/products/eccaf248-12b3-449d-8306-39633d6dcd05.webp', array['dragon']::text[]);

-- All catalog changes are atomic. The lock coordinates repeat executions;
-- row locks serialize stock conversion with checkout/giveaway reservations.
do $preflight$
begin
  perform pg_advisory_xact_lock(hashtextextended('gwstore:permanent-fruits:f629ea16-c538-455c-a671-02f4a52edec1', 0));

  if not exists (
    select 1 from public.games
    where id = '4ae2512f-a698-4f2c-976e-3719ff6b0299'
      and slug = 'blox-fruits' and status = 'active' and archived_at is null
  ) or not exists (
    select 1 from public.substores
    where id = '0eb87e38-4219-461f-bdad-fd5b8682fd4f'
      and game_id = '4ae2512f-a698-4f2c-976e-3719ff6b0299'
      and slug = 'frutas-permanentes' and status = 'active' and archived_at is null
  ) or not exists (
    select 1 from public.catalog_stores
    where id = 'f629ea16-c538-455c-a671-02f4a52edec1'
      and game_id = '4ae2512f-a698-4f2c-976e-3719ff6b0299'
      and name = 'Frutas Permanentes' and status = 'active' and archived_at is null
  ) then
    raise exception 'GW permanent fruit target scope changed; review before importing.';
  end if;

  perform product.id
  from public.products as product
  join gwstore_permanent_fruit_import as seed on seed.id = product.id
  order by product.id
  for update of product;

  if exists (
    select 1
    from gwstore_permanent_fruit_import as seed
    left join public.products as product on product.id = seed.id
    where (seed.was_existing and product.id is null)
      or (product.id is not null and (
        product.substore_id <> '0eb87e38-4219-461f-bdad-fd5b8682fd4f'
        or product.catalog_store_id <> 'f629ea16-c538-455c-a671-02f4a52edec1'
        or product.archived_at is not null
        or product.slug <> seed.slug
      ))
  ) then
    raise exception 'A known permanent fruit is missing, archived, moved, or has a different slug.';
  end if;

  -- Slug uniqueness is category-wide, including products in another store.
  if exists (
    select 1 from public.products as product
    join gwstore_permanent_fruit_import as seed on lower(product.slug) = lower(seed.slug)
    where product.substore_id = '0eb87e38-4219-461f-bdad-fd5b8682fd4f'
      and product.archived_at is null and product.id <> seed.id
  ) then
    raise exception 'A permanent fruit slug belongs to another product; preserve its ID instead.';
  end if;

  -- Compare whole normalized fruit names, never substring matches. Accept
  -- supplied Portuguese aliases and the reviewed Budha/Magnetic/Rumble names.
  if exists (
    select 1
    from public.products as product
    cross join lateral (
      select regexp_replace(
        regexp_replace(
          lower(translate(product.name, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')),
          '\m(perm|permanente|permanentes|permanent|fruta|frutas|fruit|fruits|blox)\M', '', 'g'
        ), '[^a-z0-9]', '', 'g'
      ) as fruit_key
    ) as normalized
    join gwstore_permanent_fruit_import as seed
      on normalized.fruit_key = any(seed.aliases)
    where product.substore_id = '0eb87e38-4219-461f-bdad-fd5b8682fd4f'
      and product.archived_at is null and product.id <> seed.id
  ) then
    raise exception 'Ambiguous permanent fruit alias; reconcile existing IDs before importing.';
  end if;

  -- Avoid silently excluding unexpected live rows from the final 42-item list.
  if exists (
    select 1 from public.products as product
    where product.catalog_store_id = 'f629ea16-c538-455c-a671-02f4a52edec1'
      and product.archived_at is null
      and not exists (select 1 from gwstore_permanent_fruit_import as seed where seed.id = product.id)
  ) then
    raise exception 'The permanent fruit store has unreviewed products; refresh the import plan.';
  end if;

  if exists (
    select 1 from public.inventory_units as unit
    join gwstore_permanent_fruit_import as seed on seed.id = unit.product_id
    where unit.status = 'reserved'
  ) or exists (
    select 1 from public.giveaway_prizes as prize
    join public.giveaways as giveaway on giveaway.id = prize.giveaway_id
    join gwstore_permanent_fruit_import as seed on seed.id = prize.product_id
    where giveaway.status in ('scheduled', 'active', 'drawing')
      and giveaway.stock_released_at is null
  ) then
    raise exception 'Reserved legacy inventory or giveaway stock must be resolved before unlimited conversion.';
  end if;
end
$preflight$;

-- Preserve the 14 existing records, including all historical foreign keys.
-- Control/Dragon intentionally keep their current name and sale price.
update public.products as product
set name = coalesce(seed.display_name, product.name),
    minimum_price_cents = coalesce(seed.robux::bigint * 4, product.minimum_price_cents),
    sort_order = seed.display_order,
    unlimited_stock = true,
    stock_quantity = 0
from gwstore_permanent_fruit_import as seed
where seed.was_existing and product.id = seed.id;

-- Existing rows on a second execution retain later manual photos/descriptions
-- and active/inactive state; only authorized table fields are reapplied.
insert into public.products (
  id, substore_id, catalog_store_id, name, slug, description,
  minimum_price_cents, image_url, status, sort_order,
  unlimited_stock, stock_quantity, low_stock_threshold
)
select seed.id,
       '0eb87e38-4219-461f-bdad-fd5b8682fd4f'::uuid,
       'f629ea16-c538-455c-a671-02f4a52edec1'::uuid,
       seed.display_name,
       seed.slug,
       'Fruta permanente de Blox Fruits. Após confirmação do pagamento, acompanhe a entrega no seu ticket.',
       seed.robux::bigint * 4,
       seed.initial_image_url,
       'active'::public.catalog_status,
       seed.display_order,
       true, 0, 0
from gwstore_permanent_fruit_import as seed
where not seed.was_existing
on conflict (id) do update
set name = excluded.name,
    minimum_price_cents = excluded.minimum_price_cents,
    sort_order = excluded.sort_order,
    unlimited_stock = true,
    stock_quantity = 0;

do $verify$
begin
  if (
    select count(*) from public.products as product
    join gwstore_permanent_fruit_import as seed on seed.id = product.id
    where product.substore_id = '0eb87e38-4219-461f-bdad-fd5b8682fd4f'
      and product.catalog_store_id = 'f629ea16-c538-455c-a671-02f4a52edec1'
      and product.archived_at is null and product.unlimited_stock and product.stock_quantity = 0
      and product.sort_order = seed.display_order
      and (seed.robux is null or product.minimum_price_cents = seed.robux::bigint * 4)
  ) <> 42 then
    raise exception 'Permanent fruit import verification failed; the entire operation is rolled back.';
  end if;
end
$verify$;

commit;

-- First application: 42 products, 42 unlimited, 17 with photos.
-- Later manual photos are preserved, so the photo count can legitimately rise.
select count(*)::integer as produtos,
       count(*) filter (where unlimited_stock and stock_quantity = 0)::integer as sem_limite,
       count(*) filter (where image_url is not null)::integer as com_foto
from public.products
where substore_id = '0eb87e38-4219-461f-bdad-fd5b8682fd4f'
  and catalog_store_id = 'f629ea16-c538-455c-a671-02f4a52edec1'
  and archived_at is null;
