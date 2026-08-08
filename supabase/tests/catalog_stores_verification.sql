begin;

set local client_min_messages = warning;

insert into public.games (id, name, slug, status)
values
  ('a1000000-0000-4000-8000-000000000001', 'World stores A', 'world-stores-a', 'active'),
  ('a1000000-0000-4000-8000-000000000002', 'World stores B', 'world-stores-b', 'active');

do $$
begin
  if (
    select count(*)
    from public.catalog_stores
    where game_id in (
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002'
    )
      and is_default
      and status = 'active'
  ) <> 2 then
    raise exception 'new games did not receive one default store each';
  end if;
end
$$;

insert into public.catalog_stores (id, game_id, name, slug, status)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Mundo 2',
    'mundo-2',
    'active'
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000002',
    'Outro jogo',
    'outro-jogo',
    'active'
  ),
  (
    'a2000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001',
    'Loja descartavel',
    'loja-descartavel',
    'active'
  );

insert into public.substores (id, game_id, name, slug, title, status)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Itens A',
    'itens-a',
    'Itens A',
    'active'
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000002',
    'Itens B',
    'itens-b',
    'Itens B',
    'active'
  );

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'Produto móvel',
  'produto-movel',
  100,
  37,
  'active'
);

do $$
begin
  if not exists (
    select 1
    from public.products as product
    join public.catalog_stores as store on store.id = product.catalog_store_id
    where product.id = 'a4000000-0000-4000-8000-000000000001'
      and store.is_default
      and store.game_id = 'a1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'product without explicit store was not assigned to the default store';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  begin
    perform public.admin_move_products_to_catalog_store(
      array['a4000000-0000-4000-8000-000000000001']::uuid[],
      'a2000000-0000-4000-8000-000000000001'
    );
    raise exception 'non-admin unexpectedly moved catalog stock';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.admin_archive_catalog_store(
      'a2000000-0000-4000-8000-000000000003'
    );
    raise exception 'non-admin unexpectedly archived a catalog store';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v_count integer;
begin
  v_count := public.admin_move_products_to_catalog_store(
    array['a4000000-0000-4000-8000-000000000001']::uuid[],
    'a2000000-0000-4000-8000-000000000001'
  );
  if v_count <> 1 then
    raise exception 'product move returned the wrong count';
  end if;
end
$$;

-- The RPC is security definer, so service_role only needs EXECUTE. Switch
-- back to the migration owner before inspecting the protected table directly.
reset role;

do $$
begin
  if not exists (
    select 1 from public.products
    where id = 'a4000000-0000-4000-8000-000000000001'
      and catalog_store_id = 'a2000000-0000-4000-8000-000000000001'
      and stock_quantity = 37
  ) then
    raise exception 'product or stock did not move atomically';
  end if;
end
$$;

set local role service_role;

do $$
begin
  begin
    perform public.admin_move_products_to_catalog_store(
      array['a4000000-0000-4000-8000-000000000001']::uuid[],
      'a2000000-0000-4000-8000-000000000002'
    );
    raise exception 'cross-game product move was unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.admin_archive_catalog_store(
      'a2000000-0000-4000-8000-000000000001'
    );
    raise exception 'non-empty catalog store was unexpectedly archived';
  exception when check_violation then null;
  end;

  begin
    perform public.admin_archive_catalog_store(
      'a2000000-0000-4000-8000-000000000001'
    );
    raise exception 'default catalog store was unexpectedly archived';
  exception when check_violation then null;
  end;

  if not public.admin_archive_catalog_store(
    'a2000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'empty catalog store archive returned false';
  end if;
end
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.catalog_stores
    where id = 'a2000000-0000-4000-8000-000000000003'
      and status = 'archived'
      and archived_at is not null
  ) then
    raise exception 'empty catalog store was not archived';
  end if;
end
$$;

do $$
begin
  if has_table_privilege('anon', 'public.catalog_stores', 'select') then
    raise exception 'anon can read catalog stores';
  end if;
  if has_function_privilege(
    'anon',
    'public.admin_move_products_to_catalog_store(uuid[],uuid)',
    'execute'
  ) then
    raise exception 'anon can execute the product move RPC';
  end if;
  if has_function_privilege(
    'anon',
    'public.admin_archive_catalog_store(uuid)',
    'execute'
  ) then
    raise exception 'anon can execute the catalog store archive RPC';
  end if;
end
$$;

rollback;

select 'Catalog stores verification passed' as result;
