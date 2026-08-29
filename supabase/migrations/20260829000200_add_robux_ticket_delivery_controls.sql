-- Give paid Robux tickets the same delivery acknowledgement and auditable close
-- lifecycle used by item-sale tickets. The quantity is delivered through a
-- Gamepass, so the buyer continues to provide the Roblox nick in the channel.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '15s';

alter table public.robux_orders
  add column if not exists discord_ticket_delivery_completed_at timestamptz,
  add column if not exists discord_ticket_delivery_completed_by_discord_user_id text,
  add column if not exists discord_ticket_close_claim_token uuid,
  add column if not exists discord_ticket_close_claimed_at timestamptz,
  add column if not exists discord_ticket_close_claimed_by_discord_user_id text,
  add column if not exists discord_ticket_closed_at timestamptz,
  add column if not exists discord_ticket_closed_by_discord_user_id text;

alter table public.robux_orders
  drop constraint if exists robux_orders_ticket_delivery_completed_by_format,
  drop constraint if exists robux_orders_ticket_delivery_completion_state,
  drop constraint if exists robux_orders_ticket_close_claim_state,
  drop constraint if exists robux_orders_ticket_closed_by_format;

alter table public.robux_orders
  add constraint robux_orders_ticket_delivery_completed_by_format
    check (
      discord_ticket_delivery_completed_by_discord_user_id is null
      or discord_ticket_delivery_completed_by_discord_user_id ~ '^[0-9]{15,22}$'
    ),
  add constraint robux_orders_ticket_delivery_completion_state
    check (
      (discord_ticket_delivery_completed_at is null
        and discord_ticket_delivery_completed_by_discord_user_id is null)
      or (discord_ticket_delivery_completed_at is not null
        and discord_ticket_delivery_completed_by_discord_user_id is not null)
    ),
  add constraint robux_orders_ticket_close_claim_state
    check (
      (discord_ticket_close_claim_token is null
        and discord_ticket_close_claimed_at is null
        and discord_ticket_close_claimed_by_discord_user_id is null)
      or (discord_ticket_close_claim_token is not null
        and discord_ticket_close_claimed_at is not null
        and discord_ticket_close_claimed_by_discord_user_id ~ '^[0-9]{15,22}$')
    ),
  add constraint robux_orders_ticket_closed_by_format
    check (
      discord_ticket_closed_by_discord_user_id is null
      or discord_ticket_closed_by_discord_user_id ~ '^[0-9]{15,22}$'
    );

create index if not exists robux_orders_ticket_delivery_idx
  on public.robux_orders (discord_ticket_delivery_completed_at, id)
  where discord_ticket_status = 'open'
    and payment_status = 'paid'
    and discord_ticket_delivery_completed_at is not null;

