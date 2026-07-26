-- Run after migrations with a privileged local connection:
--   psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file supabase/tests/roulette_demo_verification.sql
-- Verifies that the roulette can only be spun through a paid LivePix charge and
-- that the administrator bypass stays out of reach of browser sessions.

do $$
declare
  required_table text;
  required_function text;
begin
  foreach required_table in array array[
    'roulette_demo_inventory',
    'roulette_demo_spins',
    'roulette_prize_products',
    'roulette_spin_charges'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Missing roulette table: %', required_table;
    end if;
    if not exists (
      select 1
      from pg_class
      where oid = ('public.' || required_table)::regclass
        and relrowsecurity
        and relforcerowsecurity
    ) then
      raise exception 'Roulette table % must force row level security', required_table;
    end if;
  end loop;

  foreach required_function in array array[
    'get_roulette_prizes()',
    'start_roulette_spin_charge(text)',
    'get_roulette_spin_charge(uuid)',
    'claim_roulette_spin_checkout(uuid, uuid)',
    'register_roulette_spin_checkout(uuid, uuid, text, text)',
    'release_roulette_spin_checkout_claim(uuid, uuid)',
    'claim_roulette_spin_provider_check(uuid, integer)',
    'confirm_roulette_spin_payment(text, text, text, integer, text, timestamptz, text)',
    'spin_paid_roulette(text, uuid)',
    'spin_roulette_as_admin(uuid, text)'
  ] loop
    if to_regprocedure('public.' || required_function) is null then
      raise exception 'Missing roulette function: %', required_function;
    end if;
  end loop;
end
$$;

do $$
begin
  -- The free spin entry point must not survive: it would bypass the charge.
  if to_regprocedure('public.spin_demo_roulette(text)') is not null then
    raise exception 'The free spin_demo_roulette entry point must be dropped';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.spin_roulette_as_admin(uuid, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not reach the free administrator spin';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.confirm_roulette_spin_payment(text, text, text, integer, text, timestamptz, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not confirm its own roulette payment';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.claim_roulette_spin_checkout(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not claim the LivePix checkout directly';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.register_roulette_spin_checkout(uuid, uuid, text, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not register a forged LivePix checkout';
  end if;

  if has_table_privilege('authenticated', 'public.roulette_spin_charges', 'SELECT')
    or has_table_privilege('authenticated', 'public.roulette_spin_charges', 'UPDATE')
    or has_table_privilege('authenticated', 'public.roulette_spin_charges', 'INSERT') then
    raise exception 'authenticated must reach spin charges only through the RPCs';
  end if;

  if has_table_privilege('authenticated', 'public.roulette_prize_products', 'UPDATE')
    or has_table_privilege('anon', 'public.roulette_prize_products', 'SELECT') then
    raise exception 'The roulette prize mapping must stay server-only';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.spin_paid_roulette(text, uuid)',
    'EXECUTE'
  ) then
    raise exception 'A player must be able to spend a paid roulette charge';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.start_roulette_spin_charge(text)',
    'EXECUTE'
  ) then
    raise exception 'A player must be able to open the roulette charge';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.get_roulette_prizes()',
    'EXECUTE'
  ) then
    raise exception 'A player must be able to read the five wheel slots';
  end if;

  if has_function_privilege('anon', 'public.start_roulette_spin_charge(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.spin_paid_roulette(text, uuid)', 'EXECUTE') then
    raise exception 'The roulette must stay closed to anonymous visitors';
  end if;
end
$$;

do $$
declare
  v_slots integer;
  v_products integer;
begin
  select count(*) into v_slots from public.roulette_prize_products;
  select count(*) into v_products
  from public.products
  where status = 'active' and archived_at is null;

  -- The temporary testing setup fills the wheel from the live catalog.
  if v_slots > 5 then
    raise exception 'The roulette cannot hold more than five slots, found %', v_slots;
  end if;
  if v_products > 0 and v_slots = 0 then
    raise exception 'The roulette slots were not seeded from the catalog';
  end if;

  if exists (
    select 1
    from public.roulette_prize_products as slot
    where slot.prize_key not in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5')
  ) then
    raise exception 'A roulette slot points at a key the wheel cannot draw';
  end if;

  if exists (
    select 1
    from public.roulette_prize_products as slot
    left join public.products as product on product.id = slot.product_id
    where product.id is null
  ) then
    raise exception 'A roulette slot points at a product that no longer exists';
  end if;
end
$$;
