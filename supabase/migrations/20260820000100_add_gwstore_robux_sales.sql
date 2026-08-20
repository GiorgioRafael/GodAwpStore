-- GWStore Robux checkout: isolated from catalog stock and normal item orders.
-- Every public operation goes through service-role RPCs called after Discord
-- signature verification; browsers receive no table access.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '15s';

create table if not exists public.robux_orders (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds (id) on delete restrict,
  buyer_discord_id text not null,
  discord_interaction_id text not null,
  robux_quantity integer not null,
  amount_cents bigint not null,
  currency_code text not null default 'BRL',
  status text not null default 'awaiting_payment',
  payment_provider text not null default 'livepix',
  payment_provider_reference text,
  payment_provider_checkout_id text,
  payment_provider_proof_id text,
  payment_checkout_url text,
  payment_reconciliation_sha256 text,
  payment_status public.payment_status not null default 'uninitialized',
  payment_provider_created_at timestamptz,
  paid_at timestamptz,
  livepix_checkout_claim_token uuid,
  livepix_checkout_claimed_at timestamptz,
  discord_ticket_channel_id text,
  discord_ticket_status public.discord_ticket_status not null default 'not_created',
  discord_ticket_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint robux_orders_buyer_discord_id_format
    check (buyer_discord_id ~ '^[0-9]{15,22}$'),
  constraint robux_orders_interaction_id_format
    check (discord_interaction_id ~ '^[0-9]{15,22}$'),
  constraint robux_orders_quantity_range
    check (robux_quantity between 29 and 100000),
  constraint robux_orders_amount_matches_quantity
    check (amount_cents = ((robux_quantity::bigint * 3500 + 999) / 1000)),
  constraint robux_orders_amount_minimum
    check (amount_cents >= 100),
  constraint robux_orders_currency_brl check (currency_code = 'BRL'),
  constraint robux_orders_status_valid check (status in ('awaiting_payment', 'paid')),
  constraint robux_orders_payment_provider_valid check (payment_provider = 'livepix'),
  constraint robux_orders_provider_reference_valid check (
    payment_provider_reference is null
    or (btrim(payment_provider_reference) <> '' and char_length(payment_provider_reference) <= 255)
  ),
  constraint robux_orders_checkout_url_valid check (
    payment_checkout_url is null
    or (payment_checkout_url ~ '^https://' and char_length(payment_checkout_url) <= 2048)
  ),
  constraint robux_orders_claim_state check (
    (livepix_checkout_claim_token is null and livepix_checkout_claimed_at is null)
    or (livepix_checkout_claim_token is not null and livepix_checkout_claimed_at is not null)
  ),
  constraint robux_orders_ticket_channel_format check (
    discord_ticket_channel_id is null or discord_ticket_channel_id ~ '^[0-9]{15,22}$'
  ),
  constraint robux_orders_ticket_state check (
    (discord_ticket_status = 'not_created' and discord_ticket_channel_id is null and discord_ticket_claimed_at is null)
    or (discord_ticket_status = 'creating' and discord_ticket_channel_id is null and discord_ticket_claimed_at is not null)
    or (discord_ticket_status in ('open', 'closed') and discord_ticket_channel_id is not null and discord_ticket_claimed_at is not null)
    or (discord_ticket_status = 'failed' and discord_ticket_channel_id is null and discord_ticket_claimed_at is null)
  ),
  constraint robux_orders_paid_state check (
    (payment_status = 'paid' and status = 'paid' and paid_at is not null)
    or payment_status <> 'paid'
  )
);

create unique index if not exists robux_orders_discord_interaction_unique
  on public.robux_orders (discord_interaction_id);
create unique index if not exists robux_orders_provider_reference_unique
  on public.robux_orders (payment_provider_reference)
  where payment_provider_reference is not null;
create unique index if not exists robux_orders_provider_payment_unique
  on public.robux_orders (payment_provider, payment_provider_checkout_id)
  where payment_provider_checkout_id is not null;
create unique index if not exists robux_orders_ticket_channel_unique
  on public.robux_orders (discord_ticket_channel_id)
  where discord_ticket_channel_id is not null;
create index if not exists robux_orders_payment_ticket_idx
  on public.robux_orders (payment_status, discord_ticket_status, created_at desc)
  where payment_status = 'paid';
create index if not exists robux_orders_checkout_claim_idx
  on public.robux_orders (livepix_checkout_claimed_at)
  where payment_provider_reference is null and livepix_checkout_claim_token is not null;

alter table public.robux_orders enable row level security;
alter table public.robux_orders force row level security;

