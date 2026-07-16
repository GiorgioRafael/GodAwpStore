-- LivePix checkout state and post-payment Discord ticket support.
-- Provider secrets and raw webhook payloads deliberately remain outside PostgreSQL.

begin;

set local lock_timeout = '5s';

do $$
begin
  create type public.payment_status as enum (
    'uninitialized',
    'pending',
    'paid',
    'expired',
    'cancelled',
    'refunded',
    'failed'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.discord_ticket_status as enum (
    'not_created',
    'creating',
    'open',
    'closed',
    'failed'
  );
exception
  when duplicate_object then null;
end
$$;

alter table public.orders
  add column if not exists payment_provider text not null default 'livepix',
  add column if not exists payment_provider_reference text,
  add column if not exists payment_provider_checkout_id text,
  add column if not exists payment_checkout_url text,
  add column if not exists payment_provider_proof_id text,
  add column if not exists payment_status public.payment_status not null default 'uninitialized',
  add column if not exists payment_expires_at timestamptz,
  add column if not exists payment_provider_created_at timestamptz,
  add column if not exists discord_ticket_channel_id text,
  add column if not exists discord_ticket_status public.discord_ticket_status not null default 'not_created',
  add column if not exists discord_ticket_claimed_at timestamptz;

-- Normalize legacy rows before validating the new state invariants.
update public.orders
set paid_at = coalesce(paid_at, updated_at, created_at)
where status in ('paid', 'processing', 'delivered', 'refunded')
  and paid_at is null;

update public.orders
set payment_status = case
  when status in ('paid', 'processing', 'delivered') then 'paid'::public.payment_status
  when status = 'refunded' then 'refunded'::public.payment_status
  when status = 'expired' then 'expired'::public.payment_status
  when status = 'cancelled' then 'cancelled'::public.payment_status
  when status = 'failed' then 'failed'::public.payment_status
  else payment_status
end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_provider_format'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_format
      check (payment_provider ~ '^[a-z0-9][a-z0-9_-]{1,31}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_provider_reference_not_blank'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_reference_not_blank
      check (
        payment_provider_reference is null
        or (
          btrim(payment_provider_reference) <> ''
          and char_length(payment_provider_reference) <= 255
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_provider_checkout_id_not_blank'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_checkout_id_not_blank
      check (
        payment_provider_checkout_id is null
        or (
          btrim(payment_provider_checkout_id) <> ''
          and char_length(payment_provider_checkout_id) <= 255
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_checkout_url_format'
  ) then
    alter table public.orders
      add constraint orders_payment_checkout_url_format
      check (
        payment_checkout_url is null
        or (
          payment_checkout_url ~ '^https://'
          and char_length(payment_checkout_url) <= 2048
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_provider_proof_id_not_blank'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_proof_id_not_blank
      check (
        payment_provider_proof_id is null
        or (
          btrim(payment_provider_proof_id) <> ''
          and char_length(payment_provider_proof_id) <= 255
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_reference_not_blank'
  ) then
    alter table public.orders
      add constraint orders_payment_reference_not_blank
      check (
        payment_reference is null
        or (btrim(payment_reference) <> '' and char_length(payment_reference) <= 255)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_expiry_after_creation'
  ) then
    alter table public.orders
      add constraint orders_payment_expiry_after_creation
      check (payment_expires_at is null or payment_expires_at > created_at);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_paid_timestamp_state'
  ) then
    alter table public.orders
      add constraint orders_paid_timestamp_state
      check (
        status not in ('paid', 'processing', 'delivered', 'refunded')
        or paid_at is not null
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_status_timestamp_state'
  ) then
    alter table public.orders
      add constraint orders_payment_status_timestamp_state
      check (payment_status not in ('paid', 'refunded') or paid_at is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_discord_ticket_channel_id_format'
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_channel_id_format
      check (
        discord_ticket_channel_id is null
        or discord_ticket_channel_id ~ '^[0-9]{15,22}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_discord_ticket_state'
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_state
      check (
        (
          discord_ticket_status = 'not_created'
          and discord_ticket_channel_id is null
          and discord_ticket_claimed_at is null
        )
        or (
          discord_ticket_status = 'creating'
          and discord_ticket_channel_id is null
          and discord_ticket_claimed_at is not null
        )
        or (
          discord_ticket_status in ('open', 'closed')
          and discord_ticket_channel_id is not null
          and discord_ticket_claimed_at is not null
        )
        or (
          discord_ticket_status = 'failed'
          and discord_ticket_channel_id is null
          and discord_ticket_claimed_at is null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_ticket_requires_payment'
  ) then
    alter table public.orders
      add constraint orders_ticket_requires_payment
      check (discord_ticket_status = 'not_created' or paid_at is not null);
  end if;
end
$$;

create or replace function public.claim_discord_ticket(p_order_id uuid)
returns table (
  claimed_order_id uuid,
  claimed boolean,
  discord_guild_id text,
  buyer_discord_id text,
  product_name text,
  paid_amount_cents bigint,
  ticket_status public.discord_ticket_status,
  existing_channel_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_product_name text;
  v_claimed boolean := false;
begin
  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  select guild.discord_guild_id
  into strict v_discord_guild_id
  from public.guilds as guild
  where guild.id = v_order.guild_id;

  select product.name
  into strict v_product_name
  from public.products as product
  where product.id = v_order.product_id;

  if v_order.discord_ticket_status in ('open', 'closed') then
    return query
    select
      v_order.id,
      false,
      v_discord_guild_id,
      v_order.buyer_discord_id,
      v_product_name,
      v_order.sale_price_cents,
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id;
    return;
  end if;

  if v_order.status not in ('paid', 'processing', 'delivered')
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null then
    raise exception using errcode = '22000', message = 'Order is not eligible for a Discord ticket.';
  end if;

  if v_order.discord_ticket_status = 'creating'
    and v_order.discord_ticket_claimed_at > now() - interval '5 minutes' then
    return query
    select
      v_order.id,
      false,
      v_discord_guild_id,
      v_order.buyer_discord_id,
      v_product_name,
      v_order.sale_price_cents,
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id;
    return;
  end if;

  update public.orders
  set
    discord_ticket_status = 'creating',
    discord_ticket_channel_id = null,
    discord_ticket_claimed_at = now()
  where id = v_order.id
  returning * into v_order;

  v_claimed := true;

  return query
  select
    v_order.id,
    v_claimed,
    v_discord_guild_id,
    v_order.buyer_discord_id,
    v_product_name,
    v_order.sale_price_cents,
    v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id;
end
$$;

create or replace function public.complete_discord_ticket(
  p_order_id uuid,
  p_channel_id text
)
returns table (
  completed_order_id uuid,
  channel_id text,
  was_completed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_channel_id is null or p_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord ticket channel ID is invalid.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  if v_order.discord_ticket_status = 'open'
    and v_order.discord_ticket_channel_id = p_channel_id then
    return query select v_order.id, v_order.discord_ticket_channel_id, false;
    return;
  end if;

  if v_order.discord_ticket_status <> 'creating'
    or v_order.discord_ticket_claimed_at is null then
    raise exception using errcode = '22000', message = 'Discord ticket is not currently claimed.';
  end if;

  update public.orders
  set
    discord_ticket_status = 'open',
    discord_ticket_channel_id = p_channel_id
  where id = v_order.id
  returning * into v_order;

  return query select v_order.id, v_order.discord_ticket_channel_id, true;
end
$$;

create or replace function public.fail_discord_ticket(p_order_id uuid)
returns table (
  failed_order_id uuid,
  was_failed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  if v_order.discord_ticket_status = 'failed' then
    return query select v_order.id, false;
    return;
  end if;

  if v_order.discord_ticket_status <> 'creating' then
    raise exception using errcode = '22000', message = 'Discord ticket is not currently claimed.';
  end if;

  update public.orders
  set
    discord_ticket_status = 'failed',
    discord_ticket_channel_id = null,
    discord_ticket_claimed_at = null
  where id = v_order.id
  returning * into v_order;

  return query select v_order.id, true;
end
$$;

-- payment_reference remains the bot's internal idempotency key. LivePix's
-- returned reference is stored separately and is unique per provider.
create unique index if not exists orders_payment_provider_reference_unique
  on public.orders (payment_provider, payment_provider_reference)
  where payment_provider_reference is not null;

create unique index if not exists orders_payment_provider_checkout_unique
  on public.orders (payment_provider, payment_provider_checkout_id)
  where payment_provider_checkout_id is not null;

create unique index if not exists orders_payment_provider_proof_unique
  on public.orders (payment_provider, payment_provider_proof_id)
  where payment_provider_proof_id is not null;

create unique index if not exists orders_discord_ticket_channel_unique
  on public.orders (discord_ticket_channel_id)
  where discord_ticket_channel_id is not null;

create index if not exists orders_payment_status_created_idx
  on public.orders (payment_provider, payment_status, created_at desc);

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null,
  provider_checkout_id text not null,
  provider_reference text not null,
  provider_proof_id text not null,
  amount_cents bigint not null,
  currency_code text not null,
  provider_created_at timestamptz not null,
  reconciliation_sha256 text not null,
  order_id uuid references public.orders (id) on delete restrict,
  state_changed boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_webhook_events_provider_format check (
    provider ~ '^[a-z0-9][a-z0-9_-]{1,31}$'
  ),
  constraint payment_webhook_events_event_type_not_blank check (
    btrim(event_type) <> '' and char_length(event_type) <= 100
  ),
  constraint payment_webhook_events_checkout_id_not_blank check (
    btrim(provider_checkout_id) <> '' and char_length(provider_checkout_id) <= 255
  ),
  constraint payment_webhook_events_reference_not_blank check (
    btrim(provider_reference) <> '' and char_length(provider_reference) <= 255
  ),
  constraint payment_webhook_events_proof_id_not_blank check (
    btrim(provider_proof_id) <> '' and char_length(provider_proof_id) <= 255
  ),
  constraint payment_webhook_events_amount_positive check (amount_cents > 0),
  constraint payment_webhook_events_currency_brl check (currency_code = 'BRL'),
  constraint payment_webhook_events_reconciliation_sha256_format check (
    reconciliation_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint payment_webhook_events_processing_state check (
    (processed_at is null and order_id is null and not state_changed)
    or (processed_at is not null and order_id is not null)
  )
);

comment on table public.payment_webhook_events is
  'Idempotency ledger for reconciled payment webhooks. Stores identifiers and hashes only, never raw payloads or provider secrets.';

create unique index if not exists payment_webhook_events_checkout_event_unique
  on public.payment_webhook_events (provider, provider_checkout_id, event_type);

create index if not exists payment_webhook_events_order_received_idx
  on public.payment_webhook_events (order_id, received_at desc)
  where order_id is not null;

create index if not exists payment_webhook_events_reference_received_idx
  on public.payment_webhook_events (provider, provider_reference, received_at desc);

alter table public.payment_webhook_events enable row level security;
alter table public.payment_webhook_events force row level security;

drop policy if exists payment_webhook_events_admin_select on public.payment_webhook_events;
create policy payment_webhook_events_admin_select
on public.payment_webhook_events
for select
to authenticated
using (private.is_admin());

create or replace function public.register_livepix_checkout(
  p_order_id uuid,
  p_provider_reference text,
  p_checkout_url text,
  p_expires_at timestamptz default null
)
returns table (
  registered_order_id uuid,
  provider_reference text,
  checkout_url text,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_provider_reference is null
    or btrim(p_provider_reference) = ''
    or char_length(p_provider_reference) > 255 then
    raise exception using errcode = '22023', message = 'LivePix reference is invalid.';
  end if;

  if p_checkout_url is null
    or p_checkout_url !~ '^https://'
    or char_length(p_checkout_url) > 2048 then
    raise exception using errcode = '22023', message = 'LivePix checkout URL is invalid.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  if v_order.payment_provider <> 'livepix' or v_order.payment_reference is null then
    raise exception using errcode = '22000', message = 'Order is not ready for LivePix checkout.';
  end if;

  if v_order.payment_provider_reference is not null then
    if v_order.payment_provider_reference <> btrim(p_provider_reference)
      or v_order.payment_checkout_url <> p_checkout_url
      or (
        p_expires_at is not null
        and v_order.payment_expires_at is distinct from p_expires_at
      ) then
      raise exception using
        errcode = '22000',
        message = 'Order already has different LivePix checkout data.';
    end if;

    return query
    select v_order.id, v_order.payment_provider_reference, v_order.payment_checkout_url, false;
    return;
  end if;

  if v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending') then
    raise exception using errcode = '22000', message = 'Order cannot receive a checkout in its current state.';
  end if;

  update public.orders
  set
    payment_provider_reference = btrim(p_provider_reference),
    payment_checkout_url = p_checkout_url,
    payment_expires_at = p_expires_at,
    payment_status = 'pending',
    status = 'awaiting_payment'
  where id = v_order.id
  returning * into v_order;

  return query
  select v_order.id, v_order.payment_provider_reference, v_order.payment_checkout_url, true;
end
$$;

create or replace function public.confirm_livepix_payment(
  p_provider_checkout_id text,
  p_provider_proof_id text,
  p_provider_reference text,
  p_amount_cents bigint,
  p_currency_code text,
  p_provider_created_at timestamptz,
  p_reconciliation_sha256 text
)
returns table (
  processed_order_id uuid,
  discord_guild_id text,
  buyer_discord_id text,
  product_name text,
  paid_amount_cents bigint,
  resulting_order_status public.order_status,
  first_confirmation boolean,
  existing_ticket_channel_id text,
  ticket_status public.discord_ticket_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_product_name text;
  v_inserted boolean := false;
  v_state_changed boolean := false;
begin
  if p_provider_checkout_id is null
    or btrim(p_provider_checkout_id) = ''
    or char_length(p_provider_checkout_id) > 255 then
    raise exception using errcode = '22023', message = 'LivePix checkout ID is invalid.';
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
    raise exception using errcode = '22023', message = 'LivePix reconciliation SHA-256 is invalid.';
  end if;

  insert into public.payment_webhook_events (
    provider,
    event_type,
    provider_checkout_id,
    provider_reference,
    provider_proof_id,
    amount_cents,
    currency_code,
    provider_created_at,
    reconciliation_sha256
  )
  values (
    'livepix',
    'payment.confirmed',
    btrim(p_provider_checkout_id),
    btrim(p_provider_reference),
    btrim(p_provider_proof_id),
    p_amount_cents,
    p_currency_code,
    p_provider_created_at,
    lower(p_reconciliation_sha256)
  )
  on conflict (provider, provider_checkout_id, event_type) do nothing
  returning * into v_event;

  v_inserted := found;

  if not v_inserted then
    select event.*
    into strict v_event
    from public.payment_webhook_events as event
    where event.provider = 'livepix'
      and event.provider_checkout_id = btrim(p_provider_checkout_id)
      and event.event_type = 'payment.confirmed'
    for update;

    if v_event.provider_reference <> btrim(p_provider_reference)
      or v_event.provider_proof_id <> btrim(p_provider_proof_id)
      or v_event.amount_cents <> p_amount_cents
      or v_event.currency_code <> p_currency_code
      or v_event.provider_created_at <> p_provider_created_at then
      raise exception using
        errcode = '22000',
        message = 'LivePix checkout ID was reconciled with different data.';
    end if;

    if v_event.processed_at is not null then
      select order_row.*
      into strict v_order
      from public.orders as order_row
      where order_row.id = v_event.order_id;

      select guild.discord_guild_id
      into strict v_discord_guild_id
      from public.guilds as guild
      where guild.id = v_order.guild_id;

      select product.name
      into strict v_product_name
      from public.products as product
      where product.id = v_order.product_id;

      return query
      select
        v_order.id,
        v_discord_guild_id,
        v_order.buyer_discord_id,
        v_product_name,
        v_order.sale_price_cents,
        v_order.status,
        false,
        v_order.discord_ticket_channel_id,
        v_order.discord_ticket_status;
      return;
    end if;
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.payment_provider = 'livepix'
    and order_row.payment_provider_reference = btrim(p_provider_reference)
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No registered LivePix checkout matches this reference.';
  end if;

  select guild.discord_guild_id
  into strict v_discord_guild_id
  from public.guilds as guild
  where guild.id = v_order.guild_id;

  select product.name
  into strict v_product_name
  from public.products as product
  where product.id = v_order.product_id;

  if v_order.payment_provider_checkout_id is not null
    and v_order.payment_provider_checkout_id <> btrim(p_provider_checkout_id) then
    raise exception using errcode = '22000', message = 'LivePix checkout ID does not match the order.';
  end if;

  if v_order.payment_provider_proof_id is not null
    and v_order.payment_provider_proof_id <> btrim(p_provider_proof_id) then
    raise exception using errcode = '22000', message = 'LivePix proof ID does not match the order.';
  end if;

  if v_order.sale_price_cents <> p_amount_cents or v_order.currency_code <> p_currency_code then
    raise exception using errcode = '22000', message = 'LivePix amount or currency does not match the order.';
  end if;

  v_state_changed :=
    v_order.status <> 'refunded'
    and v_order.payment_status <> 'refunded'
    and (
      v_order.status not in ('paid', 'processing', 'delivered')
      or v_order.payment_status <> 'paid'
      or v_order.paid_at is null
    );

  update public.orders
  set
    payment_provider_checkout_id = coalesce(
      payment_provider_checkout_id,
      btrim(p_provider_checkout_id)
    ),
    payment_provider_proof_id = coalesce(
      payment_provider_proof_id,
      btrim(p_provider_proof_id)
    ),
    payment_provider_created_at = coalesce(
      payment_provider_created_at,
      p_provider_created_at
    ),
    payment_status = case
      when payment_status = 'refunded' then payment_status
      else 'paid'::public.payment_status
    end,
    status = case
      when status in ('processing', 'delivered', 'refunded') then status
      else 'paid'::public.order_status
    end,
    paid_at = coalesce(paid_at, now())
  where id = v_order.id
    and (
      payment_provider_checkout_id is null
      or payment_provider_proof_id is null
      or payment_provider_created_at is null
      or v_state_changed
    );

  select order_row.*
  into strict v_order
  from public.orders as order_row
  where order_row.payment_provider = 'livepix'
    and order_row.payment_provider_reference = btrim(p_provider_reference);

  update public.payment_webhook_events
  set
    order_id = v_order.id,
    state_changed = v_state_changed,
    processed_at = now()
  where id = v_event.id;

  return query
  select
    v_order.id,
    v_discord_guild_id,
    v_order.buyer_discord_id,
    v_product_name,
    v_order.sale_price_cents,
    v_order.status,
    true,
    v_order.discord_ticket_channel_id,
    v_order.discord_ticket_status;
end
$$;

comment on function public.register_livepix_checkout(uuid, text, text, timestamptz) is
  'Idempotently attaches the LivePix reference and checkout URL returned during checkout creation to an order.';

comment on function public.confirm_livepix_payment(text, text, text, bigint, text, timestamptz, text) is
  'Atomically deduplicates a reconciled LivePix confirmation, validates id/proof/reference/amount/currency/createdAt, and marks the order paid once.';

comment on function public.claim_discord_ticket(uuid) is
  'Claims paid-order Discord ticket creation with a five-minute lease; stale creating claims can be reclaimed.';

comment on function public.complete_discord_ticket(uuid, text) is
  'Atomically records the unique Discord channel for a claimed paid-order ticket.';

comment on function public.fail_discord_ticket(uuid) is
  'Releases a failed Discord ticket claim so the paid order can be retried.';

revoke all on table public.payment_webhook_events from public, anon, authenticated, service_role;
grant select on table public.payment_webhook_events to authenticated, service_role;

revoke all on function public.register_livepix_checkout(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_livepix_checkout(uuid, text, text, timestamptz)
  to service_role;

revoke all on function public.confirm_livepix_payment(text, text, text, bigint, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.confirm_livepix_payment(text, text, text, bigint, text, timestamptz, text)
  to service_role;

revoke all on function public.claim_discord_ticket(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_discord_ticket(uuid)
  to service_role;

revoke all on function public.complete_discord_ticket(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_discord_ticket(uuid, text)
  to service_role;

revoke all on function public.fail_discord_ticket(uuid)
  from public, anon, authenticated;
grant execute on function public.fail_discord_ticket(uuid)
  to service_role;

commit;
