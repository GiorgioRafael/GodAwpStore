-- GWStore roulette coin economy.
-- A spin no longer maps one-to-one to a Pix charge. The player buys coins
-- (1 coin = R$ 1,00), every spin debits one coin, each wheel slot is worth the
-- catalog price of its product, and an unwanted prize can be sold back for a
-- configurable share of that value to fund the next spin.
--
-- Balances are kept in coin cents so a R$ 0,03 item is worth 0,03 coin instead
-- of rounding away, matching how the rest of the store stores money.
--
-- Every RETURNS TABLE column below is named so it cannot collide with a column
-- of any table the function touches: an earlier revision shipped `prize_key` as
-- an output column and every spin failed with 42702.

begin;

set local lock_timeout = '5s';

alter table public.platform_settings
  add column if not exists roulette_sale_rate_bps integer not null default 5000;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_roulette_sale_rate_range'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_roulette_sale_rate_range
      check (roulette_sale_rate_bps between 0 and 10000);
  end if;
end
$$;

comment on column public.platform_settings.roulette_sale_rate_bps is
  'Share of a roulette prize value returned when the player sells it back, in basis points.';

alter table public.roulette_prize_products
  add column if not exists draw_weight integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'roulette_prize_products_draw_weight_positive'
      and conrelid = 'public.roulette_prize_products'::regclass
  ) then
    alter table public.roulette_prize_products
      add constraint roulette_prize_products_draw_weight_positive
      check (draw_weight > 0);
  end if;
end
$$;

comment on column public.roulette_prize_products.draw_weight is
  'Relative chance of this slot. Seeded inversely to the prize value so the expensive prizes stay rare; tune it to move the house edge.';

-- Seed the weights inversely to the prize value. The exponent keeps the spread
-- from collapsing to "only the cheapest item ever drops".
update public.roulette_prize_products as slot
set draw_weight = greatest(
  1,
  round(100000.0 / power(greatest(product.minimum_price_cents, 1)::numeric, 0.25))::integer
)
from public.products as product
where product.id = slot.product_id;

create table public.roulette_coin_balances (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  discord_user_id text not null,
  balance_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roulette_coin_balances_discord_id_format
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  constraint roulette_coin_balances_not_negative check (balance_cents >= 0)
);

