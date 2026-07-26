-- Paid GWStore roulette spins.
-- Every spin now consumes a R$ 1,00 LivePix charge exactly once. The free
-- `spin_demo_roulette` entry point is removed so an authenticated browser can
-- no longer spin without paying. Administrators keep a free path for internal
-- testing through `spin_roulette_as_admin`, which only the service-role client
-- may execute after the web app validates the admin session.
-- The five wheel slots temporarily point at random catalog products so the
-- prototype can be tested with real item names before the definitive prizes.

begin;

set local lock_timeout = '5s';

create table public.roulette_prize_products (
  prize_key text primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roulette_prize_products_prize_key
    check (prize_key in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5'))
);

create unique index roulette_prize_products_product_unique
  on public.roulette_prize_products (product_id);

create trigger roulette_prize_products_set_updated_at
before update on public.roulette_prize_products
for each row execute function private.set_updated_at();

alter table public.roulette_prize_products enable row level security;
alter table public.roulette_prize_products force row level security;

revoke all on table public.roulette_prize_products
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.roulette_prize_products to service_role;

-- Temporary testing setup: fill the five slots with random active products.
insert into public.roulette_prize_products (prize_key, product_id)
select
  'premio_' || slot.slot_index::text,
  slot.id
from (
  select
    product.id,
    row_number() over (order by random()) as slot_index
  from public.products as product
  where product.status = 'active'
    and product.archived_at is null
) as slot
where slot.slot_index <= 5
on conflict (prize_key) do nothing;

create table public.roulette_spin_charges (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  discord_user_id text not null,
  amount_cents integer not null default 100,
  currency_code text not null default 'BRL',
  status text not null default 'awaiting_payment',
  payment_provider text not null default 'livepix',
  payment_provider_reference text,
  payment_checkout_url text,
  checkout_claim_token uuid,
  checkout_claimed_at timestamptz,
  provider_payment_id text,
  provider_proof_id text,
  provider_created_at timestamptz,
  reconciliation_sha256 text,
  provider_checked_at timestamptz,
  paid_amount_cents integer,
  paid_at timestamptz,
  consumed_at timestamptz,
  spin_id uuid references public.roulette_demo_spins (id) on delete set null,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roulette_spin_charges_discord_id_format
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  constraint roulette_spin_charges_amount_range
    check (amount_cents >= 100 and amount_cents <= 100000),
  constraint roulette_spin_charges_currency_brl check (currency_code = 'BRL'),
  constraint roulette_spin_charges_provider check (payment_provider = 'livepix'),
  constraint roulette_spin_charges_status
    check (status in ('awaiting_payment', 'paid', 'consumed', 'expired')),
  constraint roulette_spin_charges_reference_format check (
    payment_provider_reference is null
    or (
      btrim(payment_provider_reference) <> ''
      and char_length(payment_provider_reference) <= 255
    )
  ),
  constraint roulette_spin_charges_checkout_url_https check (
    payment_checkout_url is null or payment_checkout_url ~ '^https://'
  ),
  constraint roulette_spin_charges_reconciliation_format check (
    reconciliation_sha256 is null or reconciliation_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint roulette_spin_charges_lifecycle check (
    (status = 'awaiting_payment' and paid_at is null and consumed_at is null and spin_id is null)
    or (status = 'expired' and paid_at is null and consumed_at is null and spin_id is null)
    or (status = 'paid' and paid_at is not null and consumed_at is null and spin_id is null)
    or (status = 'consumed' and paid_at is not null and consumed_at is not null)
  )
);

create unique index roulette_spin_charges_reference_unique
  on public.roulette_spin_charges (payment_provider, payment_provider_reference)
  where payment_provider_reference is not null;

create unique index roulette_spin_charges_provider_payment_unique
  on public.roulette_spin_charges (payment_provider, provider_payment_id)
  where provider_payment_id is not null;

create index roulette_spin_charges_user_status_idx
  on public.roulette_spin_charges (auth_user_id, status, created_at desc);

create trigger roulette_spin_charges_set_updated_at
before update on public.roulette_spin_charges
for each row execute function private.set_updated_at();

alter table public.roulette_spin_charges enable row level security;
alter table public.roulette_spin_charges force row level security;

revoke all on table public.roulette_spin_charges
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.roulette_spin_charges to service_role;

comment on table public.roulette_prize_products is
  'Temporary mapping between the five roulette slots and real catalog products.';
comment on table public.roulette_spin_charges is
  'R$ 1,00 LivePix charges that authorize exactly one GWStore roulette spin.';

create function public.get_roulette_prizes()
returns table (
  prize_key text,
  product_id uuid,
  product_name text,
  product_image_url text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  return query
  select
    slot.prize_key,
    product.id,
    product.name,
    product.image_url
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null
  order by slot.prize_key;
end;
$$;

-- Shared spin primitive. Both the paid and the administrator paths funnel
-- through here so a single implementation owns prize selection and inventory.
create function private.record_roulette_spin(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_spun_at timestamptz
)
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

create function public.start_roulette_spin_charge(p_discord_user_id text)
returns table (
  charge_id uuid,
  charge_status text,
  checkout_url text,
  amount_cents integer,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_charge public.roulette_spin_charges%rowtype;
  v_now timestamptz := clock_timestamp();
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

  -- Serialize per account so a double click cannot open two LivePix charges.
  perform pg_advisory_xact_lock(hashtext('roulette_spin_charge:' || v_auth_user_id::text));

  update public.roulette_spin_charges as charge
  set status = 'expired'
  where charge.auth_user_id = v_auth_user_id
    and charge.status = 'awaiting_payment'
    and charge.expires_at <= v_now;

  -- A charge that was already paid but never spun is reused instead of
  -- charging the same person twice.
  select charge.*
  into v_charge
  from public.roulette_spin_charges as charge
  where charge.auth_user_id = v_auth_user_id
    and charge.status = 'paid'
  order by charge.paid_at
  limit 1;

  if not found then
    select charge.*
    into v_charge
    from public.roulette_spin_charges as charge
    where charge.auth_user_id = v_auth_user_id
      and charge.status = 'awaiting_payment'
      and charge.expires_at > v_now
    order by charge.created_at desc
    limit 1;
  end if;

  if not found then
    insert into public.roulette_spin_charges (
      auth_user_id,
      discord_user_id,
      amount_cents,
      expires_at,
      created_at,
      updated_at
    )
    values (
      v_auth_user_id,
      p_discord_user_id,
      100,
      v_now + interval '30 minutes',
      v_now,
      v_now
    )
    returning * into v_charge;
  end if;

  return query
  select
    v_charge.id,
    v_charge.status,
    v_charge.payment_checkout_url,
    v_charge.amount_cents,
    v_charge.expires_at;
end;
$$;

create function public.get_roulette_spin_charge(p_charge_id uuid)
returns table (
  charge_id uuid,
  charge_status text,
  checkout_url text,
  amount_cents integer,
  expires_at timestamptz
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
    charge.id,
    charge.status,
    charge.payment_checkout_url,
    charge.amount_cents,
    charge.expires_at
  from public.roulette_spin_charges as charge
  where charge.id = p_charge_id
    and charge.auth_user_id = v_auth_user_id;
end;
$$;

create function public.claim_roulette_spin_checkout(
  p_charge_id uuid,
  p_claim_token uuid
)
returns table (
  claimed boolean,
  claimed_charge_id uuid,
  amount_cents integer,
  provider_reference text,
  checkout_url text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_charge public.roulette_spin_charges%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_charge_id is null or p_claim_token is null then
    raise exception using
      errcode = '22023',
      message = 'Roulette spin charge or claim token is invalid.';
  end if;

  select charge.*
  into v_charge
  from public.roulette_spin_charges as charge
  where charge.id = p_charge_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette spin charge was not found.';
  end if;

  if v_charge.payment_provider_reference is not null
    and v_charge.payment_checkout_url is not null then
    return query
    select
      false,
      v_charge.id,
      v_charge.amount_cents,
      v_charge.payment_provider_reference,
      v_charge.payment_checkout_url;
    return;
  end if;

  if v_charge.status <> 'awaiting_payment' or v_charge.expires_at <= v_now then
    raise exception using
      errcode = 'P0003',
      message = 'Roulette spin charge is no longer payable.';
  end if;

  if v_charge.checkout_claim_token is not null
    and v_charge.checkout_claimed_at is not null
    and v_charge.checkout_claimed_at > v_now - interval '30 seconds' then
    return query select false, v_charge.id, v_charge.amount_cents, null::text, null::text;
    return;
  end if;

  update public.roulette_spin_charges
  set
    checkout_claim_token = p_claim_token,
    checkout_claimed_at = v_now
  where id = v_charge.id
  returning * into v_charge;

  return query select true, v_charge.id, v_charge.amount_cents, null::text, null::text;
end;
$$;

create function public.register_roulette_spin_checkout(
  p_charge_id uuid,
  p_claim_token uuid,
  p_provider_reference text,
  p_checkout_url text
)
returns table (
  registered_charge_id uuid,
  provider_reference text,
  checkout_url text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_charge public.roulette_spin_charges%rowtype;
begin
  if p_provider_reference is null
    or btrim(p_provider_reference) = ''
    or char_length(p_provider_reference) > 255 then
    raise exception using
      errcode = '22023',
      message = 'LivePix reference is invalid.';
  end if;
  if p_checkout_url is null or p_checkout_url !~ '^https://' then
    raise exception using
      errcode = '22023',
      message = 'LivePix checkout URL is invalid.';
  end if;

  select charge.*
  into v_charge
  from public.roulette_spin_charges as charge
  where charge.id = p_charge_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette spin charge was not found.';
  end if;

  if v_charge.payment_provider_reference is not null
    and v_charge.payment_checkout_url is not null then
    return query
    select v_charge.id, v_charge.payment_provider_reference, v_charge.payment_checkout_url;
    return;
  end if;

  if v_charge.checkout_claim_token is null or v_charge.checkout_claim_token <> p_claim_token then
    raise exception using
      errcode = 'P0004',
      message = 'Roulette spin checkout claim does not match.';
  end if;

  update public.roulette_spin_charges
  set
    payment_provider_reference = btrim(p_provider_reference),
    payment_checkout_url = p_checkout_url
  where id = v_charge.id
  returning * into v_charge;

  return query
  select v_charge.id, v_charge.payment_provider_reference, v_charge.payment_checkout_url;
end;
$$;

create function public.release_roulette_spin_checkout_claim(
  p_charge_id uuid,
  p_claim_token uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  update public.roulette_spin_charges
  set
    checkout_claim_token = null,
    checkout_claimed_at = null
  where id = p_charge_id
    and checkout_claim_token = p_claim_token
    and payment_provider_reference is null;
end;
$$;

-- Rate limiter for the polling fallback: the web app may pull LivePix directly
-- when the webhook is delayed, but never more often than the given interval.
create function public.claim_roulette_spin_provider_check(
  p_charge_id uuid,
  p_minimum_interval_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_interval interval := make_interval(
    secs => greatest(coalesce(p_minimum_interval_seconds, 5), 1)
  );
  v_claimed boolean := false;
begin
  update public.roulette_spin_charges
  set provider_checked_at = clock_timestamp()
  where id = p_charge_id
    and payment_provider_reference is not null
    and status in ('awaiting_payment', 'expired')
    and (
      provider_checked_at is null
      or provider_checked_at <= clock_timestamp() - v_interval
    );

  v_claimed := found;
  return v_claimed;
end;
$$;

create function public.confirm_roulette_spin_payment(
  p_provider_payment_id text,
  p_provider_proof_id text,
  p_provider_reference text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_created_at timestamptz,
  p_reconciliation_sha256 text
)
returns table (
  confirmed_charge_id uuid,
  charge_status text,
  paid_amount_cents integer,
  first_confirmation boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_charge public.roulette_spin_charges%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_provider_payment_id is null
    or btrim(p_provider_payment_id) = ''
    or char_length(p_provider_payment_id) > 255 then
    raise exception using errcode = '22023', message = 'LivePix payment ID is invalid.';
  end if;
  if p_provider_proof_id is null
    or btrim(p_provider_proof_id) = ''
    or char_length(p_provider_proof_id) > 255 then
    raise exception using errcode = '22023', message = 'LivePix proof ID is invalid.';
  end if;
  if p_provider_reference is null
    or btrim(p_provider_reference) = ''
    or char_length(p_provider_reference) > 255 then
    raise exception using errcode = '22023', message = 'LivePix reference is invalid.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'LivePix amount is invalid.';
  end if;
  if p_currency_code <> 'BRL' then
    raise exception using errcode = '22023', message = 'LivePix currency must be BRL.';
  end if;
  if p_provider_created_at is null then
    raise exception using errcode = '22023', message = 'LivePix createdAt is required.';
  end if;
  if p_reconciliation_sha256 is null
    or p_reconciliation_sha256 !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'LivePix reconciliation SHA-256 is invalid.';
  end if;

  select charge.*
  into v_charge
  from public.roulette_spin_charges as charge
  where charge.payment_provider = 'livepix'
    and charge.payment_provider_reference = btrim(p_provider_reference)
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No registered LivePix checkout matches this roulette reference.';
  end if;

  if v_charge.provider_payment_id is not null
    and v_charge.provider_payment_id <> btrim(p_provider_payment_id) then
    raise exception using
      errcode = '22000',
      message = 'LivePix payment ID does not match the roulette charge.';
  end if;

  if v_charge.amount_cents <> p_amount_cents or v_charge.currency_code <> p_currency_code then
    raise exception using
      errcode = '22000',
      message = 'LivePix amount or currency does not match the roulette charge.';
  end if;

  if v_charge.paid_at is not null then
    return query
    select v_charge.id, v_charge.status, v_charge.paid_amount_cents, false;
    return;
  end if;

  -- A charge that lapsed while the payer was on the LivePix page is still
  -- honoured: the money arrived, so the spin has to be granted.
  update public.roulette_spin_charges
  set
    status = 'paid',
    provider_payment_id = btrim(p_provider_payment_id),
    provider_proof_id = btrim(p_provider_proof_id),
    provider_created_at = p_provider_created_at,
    reconciliation_sha256 = lower(p_reconciliation_sha256),
    paid_amount_cents = p_amount_cents,
    paid_at = coalesce(p_provider_created_at, v_now)
  where id = v_charge.id
  returning * into v_charge;

  return query
  select v_charge.id, v_charge.status, v_charge.paid_amount_cents, true;
end;
$$;

create function public.spin_paid_roulette(
  p_discord_user_id text,
  p_charge_id uuid
)
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

  update public.roulette_spin_charges
  set
    status = 'consumed',
    consumed_at = v_spun_at,
    spin_id = v_spin.spin_id
  where id = v_charge.id;

  return query
  select v_spin.spin_id, v_spin.prize_key, v_spin.inventory_quantity, v_spin.spun_at;
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
  select v_spin.spin_id, v_spin.prize_key, v_spin.inventory_quantity, v_spin.spun_at;
end;
$$;

drop function if exists public.spin_demo_roulette(text);

revoke all on function private.record_roulette_spin(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.get_roulette_prizes()
  from public, anon, authenticated, service_role;
revoke all on function public.start_roulette_spin_charge(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_roulette_spin_charge(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_roulette_spin_checkout(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.register_roulette_spin_checkout(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.release_roulette_spin_checkout_claim(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_roulette_spin_provider_check(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_roulette_spin_payment(
  text, text, text, integer, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.spin_paid_roulette(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.spin_roulette_as_admin(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_roulette_prizes() to authenticated, service_role;
grant execute on function public.start_roulette_spin_charge(text) to authenticated, service_role;
grant execute on function public.get_roulette_spin_charge(uuid) to authenticated, service_role;
grant execute on function public.spin_paid_roulette(text, uuid) to authenticated, service_role;
grant execute on function public.claim_roulette_spin_checkout(uuid, uuid) to service_role;
grant execute on function public.register_roulette_spin_checkout(uuid, uuid, text, text)
  to service_role;
grant execute on function public.release_roulette_spin_checkout_claim(uuid, uuid) to service_role;
grant execute on function public.claim_roulette_spin_provider_check(uuid, integer) to service_role;
grant execute on function public.confirm_roulette_spin_payment(
  text, text, text, integer, text, timestamptz, text
) to service_role;
grant execute on function public.spin_roulette_as_admin(uuid, text) to service_role;

comment on function public.start_roulette_spin_charge(text) is
  'Opens or reuses the R$ 1,00 LivePix charge that authorizes one roulette spin.';
comment on function public.confirm_roulette_spin_payment(
  text, text, text, integer, text, timestamptz, text
) is
  'Idempotently marks a roulette spin charge as paid from a reconciled LivePix payment.';
comment on function public.spin_paid_roulette(text, uuid) is
  'Consumes one paid roulette charge exactly once and records the resulting prize.';
comment on function public.spin_roulette_as_admin(uuid, text) is
  'Free roulette spin for internal administrator testing; service-role only.';

commit;
