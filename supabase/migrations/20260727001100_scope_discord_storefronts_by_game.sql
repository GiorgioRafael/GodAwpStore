-- A Discord select supports at most 25 products. Each game now owns an
-- independent storefront, so the limit must be enforced per game instead of
-- across the tenant's entire catalog.

create or replace function public.enforce_active_product_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_game_id uuid;
begin
  if new.status = 'active' and new.archived_at is null then
    select substore.game_id
    into v_game_id
    from public.substores substore
    where substore.id = new.substore_id;

    if v_game_id is null then
      raise exception using
        errcode = '23503',
        message = 'product_substore_not_found';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('gwstore:active-products:' || v_game_id::text, 0)
    );

    if (
      select count(*)
      from public.products product
      join public.substores substore on substore.id = product.substore_id
      where substore.game_id = v_game_id
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
before insert or update of substore_id, status, archived_at
on public.products
for each row
execute function public.enforce_active_product_limit();
