begin;

alter table public.orders
  add column if not exists livepix_checkout_claim_token uuid,
  add column if not exists livepix_checkout_claimed_at timestamptz;

alter table public.orders
  drop constraint if exists orders_livepix_checkout_claim_state;
alter table public.orders
  add constraint orders_livepix_checkout_claim_state check (
    (livepix_checkout_claim_token is null and livepix_checkout_claimed_at is null)
    or (livepix_checkout_claim_token is not null and livepix_checkout_claimed_at is not null)
  );

create index if not exists orders_livepix_checkout_claim_idx
  on public.orders (livepix_checkout_claimed_at)
  where payment_provider_reference is null
    and livepix_checkout_claim_token is not null;

create or replace function public.claim_livepix_checkout(
  p_order_id uuid,
  p_claim_token uuid
)
returns table (
  claimed_order_id uuid,
  claimed boolean,
  provider_reference text,
  checkout_url text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'LivePix checkout claim token is required.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;
  if (v_order.payment_provider_reference is null) <> (v_order.payment_checkout_url is null) then
    raise exception using errcode = '22000', message = 'LivePix checkout data is incomplete.';
  end if;
  if v_order.payment_provider_reference is not null then
    return query select
      v_order.id,
      false,
      v_order.payment_provider_reference,
      v_order.payment_checkout_url;
    return;
  end if;
  if v_order.payment_provider <> 'livepix'
    or v_order.payment_reference is null
    or v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending') then
    raise exception using errcode = '22000', message = 'Order is not ready for LivePix checkout.';
  end if;

  if v_order.livepix_checkout_claim_token is not null
    and v_order.livepix_checkout_claim_token <> p_claim_token
    and v_order.livepix_checkout_claimed_at > now() - interval '5 minutes' then
    return query select v_order.id, false, null::text, null::text;
    return;
  end if;

  update public.orders
  set
    livepix_checkout_claim_token = p_claim_token,
    livepix_checkout_claimed_at = now()
  where id = v_order.id
  returning * into v_order;

  return query select v_order.id, true, null::text, null::text;
end
$$;

create or replace function public.register_claimed_livepix_checkout(
  p_order_id uuid,
  p_claim_token uuid,
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
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'LivePix checkout claim token is required.';
  end if;
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
  if v_order.payment_provider_reference is not null then
    if v_order.payment_provider_reference <> btrim(p_provider_reference)
      or v_order.payment_checkout_url <> p_checkout_url
      or (
        p_expires_at is not null
        and v_order.payment_expires_at is distinct from p_expires_at
      ) then
      raise exception using errcode = '22000', message = 'Order already has different LivePix checkout data.';
    end if;
    return query select
      v_order.id,
      v_order.payment_provider_reference,
      v_order.payment_checkout_url,
      false;
    return;
  end if;
  if v_order.livepix_checkout_claim_token is distinct from p_claim_token
    or v_order.livepix_checkout_claimed_at is null then
    raise exception using errcode = '42501', message = 'LivePix checkout claim is not owned by this request.';
  end if;
  if v_order.payment_provider <> 'livepix'
    or v_order.payment_reference is null
    or v_order.status not in ('pending', 'awaiting_payment')
    or v_order.payment_status not in ('uninitialized', 'pending') then
    raise exception using errcode = '22000', message = 'Order cannot receive a checkout in its current state.';
  end if;

  update public.orders
  set
    payment_provider_reference = btrim(p_provider_reference),
    payment_checkout_url = p_checkout_url,
    payment_expires_at = p_expires_at,
    payment_status = 'pending',
    status = 'awaiting_payment',
    livepix_checkout_claim_token = null,
    livepix_checkout_claimed_at = null
  where id = v_order.id
  returning * into v_order;

  return query select
    v_order.id,
    v_order.payment_provider_reference,
    v_order.payment_checkout_url,
    true;
end
$$;

create or replace function public.release_livepix_checkout_claim(
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
  update public.orders
  set
    livepix_checkout_claim_token = null,
    livepix_checkout_claimed_at = null
  where id = p_order_id
    and payment_provider_reference is null
    and livepix_checkout_claim_token = p_claim_token;

  get diagnostics v_released_count = row_count;
  return v_released_count > 0;
end
$$;

comment on function public.claim_livepix_checkout(uuid, uuid) is
  'Claims LivePix checkout creation with a five-minute lease so concurrent Discord retries cannot create duplicate provider payments.';
comment on function public.register_claimed_livepix_checkout(uuid, uuid, text, text, timestamptz) is
  'Registers a LivePix checkout only for the request that owns the order checkout claim.';
comment on function public.release_livepix_checkout_claim(uuid, uuid) is
  'Releases a LivePix checkout claim when provider creation fails before returning checkout data.';

revoke all on function public.claim_livepix_checkout(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_livepix_checkout(uuid, uuid)
  to service_role;
revoke all on function public.register_claimed_livepix_checkout(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_claimed_livepix_checkout(uuid, uuid, text, text, timestamptz)
  to service_role;
revoke all on function public.release_livepix_checkout_claim(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_livepix_checkout_claim(uuid, uuid)
  to service_role;

drop function if exists public.claim_discord_ticket(uuid);

create function public.claim_discord_ticket(p_order_id uuid)
returns table (
  claimed_order_id uuid,
  claimed boolean,
  discord_guild_id text,
  buyer_discord_id text,
  product_name text,
  paid_amount_cents bigint,
  ticket_status public.discord_ticket_status,
  existing_channel_id text,
  order_quantity integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_product_name text;
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
    return query select
      v_order.id, false, v_discord_guild_id, v_order.buyer_discord_id,
      v_product_name, v_order.sale_price_cents, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, v_order.quantity;
    return;
  end if;

  if v_order.status not in ('paid', 'processing', 'delivered')
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null then
    raise exception using errcode = '22000', message = 'Order is not eligible for a Discord ticket.';
  end if;

  if v_order.discord_ticket_status = 'creating'
    and v_order.discord_ticket_claimed_at > now() - interval '5 minutes' then
    return query select
      v_order.id, false, v_discord_guild_id, v_order.buyer_discord_id,
      v_product_name, v_order.sale_price_cents, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, v_order.quantity;
    return;
  end if;

  update public.orders
  set
    discord_ticket_status = 'creating',
    discord_ticket_channel_id = null,
    discord_ticket_claimed_at = now()
  where id = v_order.id
  returning * into v_order;

  return query select
    v_order.id, true, v_discord_guild_id, v_order.buyer_discord_id,
    v_product_name, v_order.sale_price_cents, v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id, v_order.quantity;
end
$$;

comment on function public.claim_discord_ticket(uuid) is
  'Atomically claims paid-order Discord ticket creation and returns the snapshotted order quantity in the same transaction.';
revoke all on function public.claim_discord_ticket(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_discord_ticket(uuid)
  to service_role;

commit;
