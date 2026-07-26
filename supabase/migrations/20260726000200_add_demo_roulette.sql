-- Free GWStore roulette prototype.
-- Demo prizes are intentionally isolated from commerce stock, balances and
-- Discord delivery so the future cashback version can replace them safely.

begin;

set local lock_timeout = '5s';

create table public.roulette_demo_inventory (
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  discord_user_id text not null,
  prize_key text not null,
  quantity integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (auth_user_id, prize_key),
  constraint roulette_demo_inventory_discord_id_format
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  constraint roulette_demo_inventory_prize_key
    check (prize_key in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5')),
  constraint roulette_demo_inventory_quantity_positive
    check (quantity > 0)
);

create table public.roulette_demo_spins (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  discord_user_id text not null,
  prize_key text not null,
  created_at timestamptz not null default now(),
  constraint roulette_demo_spins_discord_id_format
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  constraint roulette_demo_spins_prize_key
    check (prize_key in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5'))
);

create index roulette_demo_spins_user_created_idx
  on public.roulette_demo_spins (auth_user_id, created_at desc);

create trigger roulette_demo_inventory_set_updated_at
before update on public.roulette_demo_inventory
for each row execute function private.set_updated_at();

alter table public.roulette_demo_inventory enable row level security;
alter table public.roulette_demo_inventory force row level security;
alter table public.roulette_demo_spins enable row level security;
alter table public.roulette_demo_spins force row level security;

create policy roulette_demo_inventory_owner_select
on public.roulette_demo_inventory
for select
to authenticated
using (auth.uid() = auth_user_id);

create policy roulette_demo_spins_owner_select
on public.roulette_demo_spins
for select
to authenticated
using (auth.uid() = auth_user_id);

revoke all on table public.roulette_demo_inventory
  from public, anon, authenticated, service_role;
revoke all on table public.roulette_demo_spins
  from public, anon, authenticated, service_role;
grant select on table public.roulette_demo_inventory to authenticated;
grant select on table public.roulette_demo_spins to authenticated;
grant select, insert, update, delete on table public.roulette_demo_inventory to service_role;
grant select, insert, update, delete on table public.roulette_demo_spins to service_role;

create function public.get_demo_roulette_inventory()
returns table (
  prize_key text,
  quantity integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  return query
  select
    inventory.prize_key,
    inventory.quantity,
    inventory.updated_at
  from public.roulette_demo_inventory as inventory
  where inventory.auth_user_id = v_auth_user_id
  order by inventory.prize_key;
end;
$$;

create function public.spin_demo_roulette(p_discord_user_id text)
returns table (
  spin_id uuid,
  prize_key text,
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
  v_prize_key text;
  v_spin_id uuid;
  v_inventory_quantity integer;
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

  -- Serialize spins for the same account and keep accidental double clicks
  -- from creating multiple results while the wheel is already animating.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_auth_user_id::text)
  );
  if exists (
    select 1
    from public.roulette_demo_spins as recent
    where recent.auth_user_id = v_auth_user_id
      and recent.created_at > v_spun_at - interval '2 seconds'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Wait for the current spin to finish.';
  end if;

  v_prize_key := 'premio_' || (
    1 + pg_catalog.floor(pg_catalog.random() * 5)
  )::integer::text;

  insert into public.roulette_demo_spins (
    auth_user_id,
    discord_user_id,
    prize_key,
    created_at
  )
  values (
    v_auth_user_id,
    p_discord_user_id,
    v_prize_key,
    v_spun_at
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
    v_auth_user_id,
    p_discord_user_id,
    v_prize_key,
    1,
    v_spun_at,
    v_spun_at
  )
  on conflict (auth_user_id, prize_key)
  do update set
    discord_user_id = excluded.discord_user_id,
    quantity = public.roulette_demo_inventory.quantity + 1,
    updated_at = excluded.updated_at
  returning quantity into v_inventory_quantity;

  return query
  select v_spin_id, v_prize_key, v_inventory_quantity, v_spun_at;
end;
$$;

revoke all on function public.get_demo_roulette_inventory()
  from public, anon, authenticated, service_role;
revoke all on function public.spin_demo_roulette(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_demo_roulette_inventory() to authenticated;
grant execute on function public.spin_demo_roulette(text) to authenticated;
grant execute on function public.get_demo_roulette_inventory() to service_role;
grant execute on function public.spin_demo_roulette(text) to service_role;

comment on table public.roulette_demo_inventory is
  'Disposable inventory for the free GWStore roulette prototype.';
comment on table public.roulette_demo_spins is
  'Audit trail for free GWStore roulette prototype spins.';
comment on function public.spin_demo_roulette(text) is
  'Creates one free demo spin and atomically increments the authenticated user inventory.';

commit;
