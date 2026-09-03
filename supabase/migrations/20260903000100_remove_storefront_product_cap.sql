-- A Discord select has 25 options, but a catalog store must not inherit that
-- UI limitation. The bot now publishes additional selectors/messages as needed.
-- Remove the old database guard so operators can keep their whole catalog in a
-- single store without being blocked at the 26th product.

drop trigger if exists products_enforce_active_limit on public.products;
drop function if exists public.enforce_active_product_limit();

create or replace function public.admin_move_products_to_catalog_store(
  p_product_ids uuid[],
  p_target_store_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_requested_count integer;
  v_source_count integer;
  v_target_game_id uuid;
  v_updated_count integer;
begin
  if auth.role() <> 'service_role'
    and (v_actor is null or not private.is_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_target_store_id is null or p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception 'catalog_store_move_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_product_ids) as requested(product_id)
    group by requested.product_id having requested.product_id is null or count(*) > 1
  ) then
    raise exception 'catalog_store_move_invalid' using errcode = '22023';
  end if;

  select store.game_id into v_target_game_id
  from public.catalog_stores as store
  where store.id = p_target_store_id
    and store.status = 'active'
    and store.archived_at is null
  for update;
  if v_target_game_id is null then
    raise exception 'catalog_store_target_unavailable' using errcode = '23503';
  end if;

  perform product.id
  from public.products as product
  where product.id = any(p_product_ids)
  order by product.id
  for update;

  v_requested_count := cardinality(p_product_ids);
  select count(*) into v_source_count
  from public.products as product
  join public.substores as substore on substore.id = product.substore_id
  where product.id = any(p_product_ids)
    and product.archived_at is null
    and substore.game_id = v_target_game_id;
  if v_source_count <> v_requested_count then
    raise exception 'catalog_store_move_scope_mismatch' using errcode = '23514';
  end if;

  update public.products
  set catalog_store_id = p_target_store_id
  where id = any(p_product_ids)
    and catalog_store_id <> p_target_store_id;
  get diagnostics v_updated_count = row_count;

  if v_actor is not null then
    insert into public.audit_events (
      actor_auth_user_id, actor_discord_user_id, action, entity_type, entity_id, metadata
    )
    select v_actor, profile.discord_user_id, 'inventory.move_store', 'catalog_store',
      p_target_store_id,
      jsonb_build_object('product_ids', to_jsonb(p_product_ids), 'product_count', v_updated_count)
    from public.admin_profiles as profile
    where profile.auth_user_id = v_actor and profile.is_active;
  end if;
  return v_updated_count;
end
$$;

comment on function public.admin_move_products_to_catalog_store(uuid[], uuid) is
  'Atomically moves whole product SKUs and their stock between stores of the same game, without a catalog size cap.';

-- "Excluir loja" is a safe removal, not a destructive database delete. Keep
-- orders and stock history intact while taking the store and its current
-- products out of every active catalog and Discord storefront immediately.
create or replace function public.admin_archive_catalog_store(
  p_store_id uuid
)
returns boolean
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
    and store.archived_at is null
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

  update public.products
  set status = 'archived', archived_at = now()
  where catalog_store_id = p_store_id
    and archived_at is null;

  update public.catalog_stores
  set status = 'archived', archived_at = now()
  where id = p_store_id;

  return true;
end
$$;

comment on function public.admin_archive_catalog_store(uuid) is
  'Safely removes a non-default catalog store and archives its active products while preserving historical references.';

