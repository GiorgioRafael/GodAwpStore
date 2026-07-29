-- Tune the ladder without leaving the roulette page.
--
-- A slot is worth whatever its product costs, so building a payout meant
-- bouncing between the wheel and the catalog and re-reading the RTP after each
-- hop. This lets the price be edited where the consequence is visible.
--
-- It is the catalog price, not a roulette-only one: the same product is sold in
-- the store, so the panel says so before saving. Prizes already won keep the
-- value frozen at win time and are not touched.

begin;

set local lock_timeout = '5s';

/**
 * Repricing a product that sits on the wheel. Restricted to products actually
 * on the wheel: this is the roulette's editor, not a second catalog with
 * different rules and a different audit story.
 */
create or replace function public.admin_update_roulette_prize_price(
  p_product_id uuid,
  p_price_cents integer
)
returns table (
  updated_product_id uuid,
  updated_product_name text,
  updated_price_cents integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_product public.products%rowtype;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  if p_product_id is null or p_price_cents is null then
    raise exception using
      errcode = '22023',
      message = 'The product and the price are both required.';
  end if;
  if p_price_cents < 1 or p_price_cents > 10000000 then
    raise exception using
      errcode = '22023',
      message = 'A prize price must be between 1 cent and R$ 100000.';
  end if;

  if not exists (
    select 1
    from public.roulette_prize_products as slot
    where slot.product_id = p_product_id
  ) then
    raise exception using
      errcode = 'P0021',
      message = 'This product is not on the roulette wheel.';
  end if;

  update public.products as product
  set minimum_price_cents = p_price_cents
  where product.id = p_product_id
    and product.archived_at is null
  returning * into v_product;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Product was not found.';
  end if;

  return query select v_product.id, v_product.name, v_product.minimum_price_cents;
end;
$$;

revoke all on function public.admin_update_roulette_prize_price(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_update_roulette_prize_price(uuid, integer) to authenticated;

comment on function public.admin_update_roulette_prize_price(uuid, integer) is
  'Reprices a product that sits on the roulette wheel. The catalog price is shared with the store; prizes already won keep their frozen value.';

commit;
