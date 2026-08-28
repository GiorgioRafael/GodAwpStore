-- The roulette was changed from one prize per redemption to a redemption
-- header plus item rows. The hard-delete guard still inspected the removed
-- `roulette_redemptions.product_id` column, so every otherwise-unused product
-- failed with SQLSTATE 42703 instead of being deleted.

begin;

set local lock_timeout = '5s';

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
    -- Multi-item roulette redemptions store product references in this table.
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

commit;
