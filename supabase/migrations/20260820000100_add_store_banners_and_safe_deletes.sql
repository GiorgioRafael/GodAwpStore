-- Store-specific Discord storefront banners and guarded administrative hard deletes.
-- Historical and operational rows are never cascaded by these operations.

alter table public.catalog_stores
  add column if not exists banner_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_stores_banner_url_https'
      and conrelid = 'public.catalog_stores'::regclass
  ) then
    alter table public.catalog_stores
      add constraint catalog_stores_banner_url_https check (
        banner_url is null
        or (
          char_length(banner_url) between 1 and 2048
          and banner_url ~ '^https://[^[:space:]]+$'
        )
      );
  end if;
end
$$;

drop function if exists public.admin_update_catalog_store(uuid, uuid, text, text);

create or replace function public.admin_update_catalog_store(
  p_store_id uuid,
  p_game_id uuid,
  p_name text,
  p_slug text,
  p_banner_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_store_id is null
    or p_game_id is null
    or btrim(coalesce(p_name, '')) = ''
    or btrim(coalesce(p_slug, '')) = ''
  then
    raise exception 'catalog_store_update_invalid' using errcode = '22023';
  end if;

  update public.catalog_stores
  set game_id = p_game_id,
      name = btrim(p_name),
      slug = btrim(p_slug),
      banner_url = nullif(btrim(p_banner_url), '')
  where id = p_store_id
    and status = 'active'
    and archived_at is null;

  if not found then
    raise exception 'catalog_store_not_found' using errcode = 'P0002';
  end if;
  return true;
end
$$;

comment on function public.admin_update_catalog_store(uuid, uuid, text, text, text) is
  'Atomically renames a catalog store, moves an empty non-default store and updates its optional HTTPS storefront banner.';

revoke all on function public.admin_update_catalog_store(uuid, uuid, text, text, text) from public;
revoke all on function public.admin_update_catalog_store(uuid, uuid, text, text, text) from anon;
grant execute on function public.admin_update_catalog_store(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.admin_update_catalog_store(uuid, uuid, text, text, text) to service_role;

create or replace function private.reject_managed_hard_delete_unless_authorized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.managed_hard_delete_authorized', true) is distinct from 'on' then
    raise exception 'immutable_record' using errcode = '55000';
  end if;
  return old;
end
$$;

revoke all on function private.reject_managed_hard_delete_unless_authorized() from public;

create or replace function private.reject_product_hard_delete_unless_authorized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.product_hard_delete_authorized', true) is distinct from 'on' then
    raise exception 'immutable_record' using errcode = '55000';
  end if;
  return old;
end
$$;

revoke all on function private.reject_product_hard_delete_unless_authorized() from public;

drop trigger if exists games_no_hard_delete on public.games;
create trigger games_no_hard_delete
before delete on public.games
for each row execute function private.reject_managed_hard_delete_unless_authorized();

drop trigger if exists substores_no_hard_delete on public.substores;
create trigger substores_no_hard_delete
before delete on public.substores
for each row execute function private.reject_managed_hard_delete_unless_authorized();

drop trigger if exists whitelist_entries_no_hard_delete on public.whitelist_entries;
create trigger whitelist_entries_no_hard_delete
before delete on public.whitelist_entries
for each row execute function private.reject_managed_hard_delete_unless_authorized();

drop trigger if exists catalog_stores_no_hard_delete on public.catalog_stores;
create trigger catalog_stores_no_hard_delete
before delete on public.catalog_stores
for each row execute function private.reject_managed_hard_delete_unless_authorized();

create or replace function public.admin_delete_unused_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_game public.games%rowtype;
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_game_id is null then
    raise exception 'game_delete_invalid' using errcode = '22023';
  end if;

  select game.* into v_game
  from public.games as game
  where game.id = p_game_id
  for update;

  if not found then
    raise exception 'game_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.catalog_stores as store
  where store.game_id = p_game_id
  order by store.id
  for update;

  if exists (
    select 1 from public.substores as substore where substore.game_id = p_game_id
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'game_has_substores',
      message = 'game_has_substores';
  end if;
  if exists (
    select 1
    from public.products as product
    join public.catalog_stores as store on store.id = product.catalog_store_id
    where store.game_id = p_game_id
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'game_has_products',
      message = 'game_has_products';
  end if;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_actor,
    (select profile.discord_user_id from public.admin_profiles as profile where profile.auth_user_id = v_actor),
    'catalog.game.delete',
    'game',
    v_game.id,
    jsonb_build_object('name', v_game.name, 'slug', v_game.slug)
  );

  perform set_config('app.managed_hard_delete_authorized', 'on', true);
  delete from public.catalog_stores where game_id = p_game_id;
  delete from public.games where id = p_game_id;

  return jsonb_build_object('deleted', true, 'game_id', v_game.id);
end
$$;

create or replace function public.admin_delete_unused_substore(p_substore_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_substore public.substores%rowtype;
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_substore_id is null then
    raise exception 'substore_delete_invalid' using errcode = '22023';
  end if;

  select substore.* into v_substore
  from public.substores as substore
  where substore.id = p_substore_id
  for update;

  if not found then
    raise exception 'substore_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.products as product where product.substore_id = p_substore_id
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'substore_has_products',
      message = 'substore_has_products';
  end if;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_actor,
    (select profile.discord_user_id from public.admin_profiles as profile where profile.auth_user_id = v_actor),
    'catalog.substore.delete',
    'substore',
    v_substore.id,
    jsonb_build_object('name', v_substore.name, 'game_id', v_substore.game_id)
  );

  perform set_config('app.managed_hard_delete_authorized', 'on', true);
  delete from public.substores where id = p_substore_id;

  return jsonb_build_object('deleted', true, 'substore_id', v_substore.id);
end
$$;

create or replace function public.admin_delete_unused_catalog_store(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_store public.catalog_stores%rowtype;
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_store_id is null then
    raise exception 'catalog_store_delete_invalid' using errcode = '22023';
  end if;

  select store.* into v_store
  from public.catalog_stores as store
  where store.id = p_store_id
  for update;

  if not found then
    raise exception 'catalog_store_not_found' using errcode = 'P0002';
  end if;
  if v_store.is_default then
    raise exception using
      errcode = '23514',
      constraint = 'catalog_store_default_protected',
      message = 'catalog_store_default_protected';
  end if;
  if exists (
    select 1 from public.products as product where product.catalog_store_id = p_store_id
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'catalog_store_has_products',
      message = 'catalog_store_has_products';
  end if;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_actor,
    (select profile.discord_user_id from public.admin_profiles as profile where profile.auth_user_id = v_actor),
    'catalog.store.delete',
    'catalog_store',
    v_store.id,
    jsonb_build_object('name', v_store.name, 'game_id', v_store.game_id)
  );

  perform set_config('app.managed_hard_delete_authorized', 'on', true);
  delete from public.catalog_stores where id = p_store_id;

  return jsonb_build_object('deleted', true, 'catalog_store_id', v_store.id);
end
$$;

create or replace function public.admin_delete_unused_whitelist_entry(p_whitelist_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.whitelist_entries%rowtype;
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_whitelist_entry_id is null then
    raise exception 'whitelist_delete_invalid' using errcode = '22023';
  end if;

  select entry.* into v_entry
  from public.whitelist_entries as entry
  where entry.id = p_whitelist_entry_id
  for update;

  if not found then
    raise exception 'whitelist_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.guilds where whitelist_entry_id = p_whitelist_entry_id) then
    raise exception using errcode = '23514', constraint = 'whitelist_has_guilds', message = 'whitelist_has_guilds';
  end if;
  if exists (select 1 from public.orders where seller_whitelist_entry_id = p_whitelist_entry_id) then
    raise exception using errcode = '23514', constraint = 'whitelist_has_orders', message = 'whitelist_has_orders';
  end if;
  if exists (select 1 from public.payouts where whitelist_entry_id = p_whitelist_entry_id)
    or exists (select 1 from public.ledger_entries where whitelist_entry_id = p_whitelist_entry_id)
  then
    raise exception using errcode = '23514', constraint = 'whitelist_has_financial_history', message = 'whitelist_has_financial_history';
  end if;
  if exists (select 1 from public.upsell_offers where seller_whitelist_entry_id = p_whitelist_entry_id) then
    raise exception using errcode = '23514', constraint = 'whitelist_has_upsells', message = 'whitelist_has_upsells';
  end if;
  if exists (select 1 from public.lead_recovery_offers where seller_whitelist_entry_id = p_whitelist_entry_id) then
    raise exception using errcode = '23514', constraint = 'whitelist_has_lead_recovery', message = 'whitelist_has_lead_recovery';
  end if;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_actor,
    (select profile.discord_user_id from public.admin_profiles as profile where profile.auth_user_id = v_actor),
    'whitelist.entry.delete',
    'whitelist_entry',
    v_entry.id,
    jsonb_build_object('discord_id', v_entry.discord_id, 'label', v_entry.label)
  );

  perform set_config('app.managed_hard_delete_authorized', 'on', true);
  begin
    delete from public.whitelist_entries where id = p_whitelist_entry_id;
  exception
    when foreign_key_violation then
      raise exception using
        errcode = '23514',
        constraint = 'whitelist_has_history',
        message = 'whitelist_has_history';
  end;

  return jsonb_build_object('deleted', true, 'whitelist_entry_id', v_entry.id);
end
$$;

create or replace function public.admin_delete_unused_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_product public.products%rowtype;
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'product_delete_invalid' using errcode = '22023';
  end if;

  select product.* into v_product
  from public.products as product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if v_product.stock_quantity <> 0 then
    raise exception using errcode = '23514', constraint = 'product_stock_remaining', message = 'product_stock_remaining';
  end if;
  if exists (select 1 from public.inventory_batches where product_id = p_product_id)
    or exists (select 1 from public.inventory_units where product_id = p_product_id)
  then
    raise exception using
      errcode = '23514',
      constraint = 'product_has_inventory_history',
      message = 'product_has_inventory_history';
  end if;
  if exists (select 1 from public.orders where product_id = p_product_id or upsell_product_id = p_product_id)
    or exists (select 1 from public.order_items where product_id = p_product_id)
  then
    raise exception using errcode = '23514', constraint = 'product_has_orders', message = 'product_has_orders';
  end if;
  if exists (select 1 from public.giveaway_prizes where product_id = p_product_id) then
    raise exception using
      errcode = '23514',
      constraint = 'product_has_giveaways',
      message = 'product_has_giveaways';
  end if;
  if exists (select 1 from public.upsell_offers where offered_product_id = p_product_id)
    or exists (select 1 from public.lead_recovery_offers where original_upsell_product_id = p_product_id)
  then
    raise exception using errcode = '23514', constraint = 'product_has_offers', message = 'product_has_offers';
  end if;
  if exists (select 1 from public.roulette_prize_products where product_id = p_product_id)
    or exists (select 1 from public.roulette_redemption_items where product_id = p_product_id)
    or exists (select 1 from public.roulette_demo_inventory where product_id = p_product_id)
  then
    raise exception using
      errcode = '23514',
      constraint = 'product_has_roulette_history',
      message = 'product_has_roulette_history';
  end if;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_actor,
    (select profile.discord_user_id from public.admin_profiles as profile where profile.auth_user_id = v_actor),
    'catalog.product.delete',
    'product',
    v_product.id,
    jsonb_build_object(
      'name', v_product.name,
      'catalog_store_id', v_product.catalog_store_id,
      'substore_id', v_product.substore_id
    )
  );

  perform set_config('app.product_hard_delete_authorized', 'on', true);
  delete from public.products where id = p_product_id;

  return jsonb_build_object(
    'deleted', true,
    'product_id', v_product.id,
    'discord_application_emoji_id', v_product.discord_application_emoji_id
  );
end
$$;

comment on function public.admin_delete_unused_game(uuid) is
  'Permanently deletes a game without categories or products and removes only its empty catalog stores in the same transaction.';
comment on function public.admin_delete_unused_substore(uuid) is
  'Permanently deletes a category only when no product references it.';
comment on function public.admin_delete_unused_catalog_store(uuid) is
  'Permanently deletes a non-default catalog store only when no product, including archived products, references it.';
comment on function public.admin_delete_unused_whitelist_entry(uuid) is
  'Permanently deletes a whitelist entry only when it has no server, order, financial or sales history.';
comment on function public.admin_delete_unused_product(uuid) is
  'Permanently deletes a zero-stock product only when no historical or operational row references it.';

revoke all on function public.admin_delete_unused_game(uuid) from public;
revoke all on function public.admin_delete_unused_game(uuid) from anon;
grant execute on function public.admin_delete_unused_game(uuid) to authenticated;
grant execute on function public.admin_delete_unused_game(uuid) to service_role;

revoke all on function public.admin_delete_unused_substore(uuid) from public;
revoke all on function public.admin_delete_unused_substore(uuid) from anon;
grant execute on function public.admin_delete_unused_substore(uuid) to authenticated;
grant execute on function public.admin_delete_unused_substore(uuid) to service_role;

revoke all on function public.admin_delete_unused_catalog_store(uuid) from public;
revoke all on function public.admin_delete_unused_catalog_store(uuid) from anon;
grant execute on function public.admin_delete_unused_catalog_store(uuid) to authenticated;
grant execute on function public.admin_delete_unused_catalog_store(uuid) to service_role;

revoke all on function public.admin_delete_unused_whitelist_entry(uuid) from public;
revoke all on function public.admin_delete_unused_whitelist_entry(uuid) from anon;
grant execute on function public.admin_delete_unused_whitelist_entry(uuid) to authenticated;
grant execute on function public.admin_delete_unused_whitelist_entry(uuid) to service_role;

revoke all on function public.admin_delete_unused_product(uuid) from public;
revoke all on function public.admin_delete_unused_product(uuid) from anon;
grant execute on function public.admin_delete_unused_product(uuid) to authenticated;
grant execute on function public.admin_delete_unused_product(uuid) to service_role;
