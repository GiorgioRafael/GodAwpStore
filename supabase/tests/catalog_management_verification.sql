begin;

set local client_min_messages = warning;

insert into public.games (id, name, slug, status)
values
  ('b1000000-0000-4000-8000-000000000001', 'Catalog controls A', 'catalog-controls-a', 'active'),
  ('b1000000-0000-4000-8000-000000000002', 'Catalog controls B', 'catalog-controls-b', 'active');

insert into public.catalog_stores (id, game_id, name, slug, status)
values
  (
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'Empty world',
    'empty-world',
    'active'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001',
    'Used world',
    'used-world',
    'active'
  );

insert into public.substores (id, game_id, name, slug, title, status)
values (
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'Control items',
  'control-items',
  'Control items',
  'active'
);

insert into public.products (
  id,
  substore_id,
  catalog_store_id,
  name,
  slug,
  minimum_price_cents,
  stock_quantity,
  status,
  discord_application_emoji_id,
  discord_application_emoji_source_sha256
)
values
  (
    'b4000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002',
    'Unused product',
    'unused-product',
    100,
    0,
    'active',
    '123456789012345678',
    repeat('a', 64)
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002',
    'Stocked product',
    'stocked-product',
    100,
    2,
    'active',
    null,
    null
  ),
  (
    'b4000000-0000-4000-8000-000000000003',
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002',
    'Historical product',
    'historical-product',
    100,
    0,
    'active',
    null,
    null
  );

insert into public.inventory_batches (
  id, product_id, source, import_method, unit_count
) values (
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000003',
  'historical test',
  'manual',
  1
);

select set_config(
  'request.jwt.claims',
  '{"sub":"b6000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  begin
    perform public.admin_update_catalog_store(
      'b2000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      'Moved world',
      'moved-world',
      'https://example.com/non-admin-banner.webp'
    );
    raise exception 'non-admin unexpectedly moved a catalog store';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_delete_unused_product(
      'b4000000-0000-4000-8000-000000000001'
    );
    raise exception 'non-admin unexpectedly deleted a product';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
begin
  begin
    delete from public.products
    where id = 'b4000000-0000-4000-8000-000000000001';
    raise exception 'direct product hard delete unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v_deleted jsonb;
begin
  if not public.admin_update_catalog_store(
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    'Moved world',
    'moved-world',
    'https://example.com/store-banner.webp'
  ) then
    raise exception 'empty store update returned false';
  end if;

  begin
    perform public.admin_update_catalog_store(
      'b2000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000002',
      'Used world',
      'used-world',
      null
    );
    raise exception 'store with products unexpectedly changed games';
  exception when check_violation then null;
  end;

  begin
    perform public.admin_update_catalog_store(
      (
        select id from public.catalog_stores
        where game_id = 'b1000000-0000-4000-8000-000000000001'
          and is_default
      ),
      'b1000000-0000-4000-8000-000000000002',
      'Default store',
      'default-store',
      null
    );
    raise exception 'default store unexpectedly changed games';
  exception when check_violation then null;
  end;

  begin
    perform public.admin_delete_unused_product(
      'b4000000-0000-4000-8000-000000000002'
    );
    raise exception 'stocked product unexpectedly deleted';
  exception when check_violation then null;
  end;

  begin
    perform public.admin_delete_unused_product(
      'b4000000-0000-4000-8000-000000000003'
    );
    raise exception 'historical product unexpectedly deleted';
  exception when check_violation then null;
  end;

  v_deleted := public.admin_delete_unused_product(
    'b4000000-0000-4000-8000-000000000001'
  );
  if v_deleted ->> 'discord_application_emoji_id' <> '123456789012345678' then
    raise exception 'deleted product did not return its Discord emoji id';
  end if;
end
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.catalog_stores
    where id = 'b2000000-0000-4000-8000-000000000001'
      and game_id = 'b1000000-0000-4000-8000-000000000002'
      and name = 'Moved world'
      and slug = 'moved-world'
      and banner_url = 'https://example.com/store-banner.webp'
  ) then
    raise exception 'empty store was not moved and renamed';
  end if;
  if exists (
    select 1 from public.products
    where id = 'b4000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'unused product was not deleted';
  end if;
  if (
    select count(*) from public.products
    where id in (
      'b4000000-0000-4000-8000-000000000002',
      'b4000000-0000-4000-8000-000000000003'
    )
  ) <> 2 then
    raise exception 'protected products were removed';
  end if;
  if has_function_privilege(
    'anon',
    'public.admin_update_catalog_store(uuid,uuid,text,text,text)',
    'execute'
  ) then
    raise exception 'anon can update catalog stores';
  end if;
  if has_function_privilege(
    'anon',
    'public.admin_delete_unused_product(uuid)',
    'execute'
  ) then
    raise exception 'anon can hard-delete products';
  end if;
end
$$;

rollback;

select 'Catalog management verification passed' as result;
