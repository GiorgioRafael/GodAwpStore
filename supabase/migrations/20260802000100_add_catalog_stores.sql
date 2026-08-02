-- Independent catalog stores let one game expose multiple worlds. Products and
-- their scalar stock move together, while historical orders keep referencing
-- the same immutable product id.

create table public.catalog_stores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  name text not null,
  slug text not null,
  status public.catalog_status not null default 'active',
  is_default boolean not null default false,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references public.admin_profiles(auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_stores_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint catalog_stores_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint catalog_stores_archive_state check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  )
);

create unique index catalog_stores_game_slug_active_uidx
  on public.catalog_stores (game_id, lower(slug))
  where archived_at is null;
create unique index catalog_stores_game_default_uidx
  on public.catalog_stores (game_id)
  where is_default and archived_at is null;
create index catalog_stores_game_status_order_idx
  on public.catalog_stores (game_id, status, sort_order, name)
  where archived_at is null;
create index catalog_stores_created_by_idx
  on public.catalog_stores (created_by)
  where created_by is not null;

insert into public.catalog_stores (
  game_id, name, slug, status, is_default, sort_order, archived_at, created_by
)
select game.id, game.name, 'loja-principal', game.status,
       true, 0, game.archived_at, game.created_by
from public.games as game;

create or replace function public.ensure_default_catalog_store()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.catalog_stores (
    game_id, name, slug, status, is_default, sort_order, archived_at, created_by
  ) values (
    new.id,
    new.name,
    'loja-principal',
    new.status,
    true,
    0,
    new.archived_at,
    new.created_by
  )
  on conflict do nothing;
  return new;
end
$$;

revoke all on function public.ensure_default_catalog_store() from public;
drop trigger if exists games_ensure_default_catalog_store on public.games;
create trigger games_ensure_default_catalog_store
after insert on public.games
for each row execute function public.ensure_default_catalog_store();

alter table public.products
  add column catalog_store_id uuid;

update public.products as product
set catalog_store_id = store.id
from public.substores as substore
join public.catalog_stores as store
  on store.game_id = substore.game_id
 and store.is_default
where substore.id = product.substore_id;

alter table public.products
  alter column catalog_store_id set not null,
  add constraint products_catalog_store_id_fkey
    foreign key (catalog_store_id) references public.catalog_stores(id) on delete restrict;

create index products_catalog_store_status_order_idx
  on public.products (catalog_store_id, status, sort_order, name)
  where archived_at is null;

create or replace function public.assign_default_product_catalog_store()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.catalog_store_id is null then
    select store.id into new.catalog_store_id
    from public.substores as substore
    join public.catalog_stores as store
      on store.game_id = substore.game_id
     and store.is_default
     and store.archived_at is null
    where substore.id = new.substore_id;
  end if;
  return new;
end
$$;

revoke all on function public.assign_default_product_catalog_store() from public;
drop trigger if exists products_assign_catalog_store on public.products;
create trigger products_assign_catalog_store
before insert or update of substore_id, catalog_store_id
on public.products
for each row execute function public.assign_default_product_catalog_store();

create or replace function public.enforce_product_catalog_store()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_substore_game_id uuid;
  v_store_game_id uuid;
begin
  select substore.game_id into v_substore_game_id
  from public.substores as substore
  where substore.id = new.substore_id;

  select store.game_id into v_store_game_id
  from public.catalog_stores as store
  where store.id = new.catalog_store_id
    and store.status <> 'archived'
    and store.archived_at is null;

  if v_substore_game_id is null or v_store_game_id is null then
    raise exception using errcode = '23503', message = 'product_catalog_scope_not_found';
  end if;
  if v_substore_game_id <> v_store_game_id then
    raise exception using errcode = '23514', constraint = 'products_catalog_store_game_match',
      message = 'products_catalog_store_game_match';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_product_catalog_store() from public;

drop trigger if exists products_enforce_catalog_store on public.products;
create trigger products_enforce_catalog_store
before insert or update of substore_id, catalog_store_id
on public.products
for each row execute function public.enforce_product_catalog_store();

create or replace function public.enforce_active_product_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and new.archived_at is null then
    perform pg_advisory_xact_lock(
      hashtextextended('gwstore:active-products:' || new.catalog_store_id::text, 0)
    );

    if (
      select count(*)
      from public.products as product
      where product.catalog_store_id = new.catalog_store_id
        and product.status = 'active'
        and product.archived_at is null
        and product.id <> new.id
    ) >= 25 then
      raise exception using
        errcode = '23514',
        constraint = 'products_active_limit',
        message = 'products_active_limit';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_active_product_limit() from public;

drop trigger if exists products_enforce_active_limit on public.products;
create trigger products_enforce_active_limit
before insert or update of catalog_store_id, status, archived_at
on public.products
for each row execute function public.enforce_active_product_limit();

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
  v_active_target_count integer;
  v_active_moving_count integer;
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

  perform pg_advisory_xact_lock(
    hashtextextended('gwstore:active-products:' || p_target_store_id::text, 0)
  );
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

  select count(*) into v_active_target_count
  from public.products as product
  where product.catalog_store_id = p_target_store_id
    and product.status = 'active'
    and product.archived_at is null
    and not (product.id = any(p_product_ids));
  select count(*) into v_active_moving_count
  from public.products as product
  where product.id = any(p_product_ids)
    and product.status = 'active'
    and product.archived_at is null;
  if v_active_target_count + v_active_moving_count > 25 then
    raise exception using errcode = '23514', constraint = 'products_active_limit',
      message = 'products_active_limit';
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

comment on table public.catalog_stores is
  'Independent storefront/world folders. Every product and its stock belongs to exactly one store.';
comment on column public.products.catalog_store_id is
  'Store/world that owns this product and its current stock.';
comment on function public.admin_move_products_to_catalog_store(uuid[], uuid) is
  'Atomically moves whole product SKUs and their stock between stores of the same game.';

drop trigger if exists catalog_stores_set_updated_at on public.catalog_stores;
create trigger catalog_stores_set_updated_at
before update on public.catalog_stores
for each row execute function private.set_updated_at();
drop trigger if exists catalog_stores_audit_mutation on public.catalog_stores;
create trigger catalog_stores_audit_mutation
after insert or update on public.catalog_stores
for each row execute function private.audit_admin_mutation();

alter table public.catalog_stores enable row level security;
alter table public.catalog_stores force row level security;
drop policy if exists catalog_stores_admin_all on public.catalog_stores;
create policy catalog_stores_admin_all
on public.catalog_stores for all to authenticated
using (private.is_admin()) with check (private.is_admin());

revoke all on table public.catalog_stores from anon, authenticated;
grant select, insert, update on table public.catalog_stores to authenticated;
revoke all on function public.admin_move_products_to_catalog_store(uuid[], uuid) from public;
revoke all on function public.admin_move_products_to_catalog_store(uuid[], uuid) from anon;
grant execute on function public.admin_move_products_to_catalog_store(uuid[], uuid) to authenticated;
grant execute on function public.admin_move_products_to_catalog_store(uuid[], uuid) to service_role;