drop policy if exists robux_orders_admin_select on public.robux_orders;
create policy robux_orders_admin_select
on public.robux_orders
for select
to authenticated
using (private.is_admin());

revoke all on table public.robux_orders from public, anon, authenticated;
grant select on table public.robux_orders to authenticated;

create or replace function public.create_robux_livepix_order(
  p_discord_guild_id text,
  p_buyer_discord_id text,
  p_discord_interaction_id text,
  p_robux_quantity integer
)
returns table (
  order_id uuid,
  amount_cents bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_guild_id uuid;
  v_order public.robux_orders%rowtype;
  v_amount_cents bigint;
begin
  if p_discord_guild_id !~ '^[0-9]{15,22}$'
    or p_buyer_discord_id !~ '^[0-9]{15,22}$'
    or p_discord_interaction_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord identifiers are invalid.';
  end if;
  if p_robux_quantity not between 29 and 100000 then
    raise exception using errcode = '22023', message = 'Robux quantity is outside the allowed range.';
  end if;

  select guild.id
  into v_guild_id
  from public.guilds as guild
  where guild.discord_guild_id = p_discord_guild_id
    and guild.status = 'active'
    and guild.archived_at is null;
  if v_guild_id is null then
    raise exception using errcode = 'P0002', message = 'Active Discord guild was not found.';
  end if;

  v_amount_cents := ((p_robux_quantity::bigint * 3500 + 999) / 1000);

  insert into public.robux_orders (
    guild_id,
    buyer_discord_id,
    discord_interaction_id,
    robux_quantity,
    amount_cents
  )
  values (
    v_guild_id,
    p_buyer_discord_id,
    p_discord_interaction_id,
    p_robux_quantity,
    v_amount_cents
  )
  on conflict (discord_interaction_id) do nothing
  returning * into v_order;

  if not found then
    select order_row.*
    into v_order
    from public.robux_orders as order_row
    where order_row.discord_interaction_id = p_discord_interaction_id;

    if v_order.guild_id <> v_guild_id
      or v_order.buyer_discord_id <> p_buyer_discord_id
      or v_order.robux_quantity <> p_robux_quantity then
      raise exception using errcode = '22000', message = 'Discord interaction does not match its original Robux order.';
    end if;
  end if;

  return query select v_order.id, v_order.amount_cents;
end
$$;

create or replace function public.find_robux_livepix_checkout_by_order(p_order_id uuid)
returns table (provider_reference text, checkout_url text)
language sql
security definer
set search_path = pg_catalog
as $$
  select order_row.payment_provider_reference, order_row.payment_checkout_url
  from public.robux_orders as order_row
  where order_row.id = p_order_id
$$;

create or replace function public.find_robux_livepix_checkout_by_reference(p_provider_reference text)
returns table (order_id uuid)
language sql
security definer
set search_path = pg_catalog
as $$
  select order_row.id
  from public.robux_orders as order_row
  where order_row.payment_provider = 'livepix'
    and order_row.payment_provider_reference = btrim(p_provider_reference)
$$;

create or replace function public.claim_robux_livepix_checkout(
  p_order_id uuid,
  p_claim_token uuid
)
returns table (
  claimed boolean,
  provider_reference text,
  checkout_url text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'LivePix checkout claim token is required.';
  end if;
  select order_row.* into v_order
  from public.robux_orders as order_row
  where order_row.id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Robux order was not found.';
  end if;
  if v_order.payment_provider_reference is not null then
    return query select false, v_order.payment_provider_reference, v_order.payment_checkout_url;
    return;
  end if;
  if v_order.status <> 'awaiting_payment'
    or v_order.payment_status not in ('uninitialized', 'pending') then
    raise exception using errcode = '22000', message = 'Robux order is not ready for checkout.';
  end if;
  if v_order.livepix_checkout_claim_token is not null
    and v_order.livepix_checkout_claim_token <> p_claim_token
    and v_order.livepix_checkout_claimed_at > now() - interval '5 minutes' then
    return query select false, null::text, null::text;
    return;
  end if;
  update public.robux_orders
  set livepix_checkout_claim_token = p_claim_token,
      livepix_checkout_claimed_at = now(),
      updated_at = now()
  where id = v_order.id;
  return query select true, null::text, null::text;
end
$$;

create or replace function public.register_claimed_robux_livepix_checkout(
  p_order_id uuid,
  p_claim_token uuid,
  p_provider_reference text,
  p_checkout_url text
)
returns table (
  registered_order_id uuid,
  checkout_url text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
begin
  if p_claim_token is null
    or p_provider_reference is null or btrim(p_provider_reference) = '' or char_length(p_provider_reference) > 255
    or p_checkout_url is null or p_checkout_url !~ '^https://' or char_length(p_checkout_url) > 2048 then
    raise exception using errcode = '22023', message = 'LivePix checkout payload is invalid.';
  end if;
  select order_row.* into v_order
  from public.robux_orders as order_row
  where order_row.id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Robux order was not found.';
  end if;
  if v_order.payment_provider_reference is not null then
    if v_order.payment_provider_reference <> btrim(p_provider_reference)
      or v_order.payment_checkout_url <> p_checkout_url then
      raise exception using errcode = '22000', message = 'Robux order already has different checkout data.';
    end if;
    return query select v_order.id, v_order.payment_checkout_url;
    return;
  end if;
  if v_order.livepix_checkout_claim_token is distinct from p_claim_token
    or v_order.livepix_checkout_claimed_at is null then
    raise exception using errcode = '42501', message = 'LivePix checkout claim is not owned by this request.';
  end if;

  update public.robux_orders
  set payment_provider_reference = btrim(p_provider_reference),
      payment_checkout_url = p_checkout_url,
      payment_status = 'pending',
      livepix_checkout_claim_token = null,
      livepix_checkout_claimed_at = null,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;
  return query select v_order.id, v_order.payment_checkout_url;
end
$$;

create or replace function public.release_robux_livepix_checkout_claim(
  p_order_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_released_count integer;
begin
  update public.robux_orders
  set livepix_checkout_claim_token = null,
      livepix_checkout_claimed_at = null,
      updated_at = now()
  where id = p_order_id
    and payment_provider_reference is null
    and livepix_checkout_claim_token = p_claim_token;
  get diagnostics v_released_count = row_count;
  return v_released_count > 0;
end
$$;

create or replace function public.confirm_robux_livepix_payment(
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
  robux_quantity integer,
  paid_amount_cents bigint,
  ticket_status public.discord_ticket_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
  v_discord_guild_id text;
begin
  select order_row.* into v_order
  from public.robux_orders as order_row
  where order_row.payment_provider = 'livepix'
    and order_row.payment_provider_reference = btrim(p_provider_reference)
  for update;
  if not found then
    return;
  end if;
  if p_provider_checkout_id is null or btrim(p_provider_checkout_id) = ''
    or p_provider_proof_id is null or btrim(p_provider_proof_id) = ''
    or p_reconciliation_sha256 is null or char_length(p_reconciliation_sha256) <> 64
    or p_currency_code <> 'BRL'
    or p_amount_cents <> v_order.amount_cents
    or p_provider_created_at is null then
    raise exception using errcode = '22000', message = 'LivePix payment does not match the Robux order.';
  end if;

  select guild.discord_guild_id into strict v_discord_guild_id
  from public.guilds as guild where guild.id = v_order.guild_id;

  if v_order.payment_status = 'paid' then
    if v_order.payment_provider_checkout_id <> btrim(p_provider_checkout_id)
      or v_order.payment_provider_proof_id <> btrim(p_provider_proof_id)
      or v_order.payment_reconciliation_sha256 <> p_reconciliation_sha256 then
      raise exception using errcode = '22000', message = 'LivePix payment replay does not match the original payment.';
    end if;
    return query select v_order.id, v_discord_guild_id, v_order.buyer_discord_id,
      v_order.robux_quantity, v_order.amount_cents, v_order.discord_ticket_status;
    return;
  end if;
  if v_order.status <> 'awaiting_payment' or v_order.payment_status <> 'pending' then
    raise exception using errcode = '22000', message = 'Robux order is not awaiting LivePix payment.';
  end if;

  update public.robux_orders
  set status = 'paid',
      payment_status = 'paid',
      payment_provider_checkout_id = btrim(p_provider_checkout_id),
      payment_provider_proof_id = btrim(p_provider_proof_id),
      payment_reconciliation_sha256 = p_reconciliation_sha256,
      payment_provider_created_at = p_provider_created_at,
      paid_at = coalesce(paid_at, now()),
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return query select v_order.id, v_discord_guild_id, v_order.buyer_discord_id,
    v_order.robux_quantity, v_order.amount_cents, v_order.discord_ticket_status;
end
$$;

create or replace function public.claim_robux_discord_ticket(p_order_id uuid)
returns table (
  claimed_order_id uuid,
  claimed boolean,
  discord_guild_id text,
  buyer_discord_id text,
  robux_quantity integer,
  paid_amount_cents bigint,
  ticket_status public.discord_ticket_status,
  existing_channel_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
  v_discord_guild_id text;
begin
  select order_row.* into v_order from public.robux_orders as order_row
  where order_row.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Robux order was not found.'; end if;
  select guild.discord_guild_id into strict v_discord_guild_id from public.guilds as guild
  where guild.id = v_order.guild_id;
  if v_order.discord_ticket_status in ('open', 'closed') then
    return query select v_order.id, false, v_discord_guild_id, v_order.buyer_discord_id,
      v_order.robux_quantity, v_order.amount_cents, v_order.discord_ticket_status, v_order.discord_ticket_channel_id;
    return;
  end if;
  if v_order.payment_status <> 'paid' or v_order.status <> 'paid' or v_order.paid_at is null then
    raise exception using errcode = '22000', message = 'Robux order is not eligible for a Discord ticket.';
  end if;
  if v_order.discord_ticket_status = 'creating'
    and v_order.discord_ticket_claimed_at > now() - interval '5 minutes' then
    return query select v_order.id, false, v_discord_guild_id, v_order.buyer_discord_id,
      v_order.robux_quantity, v_order.amount_cents, v_order.discord_ticket_status, v_order.discord_ticket_channel_id;
    return;
  end if;
  update public.robux_orders
  set discord_ticket_status = 'creating', discord_ticket_channel_id = null,
      discord_ticket_claimed_at = now(), updated_at = now()
  where id = v_order.id returning * into v_order;
  return query select v_order.id, true, v_discord_guild_id, v_order.buyer_discord_id,
    v_order.robux_quantity, v_order.amount_cents, v_order.discord_ticket_status, v_order.discord_ticket_channel_id;
end
$$;

create or replace function public.complete_robux_discord_ticket(p_order_id uuid, p_channel_id text)
returns table (completed_order_id uuid, ticket_channel_id text, was_created boolean)
language plpgsql security definer set search_path = pg_catalog as $$
declare v_order public.robux_orders%rowtype;
begin
  if p_channel_id !~ '^[0-9]{15,22}$' then raise exception using errcode = '22023', message = 'Discord channel is invalid.'; end if;
  select order_row.* into v_order from public.robux_orders as order_row where order_row.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Robux order was not found.'; end if;
  if v_order.discord_ticket_status = 'open' and v_order.discord_ticket_channel_id = p_channel_id then
    return query select v_order.id, v_order.discord_ticket_channel_id, false; return;
  end if;
  if v_order.discord_ticket_status <> 'creating' then raise exception using errcode = '22000', message = 'Robux ticket is not claimed.'; end if;
  update public.robux_orders set discord_ticket_status = 'open', discord_ticket_channel_id = p_channel_id, updated_at = now()
  where id = v_order.id returning * into v_order;
  return query select v_order.id, v_order.discord_ticket_channel_id, true;
end
$$;

create or replace function public.fail_robux_discord_ticket(p_order_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare v_updated_count integer;
begin
  update public.robux_orders set discord_ticket_status = 'failed', discord_ticket_channel_id = null,
    discord_ticket_claimed_at = null, updated_at = now()
  where id = p_order_id and discord_ticket_status = 'creating';
  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end
$$;

revoke all on function public.create_robux_livepix_order(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.find_robux_livepix_checkout_by_order(uuid) from public, anon, authenticated;
revoke all on function public.find_robux_livepix_checkout_by_reference(text) from public, anon, authenticated;
revoke all on function public.claim_robux_livepix_checkout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.register_claimed_robux_livepix_checkout(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_robux_livepix_checkout_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_robux_livepix_payment(text, text, text, bigint, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.claim_robux_discord_ticket(uuid) from public, anon, authenticated;
revoke all on function public.complete_robux_discord_ticket(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_robux_discord_ticket(uuid) from public, anon, authenticated;

grant execute on function public.create_robux_livepix_order(text, text, text, integer) to service_role;
grant execute on function public.find_robux_livepix_checkout_by_order(uuid) to service_role;
grant execute on function public.find_robux_livepix_checkout_by_reference(text) to service_role;
grant execute on function public.claim_robux_livepix_checkout(uuid, uuid) to service_role;
grant execute on function public.register_claimed_robux_livepix_checkout(uuid, uuid, text, text) to service_role;
grant execute on function public.release_robux_livepix_checkout_claim(uuid, uuid) to service_role;
grant execute on function public.confirm_robux_livepix_payment(text, text, text, bigint, text, timestamptz, text) to service_role;
grant execute on function public.claim_robux_discord_ticket(uuid) to service_role;
grant execute on function public.complete_robux_discord_ticket(uuid, text) to service_role;
grant execute on function public.fail_robux_discord_ticket(uuid) to service_role;

commit;
