-- Expand catalog administration without weakening the historical guarantees:
-- stores may change games only while empty and products may be hard-deleted
-- only when they have never participated in stock or commercial workflows.

create or replace function private.enforce_catalog_store_game_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.game_id is not distinct from old.game_id then
    return new;
  end if;
  if old.is_default then
    raise exception using
      errcode = '23514',
      constraint = 'catalog_store_default_game_protected',
      message = 'catalog_store_default_game_protected';
  end if;
  if exists (
    select 1
    from public.products as product
    where product.catalog_store_id = old.id
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'catalog_store_game_has_products',
      message = 'catalog_store_game_has_products';
  end if;
  if not exists (
    select 1
    from public.games as game
    where game.id = new.game_id
      and game.status = 'active'
      and game.archived_at is null
  ) then
    raise exception 'catalog_store_target_game_unavailable' using errcode = '23503';
  end if;
  return new;
end
$$;

revoke all on function private.enforce_catalog_store_game_change() from public;
drop trigger if exists catalog_stores_enforce_game_change on public.catalog_stores;
create trigger catalog_stores_enforce_game_change
before update of game_id on public.catalog_stores
for each row execute function private.enforce_catalog_store_game_change();

create or replace function public.admin_update_catalog_store(
  p_store_id uuid,
  p_game_id uuid,
  p_name text,
  p_slug text
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
  if p_store_id is null or p_game_id is null then
    raise exception 'catalog_store_update_invalid' using errcode = '22023';
  end if;

  update public.catalog_stores
  set game_id = p_game_id,
      name = btrim(p_name),
      slug = p_slug
  where id = p_store_id
    and status = 'active'
    and archived_at is null;

  if not found then
    raise exception 'catalog_store_not_found' using errcode = 'P0002';
  end if;
  return true;
end
$$;

comment on function public.admin_update_catalog_store(uuid, uuid, text, text) is
  'Renames a catalog store and safely moves an empty non-default store to another active game.';

revoke all on function public.admin_update_catalog_store(uuid, uuid, text, text) from public;
revoke all on function public.admin_update_catalog_store(uuid, uuid, text, text) from anon;
grant execute on function public.admin_update_catalog_store(uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_update_catalog_store(uuid, uuid, text, text) to service_role;

create or replace function private.reject_product_hard_delete_unless_authorized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.product_hard_delete_authorized', true) <> 'on' then
    raise exception 'immutable_record' using errcode = '55000';
  end if;
  return old;
end
$$;

revoke all on function private.reject_product_hard_delete_unless_authorized() from public;
drop trigger if exists products_no_hard_delete on public.products;
create trigger products_no_hard_delete
before delete on public.products
for each row execute function private.reject_product_hard_delete_unless_authorized();

create or replace function public.admin_delete_unused_product(
  p_product_id uuid
)
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
    raise exception using
      errcode = '23514',
      constraint = 'product_stock_remaining',
      message = 'product_stock_remaining';
  end if;
  if exists (select 1 from public.inventory_batches where product_id = p_product_id)
    or exists (select 1 from public.inventory_units where product_id = p_product_id)
    or exists (select 1 from public.orders where product_id = p_product_id or upsell_product_id = p_product_id)
    or exists (select 1 from public.order_items where product_id = p_product_id)
    or exists (select 1 from public.giveaway_prizes where product_id = p_product_id)
    or exists (select 1 from public.upsell_offers where offered_product_id = p_product_id)
    or exists (select 1 from public.lead_recovery_offers where original_upsell_product_id = p_product_id)
    or exists (select 1 from public.roulette_prize_products where product_id = p_product_id)
    or exists (select 1 from public.roulette_redemptions where product_id = p_product_id)
    or exists (select 1 from public.roulette_redemption_items where product_id = p_product_id)
    or exists (select 1 from public.roulette_demo_inventory where product_id = p_product_id)
  then
    raise exception using
      errcode = '23514',
      constraint = 'product_has_history',
      message = 'product_has_history';
  end if;

  if v_actor is not null then
    insert into public.audit_events (
      actor_auth_user_id,
      actor_discord_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    select
      v_actor,
      profile.discord_user_id,
      'catalog.product.delete',
      'product',
      v_product.id,
      jsonb_build_object(
        'name', v_product.name,
        'catalog_store_id', v_product.catalog_store_id,
        'substore_id', v_product.substore_id
      )
    from public.admin_profiles as profile
    where profile.auth_user_id = v_actor
      and profile.is_active;
  end if;

  perform set_config('app.product_hard_delete_authorized', 'on', true);
  delete from public.products where id = p_product_id;

  return jsonb_build_object(
    'deleted', true,
    'product_id', v_product.id,
    'discord_application_emoji_id', v_product.discord_application_emoji_id
  );
end
$$;

comment on function public.admin_delete_unused_product(uuid) is
  'Permanently deletes a zero-stock product only when no historical or operational row references it.';

revoke all on function public.admin_delete_unused_product(uuid) from public;
revoke all on function public.admin_delete_unused_product(uuid) from anon;
grant execute on function public.admin_delete_unused_product(uuid) to authenticated;
grant execute on function public.admin_delete_unused_product(uuid) to service_role;
