-- Fix the roulette spin: every spin failed with 42702.
-- The spin functions declared their RETURNS TABLE columns as `spin_id` and
-- `prize_key`, which are also column names on the roulette tables. PL/pgSQL
-- resolves the ON CONFLICT inference target and the UPDATE predicates through
-- the same name lookup, so `on conflict (auth_user_id, prize_key)` was
-- ambiguous and Postgres refused the insert. Both the paid and the
-- administrator paths funnel through private.record_roulette_spin, so no spin
-- could be recorded at all.
--
-- Output columns are renamed to names no roulette table uses. The web app reads
-- the new names.

begin;

set local lock_timeout = '5s';

drop function if exists public.spin_paid_roulette(text, uuid);
drop function if exists public.spin_roulette_as_admin(uuid, text);
drop function if exists private.record_roulette_spin(uuid, text, timestamptz);

create function private.record_roulette_spin(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_spun_at timestamptz
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  inventory_quantity integer,
  spun_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_prize_keys text[];
  v_prize_key text;
  v_spin_id uuid;
  v_inventory_quantity integer;
begin
  -- Only slots that still resolve to a live product may be awarded, so the
  -- wheel drawn in the browser and the recorded prize never disagree.
  select array_agg(slot.prize_key order by slot.prize_key)
  into v_prize_keys
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  if v_prize_keys is null or array_length(v_prize_keys, 1) is null then
    v_prize_keys := array['premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5'];
  end if;

  v_prize_key := v_prize_keys[
    1 + floor(random() * array_length(v_prize_keys, 1))::integer
  ];

  insert into public.roulette_demo_spins (
    auth_user_id,
    discord_user_id,
    prize_key,
    created_at
  )
  values (
    p_auth_user_id,
    p_discord_user_id,
    v_prize_key,
    p_spun_at
  )
  returning id into v_spin_id;

  insert into public.roulette_demo_inventory (
    auth_user_id,
    discord_user_id,
    prize_key,
    quantity,
    created_at,
    updated_at
  )
  values (
    p_auth_user_id,
    p_discord_user_id,
    v_prize_key,
    1,
    p_spun_at,
    p_spun_at
  )
  on conflict (auth_user_id, prize_key)
  do update set
    discord_user_id = excluded.discord_user_id,
    quantity = public.roulette_demo_inventory.quantity + 1,
    updated_at = excluded.updated_at
  returning quantity into v_inventory_quantity;

  return query
  select v_spin_id, v_prize_key, v_inventory_quantity, p_spun_at;
end;
$$;

create function public.spin_paid_roulette(
  p_discord_user_id text,
  p_charge_id uuid
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  inventory_quantity integer,
  spun_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_charge public.roulette_spin_charges%rowtype;
  v_spin record;
  v_spun_at timestamptz := clock_timestamp();
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord user ID is invalid.';
  end if;

  select charge.*
  into v_charge
  from public.roulette_spin_charges as charge
  where charge.id = p_charge_id
    and charge.auth_user_id = v_auth_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette spin charge was not found.';
  end if;
  if v_charge.status = 'consumed' then
    raise exception using
      errcode = 'P0005',
      message = 'Roulette spin charge was already used.';
  end if;
  if v_charge.status <> 'paid' then
    raise exception using
      errcode = 'P0006',
      message = 'Roulette spin charge is not paid.';
  end if;

  select * into v_spin
  from private.record_roulette_spin(v_auth_user_id, v_charge.discord_user_id, v_spun_at);

  update public.roulette_spin_charges as charge
  set
    status = 'consumed',
    consumed_at = v_spun_at,
    spin_id = v_spin.recorded_spin_id
  where charge.id = v_charge.id;

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.inventory_quantity,
    v_spin.spun_at;
end;
$$;

-- Internal testing path. The web app resolves the administrator list from
-- ADMIN_DISCORD_IDS and calls this with the service-role client, so an
-- authenticated browser session can never reach it.
create function public.spin_roulette_as_admin(
  p_auth_user_id uuid,
  p_discord_user_id text
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  inventory_quantity integer,
  spun_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_spin record;
  v_spun_at timestamptz := clock_timestamp();
begin
  if p_auth_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'Auth user ID is required.';
  end if;
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord user ID is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_auth_user_id::text));
  if exists (
    select 1
    from public.roulette_demo_spins as recent
    where recent.auth_user_id = p_auth_user_id
      and recent.created_at > v_spun_at - interval '2 seconds'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Wait for the current spin to finish.';
  end if;

  select * into v_spin
  from private.record_roulette_spin(p_auth_user_id, p_discord_user_id, v_spun_at);

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.inventory_quantity,
    v_spin.spun_at;
end;
$$;

revoke all on function private.record_roulette_spin(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.spin_paid_roulette(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.spin_roulette_as_admin(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.spin_paid_roulette(text, uuid) to authenticated, service_role;
grant execute on function public.spin_roulette_as_admin(uuid, text) to service_role;

comment on function public.spin_paid_roulette(text, uuid) is
  'Consumes one paid roulette charge exactly once and records the resulting prize.';
comment on function public.spin_roulette_as_admin(uuid, text) is
  'Free roulette spin for internal administrator testing; service-role only.';

commit;
