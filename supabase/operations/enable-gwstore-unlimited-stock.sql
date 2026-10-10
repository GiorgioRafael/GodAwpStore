-- Temporary unlimited sales for the isolated GWStore database only.
-- Confirm project athucowvfccegkzgcnli and acknowledge in the SAME session:
-- set app.gwstore_confirmed_project_ref = 'athucowvfccegkzgcnli';
-- Keep the existing scalar stock as backing inventory for historical releases
-- and giveaways. It is not consumed by unlimited product purchases.
-- The audit snapshot is a reference for a later recount, not an automatic rollback
-- quantity: historical returns and giveaways may change backing stock meanwhile.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;

do $gw_unlimited_stock$
declare
  v_run_id constant uuid := 'd2323838-9dd6-43df-8267-e161f0f777bc';
  v_constraint text;
  v_products jsonb;
begin
  if current_setting('app.gwstore_confirmed_project_ref', true) is distinct from 'athucowvfccegkzgcnli'
    or not exists (select 1 from public.guilds where discord_guild_id = '1401264061101899820')
    or exists (select 1 from public.guilds where discord_guild_id is distinct from '1401264061101899820')
    or not exists (select 1 from public.games where id = '4ae2512f-a698-4f2c-976e-3719ff6b0299' and slug = 'blox-fruits') then
    raise exception 'Confirm the isolated GWStore project before changing stock mode.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gwstore:unlimited-stock', 0));

  -- DDL needs an exclusive lock. Take it up front to avoid an upgrade deadlock
  -- with checkout; keep the transaction short and bounded by the timeouts above.
  lock table public.products in access exclusive mode;
  select pg_get_constraintdef(oid) into strict v_constraint
    from pg_constraint where conrelid = 'public.products'::regclass
      and conname = 'products_service_has_no_stock' and convalidated;
  if v_constraint not in (
    'CHECK (((NOT unlimited_stock) OR (stock_quantity = 0)))',
    'CHECK (((NOT unlimited_stock) OR (stock_quantity >= 0)))'
  ) or not exists (
    select 1 from pg_constraint where conrelid = 'public.products'::regclass
      and conname = 'products_stock_quantity_range' and convalidated
  ) then
    raise exception 'Unexpected stock constraints; review before changing stock mode.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'product_id', id, 'stock_quantity', stock_quantity,
    'unlimited_stock', unlimited_stock, 'low_stock_threshold', low_stock_threshold
  ) order by id) into v_products from public.products where archived_at is null;
  if v_products is null then raise exception 'GWStore catalog is empty.'; end if;

  if exists (select 1 from public.audit_events
    where request_id = v_run_id and action = 'catalog.gwstore.unlimited_stock_enabled')
    and exists (select 1 from public.products where archived_at is null and not unlimited_stock) then
    raise exception 'Catalog changed after this operation; use a fresh audited run before enabling again.';
  end if;
  if not exists (select 1 from public.audit_events
    where request_id = v_run_id and action = 'catalog.gwstore.unlimited_stock_enabled') then
    insert into public.audit_events (action, entity_type, entity_id, request_id, metadata)
    values ('catalog.gwstore.unlimited_stock_enabled', 'catalog',
      '4ae2512f-a698-4f2c-976e-3719ff6b0299', v_run_id, jsonb_build_object(
        'project_ref', 'athucowvfccegkzgcnli', 'discord_guild_id', '1401264061101899820',
        'previous_constraint', v_constraint, 'previous_products', v_products,
        'temporary', true, 'preserves_backing_inventory', true));
  end if;

  if v_constraint = 'CHECK (((NOT unlimited_stock) OR (stock_quantity = 0)))' then
    alter table public.products drop constraint products_service_has_no_stock;
    alter table public.products add constraint products_service_has_no_stock
      check (not unlimited_stock or stock_quantity >= 0);
  end if;
  -- Do not clear backing stock or change prices, status, archived rows or reservations.
  update public.products set unlimited_stock = true
    where archived_at is null and not unlimited_stock;
  if exists (select 1 from public.products where archived_at is null and not unlimited_stock) then
    raise exception 'Unlimited stock verification failed; changes are rolled back.';
  end if;
end
$gw_unlimited_stock$;
commit;

select count(*)::integer as produtos,
  count(*) filter (where unlimited_stock)::integer as estoque_ilimitado,
  count(*) filter (where not unlimited_stock)::integer as estoque_limitado
from public.products where archived_at is null;