create table public.roulette_coin_purchases (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  discord_user_id text not null,
  amount_cents integer not null,
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
  credited_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roulette_coin_purchases_discord_id_format
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  -- One coin costs exactly R$ 1,00, so the charge is always a whole number of
  -- coins between 1 and 100.
  constraint roulette_coin_purchases_amount_range
    check (amount_cents between 100 and 10000 and amount_cents % 100 = 0),
  constraint roulette_coin_purchases_currency_brl check (currency_code = 'BRL'),
  constraint roulette_coin_purchases_provider check (payment_provider = 'livepix'),
  constraint roulette_coin_purchases_status
    check (status in ('awaiting_payment', 'credited', 'expired')),
  constraint roulette_coin_purchases_reference_format check (
    payment_provider_reference is null
    or (
      btrim(payment_provider_reference) <> ''
      and char_length(payment_provider_reference) <= 255
    )
  ),
  constraint roulette_coin_purchases_checkout_url_https check (
    payment_checkout_url is null or payment_checkout_url ~ '^https://'
  ),
  constraint roulette_coin_purchases_reconciliation_format check (
    reconciliation_sha256 is null or reconciliation_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint roulette_coin_purchases_lifecycle check (
    (status = 'awaiting_payment' and credited_at is null)
    or (status = 'expired' and credited_at is null)
    or (status = 'credited' and credited_at is not null)
  )
);

create unique index roulette_coin_purchases_reference_unique
  on public.roulette_coin_purchases (payment_provider, payment_provider_reference)
  where payment_provider_reference is not null;

create unique index roulette_coin_purchases_provider_payment_unique
  on public.roulette_coin_purchases (payment_provider, provider_payment_id)
  where provider_payment_id is not null;

create index roulette_coin_purchases_user_status_idx
  on public.roulette_coin_purchases (auth_user_id, status, created_at desc);

create table public.roulette_coin_entries (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  amount_cents bigint not null,
  balance_after_cents bigint not null,
  purchase_id uuid references public.roulette_coin_purchases (id) on delete set null,
  spin_id uuid references public.roulette_demo_spins (id) on delete set null,
  prize_key text,
  created_at timestamptz not null default now(),
  constraint roulette_coin_entries_kind
    check (kind in ('purchase', 'spin', 'sale', 'admin_spin')),
  constraint roulette_coin_entries_amount_not_zero check (amount_cents <> 0),
  constraint roulette_coin_entries_balance_not_negative check (balance_after_cents >= 0)
);

create index roulette_coin_entries_user_created_idx
  on public.roulette_coin_entries (auth_user_id, created_at desc);

create trigger roulette_coin_balances_set_updated_at
before update on public.roulette_coin_balances
for each row execute function private.set_updated_at();

create trigger roulette_coin_purchases_set_updated_at
before update on public.roulette_coin_purchases
for each row execute function private.set_updated_at();

alter table public.roulette_coin_balances enable row level security;
alter table public.roulette_coin_balances force row level security;
alter table public.roulette_coin_purchases enable row level security;
alter table public.roulette_coin_purchases force row level security;
alter table public.roulette_coin_entries enable row level security;
alter table public.roulette_coin_entries force row level security;

revoke all on table public.roulette_coin_balances
  from public, anon, authenticated, service_role;
revoke all on table public.roulette_coin_purchases
  from public, anon, authenticated, service_role;
revoke all on table public.roulette_coin_entries
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.roulette_coin_balances to service_role;
grant select, insert, update, delete on table public.roulette_coin_purchases to service_role;
grant select, insert, update, delete on table public.roulette_coin_entries to service_role;

comment on table public.roulette_coin_balances is
  'Roulette coin balance per player, in coin cents. One coin is R$ 1,00.';
comment on table public.roulette_coin_purchases is
  'LivePix charges that credit roulette coins. One coin costs R$ 1,00.';
comment on table public.roulette_coin_entries is
  'Append-only ledger for every roulette coin movement.';

-- The spin-charge model is replaced wholesale by the coin balance.
drop function if exists public.spin_paid_roulette(text, uuid);
drop function if exists public.start_roulette_spin_charge(text);
drop function if exists public.get_roulette_spin_charge(uuid);
drop function if exists public.claim_roulette_spin_checkout(uuid, uuid);
drop function if exists public.register_roulette_spin_checkout(uuid, uuid, text, text);
drop function if exists public.release_roulette_spin_checkout_claim(uuid, uuid);
drop function if exists public.claim_roulette_spin_provider_check(uuid, integer);
drop function if exists public.confirm_roulette_spin_payment(
  text, text, text, integer, text, timestamptz, text
);
drop function if exists public.spin_roulette_as_admin(uuid, text);
drop function if exists private.record_roulette_spin(uuid, text, timestamptz);
drop table if exists public.roulette_spin_charges;

create function private.roulette_coin_balance(p_auth_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    (
      select wallet.balance_cents
      from public.roulette_coin_balances as wallet
      where wallet.auth_user_id = p_auth_user_id
    ),
    0
  );
$$;

-- Moves the balance and appends the ledger entry in one place so no caller can
-- change a balance without leaving a trace.
create function private.move_roulette_coins(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_kind text,
  p_amount_cents bigint,
  p_purchase_id uuid,
  p_spin_id uuid,
  p_prize_key text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_balance bigint;
begin
  insert into public.roulette_coin_balances (
    auth_user_id,
    discord_user_id,
    balance_cents
  )
  values (p_auth_user_id, p_discord_user_id, 0)
  on conflict (auth_user_id) do update set
    discord_user_id = excluded.discord_user_id;

  update public.roulette_coin_balances as wallet
  set balance_cents = wallet.balance_cents + p_amount_cents
  where wallet.auth_user_id = p_auth_user_id
  returning wallet.balance_cents into v_balance;

  if v_balance is null or v_balance < 0 then
    raise exception using
      errcode = 'P0007',
      message = 'Not enough roulette coins.';
  end if;

  insert into public.roulette_coin_entries (
    auth_user_id,
    kind,
    amount_cents,
    balance_after_cents,
    purchase_id,
    spin_id,
    prize_key
  )
  values (
    p_auth_user_id,
    p_kind,
    p_amount_cents,
    v_balance,
    p_purchase_id,
    p_spin_id,
    p_prize_key
  );

  return v_balance;
end;
$$;

create function private.record_roulette_spin(
  p_auth_user_id uuid,
  p_discord_user_id text,
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
  v_prize_key text;
  v_spin_id uuid;
  v_inventory_quantity integer;
begin
  -- Weighted draw over the live slots: the exponential race picks each slot
  -- with probability proportional to its draw_weight in a single pass.
  select slot.prize_key
  into v_prize_key
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null
  order by -ln(greatest(random(), 1e-12)) / slot.draw_weight
  limit 1;

  if v_prize_key is null then
    raise exception using
      errcode = 'P0009',
      message = 'The roulette has no prize configured.';
  end if;

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

  return query select v_spin_id, v_prize_key, v_inventory_quantity;
end;
$$;

-- Renaming the output columns rules out the 42702 class of bug for good, and
-- CREATE OR REPLACE cannot rename them, so the function is recreated.
drop function if exists public.get_roulette_prizes();

create function public.get_roulette_prizes()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_product_image_url text,
  slot_value_cents bigint,
  slot_sale_value_cents bigint,
  slot_draw_weight integer,
  slot_draw_chance_bps integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_sale_rate_bps integer;
  v_total_weight bigint;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select settings.roulette_sale_rate_bps
  into v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;
  v_sale_rate_bps := coalesce(v_sale_rate_bps, 5000);

  select sum(slot.draw_weight)
  into v_total_weight
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  return query
  select
    slot.prize_key,
    product.id,
    product.name,
    product.image_url,
    product.minimum_price_cents::bigint,
    (product.minimum_price_cents::bigint * v_sale_rate_bps) / 10000,
    slot.draw_weight,
    case
      when coalesce(v_total_weight, 0) > 0
        then ((slot.draw_weight::bigint * 10000) / v_total_weight)::integer
      else 0
    end
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null
  order by slot.prize_key;
end;
$$;

create function public.get_roulette_coin_balance()
returns bigint
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
  return private.roulette_coin_balance(v_auth_user_id);
end;
$$;

create function public.start_roulette_coin_purchase(
  p_discord_user_id text,
  p_coin_quantity integer
)
returns table (
  purchase_id uuid,
  purchase_status text,
  purchase_checkout_url text,
  purchase_amount_cents integer,
  purchase_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_purchase public.roulette_coin_purchases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_amount_cents integer;
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
  if p_coin_quantity is null or p_coin_quantity < 1 or p_coin_quantity > 100 then
    raise exception using
      errcode = '22023',
      message = 'Coin quantity must be between 1 and 100.';
  end if;
  v_amount_cents := p_coin_quantity * 100;

  -- Serialize per account so a double click cannot open two LivePix charges.
  perform pg_advisory_xact_lock(hashtext('roulette_coin_purchase:' || v_auth_user_id::text));

  update public.roulette_coin_purchases as purchase
  set status = 'expired'
  where purchase.auth_user_id = v_auth_user_id
    and purchase.status = 'awaiting_payment'
    and purchase.expires_at <= v_now;

  -- An open charge for the same amount is reused so a retry does not stack
  -- unpaid Pix codes on the player.
  select purchase.*
  into v_purchase
  from public.roulette_coin_purchases as purchase
  where purchase.auth_user_id = v_auth_user_id
    and purchase.status = 'awaiting_payment'
    and purchase.amount_cents = v_amount_cents
    and purchase.expires_at > v_now
  order by purchase.created_at desc
  limit 1;

  if not found then
    insert into public.roulette_coin_purchases (
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
      v_amount_cents,
      v_now + interval '30 minutes',
      v_now,
      v_now
    )
    returning * into v_purchase;
  end if;

  return query
  select
    v_purchase.id,
    v_purchase.status,
    v_purchase.payment_checkout_url,
    v_purchase.amount_cents,
    v_purchase.expires_at;
end;
$$;

create function public.get_roulette_coin_purchase(p_purchase_id uuid)
returns table (
  purchase_id uuid,
  purchase_status text,
  purchase_checkout_url text,
  purchase_amount_cents integer,
  purchase_expires_at timestamptz
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
    purchase.id,
    purchase.status,
    purchase.payment_checkout_url,
    purchase.amount_cents,
    purchase.expires_at
  from public.roulette_coin_purchases as purchase
  where purchase.id = p_purchase_id
    and purchase.auth_user_id = v_auth_user_id;
end;
$$;

create function public.claim_roulette_coin_checkout(
  p_purchase_id uuid,
  p_claim_token uuid
)
returns table (
  claim_succeeded boolean,
  claimed_purchase_id uuid,
  claimed_amount_cents integer,
  claimed_provider_reference text,
  claimed_checkout_url text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.roulette_coin_purchases%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_purchase_id is null or p_claim_token is null then
    raise exception using
      errcode = '22023',
      message = 'Roulette coin purchase or claim token is invalid.';
  end if;

  select purchase.*
  into v_purchase
  from public.roulette_coin_purchases as purchase
  where purchase.id = p_purchase_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette coin purchase was not found.';
  end if;

  if v_purchase.payment_provider_reference is not null
    and v_purchase.payment_checkout_url is not null then
    return query
    select
      false,
      v_purchase.id,
      v_purchase.amount_cents,
      v_purchase.payment_provider_reference,
      v_purchase.payment_checkout_url;
    return;
  end if;

  if v_purchase.status <> 'awaiting_payment' or v_purchase.expires_at <= v_now then
    raise exception using
      errcode = 'P0003',
      message = 'Roulette coin purchase is no longer payable.';
  end if;

  if v_purchase.checkout_claim_token is not null
    and v_purchase.checkout_claimed_at is not null
    and v_purchase.checkout_claimed_at > v_now - interval '30 seconds' then
    return query
    select false, v_purchase.id, v_purchase.amount_cents, null::text, null::text;
    return;
  end if;

  update public.roulette_coin_purchases as purchase
  set
    checkout_claim_token = p_claim_token,
    checkout_claimed_at = v_now
  where purchase.id = v_purchase.id
  returning * into v_purchase;

  return query
  select true, v_purchase.id, v_purchase.amount_cents, null::text, null::text;
end;
$$;

create function public.register_roulette_coin_checkout(
  p_purchase_id uuid,
  p_claim_token uuid,
  p_provider_reference text,
  p_checkout_url text
)
returns table (
  registered_purchase_id uuid,
  registered_provider_reference text,
  registered_checkout_url text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.roulette_coin_purchases%rowtype;
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

  select purchase.*
  into v_purchase
  from public.roulette_coin_purchases as purchase
  where purchase.id = p_purchase_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette coin purchase was not found.';
  end if;

  if v_purchase.payment_provider_reference is not null
    and v_purchase.payment_checkout_url is not null then
    return query
    select
      v_purchase.id,
      v_purchase.payment_provider_reference,
      v_purchase.payment_checkout_url;
    return;
  end if;

  if v_purchase.checkout_claim_token is null
    or v_purchase.checkout_claim_token <> p_claim_token then
    raise exception using
      errcode = 'P0004',
      message = 'Roulette coin checkout claim does not match.';
  end if;

  update public.roulette_coin_purchases as purchase
  set
    payment_provider_reference = btrim(p_provider_reference),
    payment_checkout_url = p_checkout_url
  where purchase.id = v_purchase.id
  returning * into v_purchase;

  return query
  select
    v_purchase.id,
    v_purchase.payment_provider_reference,
    v_purchase.payment_checkout_url;
end;
$$;

create function public.release_roulette_coin_checkout_claim(
  p_purchase_id uuid,
  p_claim_token uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  update public.roulette_coin_purchases as purchase
  set
    checkout_claim_token = null,
    checkout_claimed_at = null
  where purchase.id = p_purchase_id
    and purchase.checkout_claim_token = p_claim_token
    and purchase.payment_provider_reference is null;
end;
$$;

create function public.claim_roulette_coin_provider_check(
  p_purchase_id uuid,
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
begin
  update public.roulette_coin_purchases as purchase
  set provider_checked_at = clock_timestamp()
  where purchase.id = p_purchase_id
    and purchase.payment_provider_reference is not null
    and purchase.status in ('awaiting_payment', 'expired')
    and (
      purchase.provider_checked_at is null
      or purchase.provider_checked_at <= clock_timestamp() - v_interval
    );

  return found;
end;
$$;

create function public.confirm_roulette_coin_purchase(
  p_provider_payment_id text,
  p_provider_proof_id text,
  p_provider_reference text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_created_at timestamptz,
  p_reconciliation_sha256 text
)
returns table (
  confirmed_purchase_id uuid,
  confirmed_status text,
  credited_amount_cents integer,
  coin_balance_cents bigint,
  first_confirmation boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_purchase public.roulette_coin_purchases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_balance bigint;
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

  select purchase.*
  into v_purchase
  from public.roulette_coin_purchases as purchase
  where purchase.payment_provider = 'livepix'
    and purchase.payment_provider_reference = btrim(p_provider_reference)
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No registered LivePix checkout matches this roulette coin reference.';
  end if;

  if v_purchase.provider_payment_id is not null
    and v_purchase.provider_payment_id <> btrim(p_provider_payment_id) then
    raise exception using
      errcode = '22000',
      message = 'LivePix payment ID does not match the roulette coin purchase.';
  end if;

  if v_purchase.amount_cents <> p_amount_cents
    or v_purchase.currency_code <> p_currency_code then
    raise exception using
      errcode = '22000',
      message = 'LivePix amount or currency does not match the roulette coin purchase.';
  end if;

  -- A redelivered webhook must never credit the coins twice.
  if v_purchase.credited_at is not null then
    return query
    select
      v_purchase.id,
      v_purchase.status,
      v_purchase.amount_cents,
      private.roulette_coin_balance(v_purchase.auth_user_id),
      false;
    return;
  end if;

  update public.roulette_coin_purchases as purchase
  set
    status = 'credited',
    provider_payment_id = btrim(p_provider_payment_id),
    provider_proof_id = btrim(p_provider_proof_id),
    provider_created_at = p_provider_created_at,
    reconciliation_sha256 = lower(p_reconciliation_sha256),
    credited_at = coalesce(p_provider_created_at, v_now)
  where purchase.id = v_purchase.id
  returning * into v_purchase;

  v_balance := private.move_roulette_coins(
    v_purchase.auth_user_id,
    v_purchase.discord_user_id,
    'purchase',
    v_purchase.amount_cents::bigint,
    v_purchase.id,
    null,
    null
  );

  return query
  select v_purchase.id, v_purchase.status, v_purchase.amount_cents, v_balance, true;
end;
$$;

create function public.spin_roulette(p_discord_user_id text)
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
  from private.record_roulette_spin(v_auth_user_id, p_discord_user_id, v_spun_at);

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

-- Internal testing path. The web app resolves the administrator list from
-- ADMIN_DISCORD_IDS and calls this with the service-role client, so an
-- authenticated browser session can never reach it. It spends no coins.
create function public.spin_roulette_as_admin(
  p_auth_user_id uuid,
  p_discord_user_id text
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
  from private.record_roulette_spin(p_auth_user_id, p_discord_user_id, v_spun_at);

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.inventory_quantity,
    private.roulette_coin_balance(p_auth_user_id),
    v_spun_at;
end;
$$;

create function public.sell_roulette_prize(p_prize_key text)
returns table (
  sold_prize_key text,
  remaining_quantity integer,
  credited_amount_cents bigint,
  coin_balance_cents bigint
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_item public.roulette_demo_inventory%rowtype;
  v_value_cents bigint;
  v_sale_rate_bps integer;
  v_credit_cents bigint;
  v_remaining integer;
  v_balance bigint;
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('roulette_sale:' || v_auth_user_id::text));

  select item.*
  into v_item
  from public.roulette_demo_inventory as item
  where item.auth_user_id = v_auth_user_id
    and item.prize_key = p_prize_key
  for update;

  if not found then
    raise exception using
      errcode = 'P0008',
      message = 'The prize is not in the inventory.';
  end if;

  select product.minimum_price_cents::bigint
  into v_value_cents
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where slot.prize_key = v_item.prize_key
    and product.archived_at is null;

  if v_value_cents is null then
    raise exception using
      errcode = 'P0010',
      message = 'The prize no longer has a catalog price.';
  end if;

  select settings.roulette_sale_rate_bps
  into v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;
  v_sale_rate_bps := coalesce(v_sale_rate_bps, 5000);

  v_credit_cents := (v_value_cents * v_sale_rate_bps) / 10000;
  if v_credit_cents <= 0 then
    raise exception using
      errcode = 'P0011',
      message = 'The prize is worth no coins.';
  end if;

  v_remaining := v_item.quantity - 1;
  if v_remaining > 0 then
    update public.roulette_demo_inventory as item
    set quantity = v_remaining
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_item.prize_key;
  else
    delete from public.roulette_demo_inventory as item
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_item.prize_key;
  end if;

  v_balance := private.move_roulette_coins(
    v_auth_user_id,
    v_item.discord_user_id,
    'sale',
    v_credit_cents,
    null,
    null,
    v_item.prize_key
  );

  return query select v_item.prize_key, v_remaining, v_credit_cents, v_balance;
end;
$$;

revoke all on function private.roulette_coin_balance(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.move_roulette_coins(uuid, text, text, bigint, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.record_roulette_spin(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.get_roulette_prizes()
  from public, anon, authenticated, service_role;
revoke all on function public.get_roulette_coin_balance()
  from public, anon, authenticated, service_role;
revoke all on function public.start_roulette_coin_purchase(text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_roulette_coin_purchase(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_roulette_coin_checkout(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.register_roulette_coin_checkout(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.release_roulette_coin_checkout_claim(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_roulette_coin_provider_check(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_roulette_coin_purchase(
  text, text, text, integer, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.spin_roulette(text)
  from public, anon, authenticated, service_role;
revoke all on function public.spin_roulette_as_admin(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sell_roulette_prize(text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_roulette_prizes() to authenticated, service_role;
grant execute on function public.get_roulette_coin_balance() to authenticated, service_role;
grant execute on function public.start_roulette_coin_purchase(text, integer)
  to authenticated, service_role;
grant execute on function public.get_roulette_coin_purchase(uuid) to authenticated, service_role;
grant execute on function public.spin_roulette(text) to authenticated, service_role;
grant execute on function public.sell_roulette_prize(text) to authenticated, service_role;
grant execute on function public.claim_roulette_coin_checkout(uuid, uuid) to service_role;
grant execute on function public.register_roulette_coin_checkout(uuid, uuid, text, text)
  to service_role;
grant execute on function public.release_roulette_coin_checkout_claim(uuid, uuid) to service_role;
grant execute on function public.claim_roulette_coin_provider_check(uuid, integer) to service_role;
grant execute on function public.confirm_roulette_coin_purchase(
  text, text, text, integer, text, timestamptz, text
) to service_role;
grant execute on function public.spin_roulette_as_admin(uuid, text) to service_role;

comment on function public.start_roulette_coin_purchase(text, integer) is
  'Opens or reuses the LivePix charge that buys roulette coins at R$ 1,00 each.';
comment on function public.confirm_roulette_coin_purchase(
  text, text, text, integer, text, timestamptz, text
) is
  'Idempotently credits the coins of a reconciled LivePix payment.';
comment on function public.spin_roulette(text) is
  'Debits one coin and records the weighted prize draw.';
comment on function public.sell_roulette_prize(text) is
  'Sells one inventory prize back for the configured share of its catalog value.';

commit;
