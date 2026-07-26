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

-- Structural checks alone let a spin that always raises 42702 reach production,
-- so the whole lifecycle is exercised here: open the charge, refuse the spin
-- while it is unpaid, settle it like the LivePix webhook does, spend it exactly
-- once, and take the free administrator path.

begin;

set local client_min_messages = warning;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '9a000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'roulette-player@example.invalid',
    '',
    now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"900000000000000001"}'::jsonb,
    now(),
    now()
  ),
  (
    '9a000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'roulette-admin@example.invalid',
    '',
    now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"900000000000000002"}'::jsonb,
    now(),
    now()
  );

select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select set_config(
  'roulette.charge_id',
  (select charge_id::text from public.start_roulette_spin_charge('900000000000000001')),
  true
);

do $$
begin
  if current_setting('roulette.charge_id', true) is null then
    raise exception 'The player could not open a roulette charge';
  end if;

  begin
    perform *
    from public.spin_paid_roulette(
      '900000000000000001',
      current_setting('roulette.charge_id')::uuid
    );
    raise exception 'An unpaid roulette charge produced a spin';
  exception
    when sqlstate 'P0006' then null;
  end;

  begin
    perform *
    from public.spin_roulette_as_admin(
      '9a000000-0000-4000-8000-000000000001',
      '900000000000000001'
    );
    raise exception 'A player reached the free administrator spin';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select *
from public.claim_roulette_spin_checkout(
  current_setting('roulette.charge_id')::uuid,
  '9b000000-0000-4000-8000-000000000001'
);

select *
from public.register_roulette_spin_checkout(
  current_setting('roulette.charge_id')::uuid,
  '9b000000-0000-4000-8000-000000000001',
  'roulette-verification-reference',
  'https://checkout.livepix.gg/roulette-verification'
);

do $$
declare
  v_confirmation record;
begin
  select * into v_confirmation
  from public.confirm_roulette_spin_payment(
    'roulette-verification-payment',
    'roulette-verification-proof',
    'roulette-verification-reference',
    100,
    'BRL',
    now(),
    repeat('a', 64)
  );
  if v_confirmation.charge_status <> 'paid' or not v_confirmation.first_confirmation then
    raise exception 'The LivePix confirmation did not pay the roulette charge';
  end if;

  -- A webhook redelivery must not pay twice.
  select * into v_confirmation
  from public.confirm_roulette_spin_payment(
    'roulette-verification-payment',
    'roulette-verification-proof',
    'roulette-verification-reference',
    100,
    'BRL',
    now(),
    repeat('a', 64)
  );
  if v_confirmation.first_confirmation then
    raise exception 'A replayed LivePix webhook confirmed the same spin twice';
  end if;
end
$$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_spin record;
begin
  select * into v_spin
  from public.spin_paid_roulette(
    '900000000000000001',
    current_setting('roulette.charge_id')::uuid
  );
  if v_spin.recorded_spin_id is null or v_spin.won_prize_key is null then
    raise exception 'The paid roulette spin returned no prize';
  end if;
  if v_spin.inventory_quantity <> 1 then
    raise exception 'The first paid spin should leave one item, found %', v_spin.inventory_quantity;
  end if;

  begin
    perform *
    from public.spin_paid_roulette(
      '900000000000000001',
      current_setting('roulette.charge_id')::uuid
    );
    raise exception 'A consumed roulette charge produced a second spin';
  exception
    when sqlstate 'P0005' then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare
  v_spin record;
begin
  select * into v_spin
  from public.spin_roulette_as_admin(
    '9a000000-0000-4000-8000-000000000002',
    '900000000000000002'
  );
  if v_spin.recorded_spin_id is null or v_spin.won_prize_key is null then
    raise exception 'The administrator spin returned no prize';
  end if;
  if v_spin.inventory_quantity <> 1 then
    raise exception
      'The first administrator spin should leave one item, found %',
      v_spin.inventory_quantity;
  end if;
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$
begin
  if (
    select charge.status
    from public.roulette_spin_charges as charge
    where charge.id = current_setting('roulette.charge_id')::uuid
  ) <> 'consumed' then
    raise exception 'The paid roulette charge was not consumed by the spin';
  end if;

  -- The administrator path is free: it must never open a charge.
  if (select count(*) from public.roulette_spin_charges) <> 1 then
    raise exception 'The administrator spin opened a roulette charge';
  end if;

  if (
    select count(*)
    from public.roulette_demo_spins
    where auth_user_id in (
      '9a000000-0000-4000-8000-000000000001',
      '9a000000-0000-4000-8000-000000000002'
    )
  ) <> 2 then
    raise exception 'The roulette did not record exactly one spin per player';
  end if;
end
$$;

rollback;
