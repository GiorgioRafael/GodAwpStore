-- Public spin feed for the live overlay.
-- The overlay runs unauthenticated inside OBS, so it may never see a raw player
-- name. Every spin writes one already-masked row here — three letters and an
-- ellipsis — and nothing else identifying. The wheel prize, its value and a
-- top-prize flag are the only other fields.
--
-- The flag exists so the overlay can let a jackpot jump a full queue: normal
-- spins are dropped when the animation backlog is long, the biggest prize never
-- is.

begin;

set local lock_timeout = '5s';

create function private.mask_display_name(p_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_name is null or btrim(p_name) = '' then 'Jog...'
    when char_length(btrim(p_name)) <= 3 then btrim(p_name) || '...'
    else substr(btrim(p_name), 1, 3) || '...'
  end;
$$;

comment on function private.mask_display_name(text) is
  'Reduces a player name to three letters plus an ellipsis for the public overlay.';

create table public.roulette_overlay_events (
  id uuid primary key default gen_random_uuid(),
  prize_key text not null,
  product_name text not null,
  product_image_url text,
  value_cents bigint not null,
  masked_display_name text not null,
  is_top_prize boolean not null default false,
  created_at timestamptz not null default now(),
  constraint roulette_overlay_events_prize_key
    check (prize_key in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5')),
  constraint roulette_overlay_events_product_name_not_blank
    check (btrim(product_name) <> '' and char_length(product_name) <= 200),
  constraint roulette_overlay_events_value_not_negative check (value_cents >= 0),
  -- Anything longer than this would be leaking more than three letters.
  constraint roulette_overlay_events_masked_name
    check (btrim(masked_display_name) <> '' and char_length(masked_display_name) <= 6)
);

create index roulette_overlay_events_created_idx
  on public.roulette_overlay_events (created_at desc);

alter table public.roulette_overlay_events enable row level security;
alter table public.roulette_overlay_events force row level security;

revoke all on table public.roulette_overlay_events
  from public, anon, authenticated, service_role;
grant select on table public.roulette_overlay_events to anon, authenticated;
grant select, insert, update, delete on table public.roulette_overlay_events to service_role;

-- The overlay reads with the publishable key. Every column here is already safe
-- to show on a public stream.
create policy roulette_overlay_events_public_select
on public.roulette_overlay_events
for select
to anon, authenticated
using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'roulette_overlay_events'
  ) then
    execute 'alter publication supabase_realtime add table public.roulette_overlay_events';
  end if;
end
$$;

comment on table public.roulette_overlay_events is
  'Masked public feed of roulette spins, streamed to the live overlay.';

-- The spin functions gain the display name so the mask can be applied here
-- instead of trusting the browser with it.
drop function if exists public.spin_roulette(text);
drop function if exists public.spin_roulette_as_admin(uuid, text);
drop function if exists private.record_roulette_spin(uuid, text, timestamptz);

create function private.record_roulette_spin(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_display_name text,
  p_spun_at timestamptz
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  inventory_quantity integer
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
  v_product_name text;
  v_product_image_url text;
  v_value_cents bigint;
  v_top_value_cents bigint;
begin
  -- Weighted draw over the live slots: the exponential race picks each slot
  -- with probability proportional to its draw_weight in a single pass.
  select array_agg(slot.prize_key order by slot.prize_key)
  into v_prize_keys
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  if v_prize_keys is null or array_length(v_prize_keys, 1) is null then
    raise exception using
      errcode = 'P0009',
      message = 'The roulette has no prize configured.';
  end if;

  select slot.prize_key
  into v_prize_key
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null
  order by -ln(greatest(random(), 1e-12)) / slot.draw_weight
  limit 1;

  insert into public.roulette_demo_spins (
    auth_user_id,
    discord_user_id,
    prize_key,
    created_at
  )
  values (p_auth_user_id, p_discord_user_id, v_prize_key, p_spun_at)
  returning id into v_spin_id;

  insert into public.roulette_demo_inventory (
    auth_user_id,
    discord_user_id,
    prize_key,
    quantity,
    created_at,
    updated_at
  )
  values (p_auth_user_id, p_discord_user_id, v_prize_key, 1, p_spun_at, p_spun_at)
  on conflict (auth_user_id, prize_key)
  do update set
    discord_user_id = excluded.discord_user_id,
    quantity = public.roulette_demo_inventory.quantity + 1,
    updated_at = excluded.updated_at
  returning quantity into v_inventory_quantity;

  select product.name, product.image_url, product.minimum_price_cents::bigint
  into v_product_name, v_product_image_url, v_value_cents
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where slot.prize_key = v_prize_key;

  select max(product.minimum_price_cents)::bigint
  into v_top_value_cents
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  insert into public.roulette_overlay_events (
    prize_key,
    product_name,
    product_image_url,
    value_cents,
    masked_display_name,
    is_top_prize,
    created_at
  )
  values (
    v_prize_key,
    coalesce(v_product_name, 'Prêmio da roleta'),
    v_product_image_url,
    coalesce(v_value_cents, 0),
    private.mask_display_name(p_display_name),
    coalesce(v_value_cents, 0) >= coalesce(v_top_value_cents, 0)
      and coalesce(v_top_value_cents, 0) > 0,
    p_spun_at
  );

  -- The overlay only ever replays the last minutes, so the feed stays small.
  delete from public.roulette_overlay_events as stale
  where stale.created_at < p_spun_at - interval '1 hour';

  return query select v_spin_id, v_prize_key, v_inventory_quantity;
end;
$$;

create function public.spin_roulette(
  p_discord_user_id text,
  p_display_name text
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  won_inventory_quantity integer,
  coin_balance_cents bigint,
  spun_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_spin record;
  v_balance bigint;
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

  perform pg_advisory_xact_lock(hashtext(v_auth_user_id::text));
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

  if private.roulette_coin_balance(v_auth_user_id) < 100 then
    raise exception using
      errcode = 'P0007',
      message = 'Not enough roulette coins.';
  end if;

  select * into v_spin
  from private.record_roulette_spin(
    v_auth_user_id,
    p_discord_user_id,
    p_display_name,
    v_spun_at
  );

  v_balance := private.move_roulette_coins(
    v_auth_user_id,
    p_discord_user_id,
    'spin',
    -100,
    null,
    v_spin.recorded_spin_id,
    v_spin.won_prize_key
  );

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.inventory_quantity,
    v_balance,
    v_spun_at;
end;
$$;

create function public.spin_roulette_as_admin(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_display_name text
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  won_inventory_quantity integer,
  coin_balance_cents bigint,
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
  from private.record_roulette_spin(
    p_auth_user_id,
    p_discord_user_id,
    p_display_name,
    v_spun_at
  );

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.inventory_quantity,
    private.roulette_coin_balance(p_auth_user_id),
    v_spun_at;
end;
$$;

revoke all on function private.mask_display_name(text)
  from public, anon, authenticated, service_role;
revoke all on function private.record_roulette_spin(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.spin_roulette(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.spin_roulette_as_admin(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.spin_roulette(text, text) to authenticated, service_role;
grant execute on function public.spin_roulette_as_admin(uuid, text, text) to service_role;

comment on function public.spin_roulette(text, text) is
  'Debits one coin, records the weighted prize draw and publishes the masked overlay event.';

commit;