create or replace function public.complete_robux_discord_ticket_delivery(
  p_order_id uuid,
  p_discord_guild_id text,
  p_ticket_channel_id text,
  p_delivered_by_discord_user_id text
)
returns table (
  completed_order_id uuid,
  was_completed boolean,
  order_status text,
  ticket_status public.discord_ticket_status,
  ticket_channel_id text,
  delivery_completed_at timestamptz,
  auto_close_at timestamptz,
  delivered_by_discord_user_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
  v_discord_guild_id text;
  v_authorized_discord_user_ids text[];
  v_now timestamptz := statement_timestamp();
begin
  if p_discord_guild_id is null or p_discord_guild_id !~ '^[0-9]{15,22}$'
    or p_ticket_channel_id is null or p_ticket_channel_id !~ '^[0-9]{15,22}$'
    or p_delivered_by_discord_user_id is null
      or p_delivered_by_discord_user_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord delivery identifiers are invalid.';
  end if;

  select order_row.* into v_order
  from public.robux_orders as order_row where order_row.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Robux order was not found.'; end if;

  select guild.discord_guild_id into strict v_discord_guild_id
  from public.guilds as guild where guild.id = v_order.guild_id;
  if v_discord_guild_id <> p_discord_guild_id
    or v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using errcode = '42501', message = 'Discord ticket does not match this Robux order.';
  end if;

  select settings.ticket_close_admin_discord_user_ids into strict v_authorized_discord_user_ids
  from public.platform_settings as settings where settings.id = 1;
  if not (p_delivered_by_discord_user_id = any(v_authorized_discord_user_ids)) then
    raise exception using errcode = '42501', message = 'Discord user is not authorized to complete deliveries.';
  end if;

  if v_order.discord_ticket_status <> 'open'
    or v_order.status <> 'paid'
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null then
    raise exception using errcode = '22000', message = 'Robux order is not eligible for delivery.';
  end if;
  if v_order.discord_ticket_close_claim_token is not null then
    raise exception using errcode = '55000', message = 'Discord ticket is currently being closed.';
  end if;
  if v_order.discord_ticket_delivery_completed_at is not null then
    return query select v_order.id, false, v_order.status, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, v_order.discord_ticket_delivery_completed_at,
      v_order.discord_ticket_delivery_completed_at + interval '30 minutes',
      v_order.discord_ticket_delivery_completed_by_discord_user_id;
    return;
  end if;

  update public.robux_orders
  set discord_ticket_delivery_completed_at = v_now,
      discord_ticket_delivery_completed_by_discord_user_id = p_delivered_by_discord_user_id,
      updated_at = v_now
  where id = v_order.id
  returning * into v_order;

  return query select v_order.id, true, v_order.status, v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id, v_order.discord_ticket_delivery_completed_at,
    v_order.discord_ticket_delivery_completed_at + interval '30 minutes',
    v_order.discord_ticket_delivery_completed_by_discord_user_id;
end
$$;

create or replace function public.claim_robux_discord_ticket_close(
  p_order_id uuid,
  p_discord_guild_id text,
  p_ticket_channel_id text,
  p_closed_by_discord_user_id text,
  p_claim_token uuid
)
returns table (
  claimed_order_id uuid,
  claimed boolean,
  already_closed boolean,
  ticket_status public.discord_ticket_status,
  ticket_channel_id text,
  claim_token uuid,
  claim_expires_at timestamptz,
  closed_at timestamptz,
  closed_by_discord_user_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
  v_discord_guild_id text;
  v_authorized_discord_user_ids text[];
  v_now timestamptz := statement_timestamp();
begin
  if p_discord_guild_id is null or p_discord_guild_id !~ '^[0-9]{15,22}$'
    or p_ticket_channel_id is null or p_ticket_channel_id !~ '^[0-9]{15,22}$'
    or p_closed_by_discord_user_id is null
      or p_closed_by_discord_user_id !~ '^[0-9]{15,22}$'
    or p_claim_token is null then
    raise exception using errcode = '22023', message = 'Discord ticket close identifiers are invalid.';
  end if;

  select order_row.* into v_order
  from public.robux_orders as order_row where order_row.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Robux order was not found.'; end if;
  select guild.discord_guild_id into strict v_discord_guild_id
  from public.guilds as guild where guild.id = v_order.guild_id;
  if v_discord_guild_id <> p_discord_guild_id
    or v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using errcode = '42501', message = 'Discord ticket does not match this Robux order.';
  end if;
  select settings.ticket_close_admin_discord_user_ids into strict v_authorized_discord_user_ids
  from public.platform_settings as settings where settings.id = 1;
  if not (p_closed_by_discord_user_id = any(v_authorized_discord_user_ids)) then
    raise exception using errcode = '42501', message = 'Discord user is not authorized to close tickets.';
  end if;
  if v_order.discord_ticket_status = 'closed' then
    return query select v_order.id, false, true, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, null::uuid, null::timestamptz,
      v_order.discord_ticket_closed_at, v_order.discord_ticket_closed_by_discord_user_id;
    return;
  end if;
  if v_order.discord_ticket_status <> 'open' then
    raise exception using errcode = '22000', message = 'Discord ticket is not open.';
  end if;
  if v_order.discord_ticket_close_claim_token is not null
    and v_order.discord_ticket_close_claimed_at > v_now - interval '5 minutes' then
    if v_order.discord_ticket_close_claim_token = p_claim_token
      and v_order.discord_ticket_close_claimed_by_discord_user_id = p_closed_by_discord_user_id then
      return query select v_order.id, true, false, v_order.discord_ticket_status,
        v_order.discord_ticket_channel_id, v_order.discord_ticket_close_claim_token,
        v_order.discord_ticket_close_claimed_at + interval '5 minutes', null::timestamptz, null::text;
    end if;
    return query select v_order.id, false, false, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, null::uuid,
      v_order.discord_ticket_close_claimed_at + interval '5 minutes', null::timestamptz, null::text;
    return;
  end if;

  update public.robux_orders
  set discord_ticket_close_claim_token = p_claim_token,
      discord_ticket_close_claimed_at = v_now,
      discord_ticket_close_claimed_by_discord_user_id = p_closed_by_discord_user_id,
      updated_at = v_now
  where id = v_order.id
  returning * into v_order;
  return query select v_order.id, true, false, v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id, v_order.discord_ticket_close_claim_token,
    v_order.discord_ticket_close_claimed_at + interval '5 minutes', null::timestamptz, null::text;
end
$$;

create or replace function public.complete_robux_discord_ticket_close(
  p_order_id uuid,
  p_ticket_channel_id text,
  p_claim_token uuid
)
returns table (
  completed_order_id uuid,
  was_closed boolean,
  ticket_status public.discord_ticket_status,
  ticket_channel_id text,
  closed_at timestamptz,
  closed_by_discord_user_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if p_ticket_channel_id is null or p_ticket_channel_id !~ '^[0-9]{15,22}$'
    or p_claim_token is null then
    raise exception using errcode = '22023', message = 'Discord ticket close identifiers are invalid.';
  end if;
  select order_row.* into v_order
  from public.robux_orders as order_row where order_row.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Robux order was not found.'; end if;
  if v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using errcode = '42501', message = 'Discord ticket does not match this Robux order.';
  end if;
  if v_order.discord_ticket_status = 'closed' then
    return query select v_order.id, false, v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id, v_order.discord_ticket_closed_at,
      v_order.discord_ticket_closed_by_discord_user_id;
    return;
  end if;
  if v_order.discord_ticket_status <> 'open'
    or v_order.discord_ticket_close_claim_token is distinct from p_claim_token
    or v_order.discord_ticket_close_claimed_by_discord_user_id is null then
    raise exception using errcode = '42501', message = 'Discord ticket close claim does not match.';
  end if;

  update public.robux_orders
  set discord_ticket_status = 'closed',
      discord_ticket_close_claim_token = null,
      discord_ticket_close_claimed_at = null,
      discord_ticket_close_claimed_by_discord_user_id = null,
      discord_ticket_closed_at = v_now,
      discord_ticket_closed_by_discord_user_id = v_order.discord_ticket_close_claimed_by_discord_user_id,
      updated_at = v_now
  where id = v_order.id
  returning * into v_order;
  return query select v_order.id, true, v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id, v_order.discord_ticket_closed_at,
    v_order.discord_ticket_closed_by_discord_user_id;
end
$$;

create or replace function public.release_robux_discord_ticket_close(
  p_order_id uuid,
  p_claim_token uuid
)
returns table (
  released_order_id uuid,
  released boolean,
  ticket_status public.discord_ticket_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_order public.robux_orders%rowtype;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Discord ticket close claim token is required.';
  end if;
  select order_row.* into v_order
  from public.robux_orders as order_row where order_row.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Robux order was not found.'; end if;
  if v_order.discord_ticket_status = 'closed'
    or v_order.discord_ticket_close_claim_token is distinct from p_claim_token then
    return query select v_order.id, false, v_order.discord_ticket_status;
    return;
  end if;
  update public.robux_orders
  set discord_ticket_close_claim_token = null,
      discord_ticket_close_claimed_at = null,
      discord_ticket_close_claimed_by_discord_user_id = null,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;
  return query select v_order.id, true, v_order.discord_ticket_status;
end
$$;

revoke all on function public.complete_robux_discord_ticket_delivery(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_robux_discord_ticket_close(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_robux_discord_ticket_close(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.release_robux_discord_ticket_close(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_robux_discord_ticket_delivery(uuid, text, text, text)
  to service_role;
grant execute on function public.claim_robux_discord_ticket_close(uuid, text, text, text, uuid)
  to service_role;
grant execute on function public.complete_robux_discord_ticket_close(uuid, text, uuid)
  to service_role;
grant execute on function public.release_robux_discord_ticket_close(uuid, uuid)
  to service_role;

commit;
