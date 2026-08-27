-- Um produto inativo some da vitrine de compra, mas pode continuar sendo um
-- prêmio válido na roleta. Antes desta correção a roda já publicada continuava
-- visível para jogadores, porém o painel recusava qualquer salvamento que
-- incluísse uma dessas fatias.

begin;

set local lock_timeout = '5s';

create or replace function public.admin_roulette_prize_candidates()
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
    and product.status in ('active', 'inactive')
    and product.minimum_price_cents > 0
  order by product.minimum_price_cents, product.name
  limit 500;
end;
$$;

revoke all on function public.admin_roulette_prize_candidates()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_prize_candidates() to authenticated;

create or replace function public.admin_save_roulette_wheel(p_slots jsonb)
returns table (
  saved_slot_count integer,
  saved_total_weight bigint,
  saved_return_bps integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_slot record;
  v_product record;
  v_count integer := 0;
  v_total_weight bigint := 0;
  v_expected_value numeric := 0;
  v_spin_cost_cents constant integer := 100;
  v_maximum_slots constant integer := 10;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'The wheel must be sent as an array of slots.';
  end if;

  if jsonb_array_length(p_slots) < 1 or jsonb_array_length(p_slots) > v_maximum_slots then
    raise exception using
      errcode = '22023',
      message = format('The wheel holds 1 to %s slots.', v_maximum_slots);
  end if;

  if (
    select count(distinct entry.value ->> 'prize_key')
    from jsonb_array_elements(p_slots) as entry(value)
  ) <> jsonb_array_length(p_slots) then
    raise exception using
      errcode = '22023',
      message = 'The wheel repeats a slot.';
  end if;

  -- Valida a roda inteira antes de alterar qualquer fatia. Item inativo é
  -- permitido aqui: ele fica oculto da vitrine, não deixa de ser prêmio.
  for v_slot in
    select
      entry.value ->> 'prize_key' as prize_key,
      (entry.value ->> 'product_id')::uuid as product_id,
      (entry.value ->> 'draw_weight')::integer as draw_weight,
      coalesce((entry.value ->> 'prize_quantity')::integer, 1) as prize_quantity
    from jsonb_array_elements(p_slots) as entry(value)
  loop
    if v_slot.prize_key is null or v_slot.prize_key !~ '^premio_[1-9][0-9]?$' then
      raise exception using
        errcode = '22023',
        message = format('Slot %s is not a roulette slot.', coalesce(v_slot.prize_key, 'null'));
    end if;
    if (substring(v_slot.prize_key from '\d+'))::integer > v_maximum_slots then
      raise exception using
        errcode = '22023',
        message = format('The wheel holds 1 to %s slots.', v_maximum_slots);
    end if;
    if v_slot.draw_weight is null or v_slot.draw_weight < 1 or v_slot.draw_weight > 1000000 then
      raise exception using
        errcode = '22023',
        message = 'A slot weight must be between 1 and 1000000.';
    end if;
    if v_slot.prize_quantity is null
      or v_slot.prize_quantity < 1
      or v_slot.prize_quantity > 10000 then
      raise exception using
        errcode = '22023',
        message = 'A slot hands over between 1 and 10000 units.';
    end if;

    select product.id, product.name, product.minimum_price_cents, product.archived_at
    into v_product
    from public.products as product
    where product.id = v_slot.product_id;

    if not found or v_product.archived_at is not null then
      raise exception using
        errcode = '23503',
        message = 'A slot points at a product that no longer exists.';
    end if;
    if v_product.minimum_price_cents <= 0 then
      raise exception using
        errcode = '22023',
        message = format('%s has no price and cannot be a prize.', v_product.name);
    end if;

    v_count := v_count + 1;
    v_total_weight := v_total_weight + v_slot.draw_weight;
    v_expected_value :=
      v_expected_value
      + v_slot.draw_weight * v_product.minimum_price_cents * v_slot.prize_quantity;
  end loop;

  delete from public.roulette_prize_products as slot
  where slot.prize_key not in (
    select entry.value ->> 'prize_key'
    from jsonb_array_elements(p_slots) as entry(value)
  );

  insert into public.roulette_prize_products (prize_key, product_id, draw_weight, prize_quantity)
  select
    entry.value ->> 'prize_key',
    (entry.value ->> 'product_id')::uuid,
    (entry.value ->> 'draw_weight')::integer,
    coalesce((entry.value ->> 'prize_quantity')::integer, 1)
  from jsonb_array_elements(p_slots) as entry(value)
  on conflict (prize_key)
  do update set
    product_id = excluded.product_id,
    draw_weight = excluded.draw_weight,
    prize_quantity = excluded.prize_quantity;

  return query
  select
    v_count,
    v_total_weight,
    case
      when v_total_weight > 0
        then round((v_expected_value / v_total_weight / v_spin_cost_cents) * 10000)::integer
      else 0
    end;
end;
$$;

revoke all on function public.admin_save_roulette_wheel(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_roulette_wheel(jsonb) to authenticated;

commit;
