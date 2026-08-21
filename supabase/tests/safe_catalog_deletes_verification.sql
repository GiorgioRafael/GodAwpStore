begin;

set local client_min_messages = warning;

insert into public.games (id, name, slug, status)
values
  ('c1000000-0000-4000-8000-000000000001', 'Empty delete game', 'empty-delete-game', 'active'),
  ('c1000000-0000-4000-8000-000000000002', 'Used delete game', 'used-delete-game', 'active');

insert into public.catalog_stores (id, game_id, name, slug, status, banner_url)
values
  (
    'c2000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002',
    'Empty secondary store',
    'empty-secondary-store',
    'active',
    'https://example.com/world.webp'
  ),
  (
    'c2000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000002',
    'Used secondary store',
    'used-secondary-store',
    'active',
    null
  );

insert into public.substores (id, game_id, name, slug, title, status)
values
  (
    'c3000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002',
    'Empty category',
    'empty-category',
    'Empty category',
    'active'
  ),
  (
    'c3000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000002',
    'Used category',
    'used-category',
    'Used category',
    'active'
  );

insert into public.products (
  id, substore_id, catalog_store_id, name, slug, minimum_price_cents,
  stock_quantity, status, archived_at
) values (
  'c4000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000002',
  'Archived dependency',
  'archived-dependency',
  100,
  0,
  'archived',
  now()
);

insert into public.whitelist_entries (id, discord_id, label)
values
  ('c5000000-0000-4000-8000-000000000001', '12345678901234567', 'Empty whitelist'),
  ('c5000000-0000-4000-8000-000000000002', '12345678901234568', 'Used whitelist');

insert into public.guilds (
  id, discord_guild_id, owner_discord_id, whitelist_entry_id, name, status
) values (
  'c6000000-0000-4000-8000-000000000001',
  '22345678901234567',
  '32345678901234567',
  'c5000000-0000-4000-8000-000000000002',
  'Delete dependency guild',
  'active'
);

do $$
begin
  begin
    update public.catalog_stores
    set banner_url = 'http://example.com/insecure.webp'
    where id = 'c2000000-0000-4000-8000-000000000001';
    raise exception 'insecure store banner unexpectedly passed validation';
  exception when check_violation then null;
  end;

  begin
    delete from public.substores where id = 'c3000000-0000-4000-8000-000000000001';
    raise exception 'direct category hard delete unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  begin
    perform public.admin_delete_unused_game('c1000000-0000-4000-8000-000000000001');
    raise exception 'non-admin unexpectedly deleted a game';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_delete_unused_substore('c3000000-0000-4000-8000-000000000001');
    raise exception 'non-admin unexpectedly deleted a category';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_delete_unused_catalog_store('c2000000-0000-4000-8000-000000000001');
    raise exception 'non-admin unexpectedly deleted a store';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_delete_unused_whitelist_entry('c5000000-0000-4000-8000-000000000001');
    raise exception 'non-admin unexpectedly deleted a whitelist entry';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
begin
  begin
    perform public.admin_delete_unused_game('c1000000-0000-4000-8000-000000000002');
    raise exception 'game with categories unexpectedly deleted';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_delete_unused_substore('c3000000-0000-4000-8000-000000000002');
    raise exception 'category with an archived product unexpectedly deleted';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_delete_unused_catalog_store('c2000000-0000-4000-8000-000000000002');
    raise exception 'store with an archived product unexpectedly deleted';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_delete_unused_catalog_store((
      select id from public.catalog_stores
      where game_id = 'c1000000-0000-4000-8000-000000000002' and is_default
    ));
    raise exception 'default store unexpectedly deleted';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_delete_unused_whitelist_entry('c5000000-0000-4000-8000-000000000002');
    raise exception 'whitelist entry linked to a guild unexpectedly deleted';
  exception when check_violation then null;
  end;

  perform public.admin_delete_unused_catalog_store('c2000000-0000-4000-8000-000000000001');
  perform public.admin_delete_unused_substore('c3000000-0000-4000-8000-000000000001');
  perform public.admin_delete_unused_whitelist_entry('c5000000-0000-4000-8000-000000000001');
  perform public.admin_delete_unused_game('c1000000-0000-4000-8000-000000000001');
end
$$;

reset role;

do $$
begin
  if exists (select 1 from public.catalog_stores where id = 'c2000000-0000-4000-8000-000000000001') then
    raise exception 'empty secondary store was not deleted';
  end if;
  if exists (select 1 from public.substores where id = 'c3000000-0000-4000-8000-000000000001') then
    raise exception 'empty category was not deleted';
  end if;
  if exists (select 1 from public.whitelist_entries where id = 'c5000000-0000-4000-8000-000000000001') then
    raise exception 'empty whitelist entry was not deleted';
  end if;
  if exists (select 1 from public.games where id = 'c1000000-0000-4000-8000-000000000001')
    or exists (select 1 from public.catalog_stores where game_id = 'c1000000-0000-4000-8000-000000000001')
  then
    raise exception 'empty game or its default store was not deleted atomically';
  end if;
  if (
    select count(*) from public.audit_events
    where action in (
      'catalog.game.delete',
      'catalog.substore.delete',
      'catalog.store.delete',
      'whitelist.entry.delete'
    )
      and entity_id in (
        'c1000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000001',
        'c3000000-0000-4000-8000-000000000001',
        'c5000000-0000-4000-8000-000000000001'
      )
  ) <> 4 then
    raise exception 'safe hard deletes did not emit all audit events';
  end if;

  if has_function_privilege('anon', 'public.admin_delete_unused_game(uuid)', 'execute')
    or has_function_privilege('anon', 'public.admin_delete_unused_substore(uuid)', 'execute')
    or has_function_privilege('anon', 'public.admin_delete_unused_catalog_store(uuid)', 'execute')
    or has_function_privilege('anon', 'public.admin_delete_unused_whitelist_entry(uuid)', 'execute')
  then
    raise exception 'anon can execute a protected hard-delete RPC';
  end if;
end
$$;

rollback;

select 'Safe catalog deletes verification passed' as result;
