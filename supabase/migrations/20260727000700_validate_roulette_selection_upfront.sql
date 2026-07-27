-- Validate the whole roulette selection before touching the inventory.
-- The duplicate check used to run line by line, so a selection that repeated a
-- prize the player no longer owned failed with "not in the inventory" instead
-- of naming the real problem. Shape, quantity and duplicates are now rejected
-- up front, before any prize moves.

begin;

set local lock_timeout = '5s';

create or replace function private.read_roulette_item_selection(p_items jsonb)
returns table (selected_prize_key text, selected_quantity integer)
language plpgsql
immutable
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must be an array.';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_items);
  if v_count < 1 or v_count > 5 then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must hold 1 to 5 prizes.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry
    where entry.value ->> 'prize_key' is null
      or entry.value ->> 'prize_key' not in (
        'premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5'
      )
      or (entry.value ->> 'quantity') !~ '^[0-9]+$'
      or (entry.value ->> 'quantity')::bigint < 1
      or (entry.value ->> 'quantity')::bigint > 10000
  ) then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection has an invalid line.';
  end if;

  select count(distinct entry.value ->> 'prize_key')
  into v_distinct
  from jsonb_array_elements(p_items) as entry;

  if v_distinct <> v_count then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection repeats a prize.';
  end if;

  return query
  select
    entry.value ->> 'prize_key',
    (entry.value ->> 'quantity')::integer
  from jsonb_array_elements(p_items) as entry;
end;
$$;

revoke all on function private.read_roulette_item_selection(jsonb)
  from public, anon, authenticated, service_role;

comment on function private.read_roulette_item_selection(jsonb) is
  'Parses and fully validates a roulette prize selection before any prize moves.';

commit;
