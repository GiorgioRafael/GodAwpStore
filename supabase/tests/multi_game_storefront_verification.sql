begin;

set local client_min_messages = warning;

update public.products
set status = 'inactive', archived_at = null
where status = 'active';

insert into public.games (id, name, slug, status)
values
  (
    '93000000-0000-4000-8000-000000000001',
    'Multi storefront game A',
    'multi-storefront-game-a',
    'active'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    'Multi storefront game B',
    'multi-storefront-game-b',
    'active'
  );

insert into public.substores (id, game_id, name, slug, title, status)
values
  (
    '93100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    'Game A products',
    'multi-storefront-game-a-products',
    'Game A products',
    'active'
  ),
  (
    '93100000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002',
    'Game B products',
    'multi-storefront-game-b-products',
    'Game B products',
    'active'
  );

insert into public.products (
  substore_id,
  name,
  slug,
  minimum_price_cents,
  status
)
select
  case when item <= 25
    then '93100000-0000-4000-8000-000000000001'::uuid
    else '93100000-0000-4000-8000-000000000002'::uuid
  end,
  'Multi storefront product ' || item,
  'multi-storefront-product-' || item,
  100,
  'active'
from generate_series(1, 50) item;

do $$
begin
  if (
    select count(*)
    from public.products
    where slug like 'multi-storefront-product-%'
      and status = 'active'
  ) <> 50 then
    raise exception 'products from two independent storefronts were globally limited';
  end if;

  insert into public.products (
    substore_id,
    name,
    slug,
    minimum_price_cents,
    status
  ) values (
    '93100000-0000-4000-8000-000000000002',
    'Game B product 26',
    'multi-storefront-game-b-product-26',
    100,
    'active'
  );

  if (
    select count(*)
    from public.products
    where slug like 'multi-storefront-%'
      and status = 'active'
  ) <> 51 then
    raise exception 'A catalog store still limits active products';
  end if;
end
$$;

rollback;

select 'Multi-game storefront verification passed' as result;
