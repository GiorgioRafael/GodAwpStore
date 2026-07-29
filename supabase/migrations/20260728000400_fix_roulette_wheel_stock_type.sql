-- The wheel editor never loaded: both of its reads declared the stock column as
-- integer while public.products.stock_quantity is bigint, so Postgres refused
-- the result with "structure of query does not match function result type" and
-- the admin page showed an empty card where the editor should be.
--
-- The declarations now follow the column instead of guessing at it.

begin;

set local lock_timeout = '5s';

drop function if exists public.admin_roulette_wheel();
drop function if exists public.admin_roulette_prize_candidates();

/** Every slot as the panel needs it, with the odds already worked out. */
create function public.admin_roulette_wheel()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_value_cents bigint,
  slot_stock_quantity bigint,
  slot_draw_weight integer,
  slot_draw_chance_bps integer,
  slot_held_units bigint,
  slot_archived boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_total_weight bigint;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  select coalesce(sum(slot.draw_weight), 0)
  into v_total_weight
  from public.roulette_prize_products as slot;

  return query
  select
    slot.prize_key,
    product.id,
    coalesce(product.name, 'Produto removido'),
    coalesce(product.minimum_price_cents, 0)::bigint,
    coalesce(product.stock_quantity, 0)::bigint,
    slot.draw_weight,
    case
      when v_total_weight > 0 then ((slot.draw_weight::bigint * 10000) / v_total_weight)::integer
      else 0
    end,
    coalesce(
      (
        select sum(item.quantity)
        from public.roulette_demo_inventory as item
        where item.prize_key = slot.prize_key
      ),
      0
    )::bigint,
    product.archived_at is not null
  from public.roulette_prize_products as slot
  left join public.products as product on product.id = slot.product_id
  order by slot.prize_key;
end;
$$;

revoke all on function public.admin_roulette_wheel()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_wheel() to authenticated;

/** Products that can go on the wheel: live, priced and not archived. */
create function public.admin_roulette_prize_candidates()
returns table (
  candidate_id uuid,
  candidate_name text,
  candidate_value_cents bigint,
  candidate_stock_quantity bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  return query
  select
    product.id,
    product.name,
    product.minimum_price_cents::bigint,
    coalesce(product.stock_quantity, 0)::bigint
  from public.products as product
  where product.archived_at is null
    and product.status = 'active'
    and product.minimum_price_cents > 0
  order by product.minimum_price_cents, product.name
  limit 500;
end;
$$;

revoke all on function public.admin_roulette_prize_candidates()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_prize_candidates() to authenticated;

commit;
