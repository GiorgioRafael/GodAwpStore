-- Shorten completed purchase tickets to five minutes only in GWStore.
-- Robux joins the durable close queue with an explicit source; other guilds,
-- offers to sell items, and external ticket bots are outside this queue.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.complete_paid_order_discord_delivery(
  p_order_id uuid,
  p_discord_guild_id text,
  p_ticket_channel_id text,
  p_delivered_by_discord_user_id text
)
returns table (
  completed_order_id uuid,
  was_completed boolean,
  order_status public.order_status,
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
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_auto_close_delay interval;
  v_authorized_discord_user_ids text[];
  v_now timestamptz := statement_timestamp();
begin
  if p_discord_guild_id is null
    or p_discord_guild_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord guild ID is invalid.';
  end if;

  if p_ticket_channel_id is null
    or p_ticket_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord ticket channel ID is invalid.';
  end if;

  if p_delivered_by_discord_user_id is null
    or p_delivered_by_discord_user_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord delivery administrator ID is invalid.';
  end if;

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
  v_auto_close_delay := case when v_discord_guild_id = '1401264061101899820'
    then interval '5 minutes' else interval '30 minutes' end;

  if v_discord_guild_id <> p_discord_guild_id then
    raise exception using errcode = '42501', message = 'Discord guild does not match this order.';
  end if;

  if v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using errcode = '42501', message = 'Discord ticket channel does not match this order.';
  end if;

  select settings.ticket_close_admin_discord_user_ids
  into strict v_authorized_discord_user_ids
  from public.platform_settings as settings
  where settings.id = 1;

  if not (p_delivered_by_discord_user_id = any(v_authorized_discord_user_ids)) then
    raise exception using errcode = '42501', message = 'Discord user is not authorized to complete deliveries.';
  end if;

  if v_order.discord_ticket_status <> 'open' then
    raise exception using errcode = '22000', message = 'Discord ticket is not open.';
  end if;

  if v_order.status not in ('paid', 'processing', 'delivered')
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null then
    raise exception using errcode = '22000', message = 'Order payment is not eligible for delivery.';
  end if;

  if v_order.discord_ticket_close_claim_token is not null then
    raise exception using errcode = '55000', message = 'Discord ticket is currently being closed.';
  end if;

  if v_order.discord_ticket_delivery_completed_at is not null then
    return query select
      v_order.id,
      false,
      v_order.status,
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id,
      v_order.discord_ticket_delivery_completed_at,
      v_order.discord_ticket_delivery_completed_at + v_auto_close_delay,
      v_order.discord_ticket_delivery_completed_by_discord_user_id;
    return;
  end if;

  update public.orders
  set
    status = 'delivered',
    delivered_at = coalesce(delivered_at, v_now),
    discord_ticket_delivery_completed_at = v_now,
    discord_ticket_delivery_completed_by_discord_user_id =
      p_delivered_by_discord_user_id
  where id = v_order.id
  returning * into v_order;

  insert into public.audit_events (
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_delivered_by_discord_user_id,
    'bot.order.ticket.delivery.complete',
    'order',
    v_order.id,
    jsonb_build_object(
      'discord_ticket_channel_id', p_ticket_channel_id,
      'discord_guild_id', p_discord_guild_id,
      'auto_close_at', v_order.discord_ticket_delivery_completed_at + v_auto_close_delay,
      'source', 'discord_http_interaction'
    )
  );

  return query select
    v_order.id,
    true,
    v_order.status,
    v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id,
    v_order.discord_ticket_delivery_completed_at,
    v_order.discord_ticket_delivery_completed_at + v_auto_close_delay,
    v_order.discord_ticket_delivery_completed_by_discord_user_id;
end
$$;

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
  v_auto_close_delay interval;
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
  v_auto_close_delay := case when v_discord_guild_id = '1401264061101899820'
    then interval '5 minutes' else interval '30 minutes' end;
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
      v_order.discord_ticket_delivery_completed_at + v_auto_close_delay,
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
    v_order.discord_ticket_delivery_completed_at + v_auto_close_delay,
    v_order.discord_ticket_delivery_completed_by_discord_user_id;
end
$$;

create or replace function public.claim_due_delivered_discord_ticket_closes(
  p_limit integer
)
returns table (
  claimed_order_id uuid,
  discord_guild_id text,
  ticket_channel_id text,
  claim_token uuid,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := statement_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Automatic close claim limit is invalid.';
  end if;

  return query
  with candidates as (
    select order_row.id
    from public.orders as order_row
    join public.guilds as candidate_guild on candidate_guild.id = order_row.guild_id
    where order_row.discord_ticket_status = 'open'
      and order_row.status = 'delivered'
      and order_row.discord_ticket_channel_id is not null
      and order_row.discord_ticket_delivery_completed_at
        <= v_now - case when candidate_guild.discord_guild_id = '1401264061101899820'
          then interval '5 minutes' else interval '30 minutes' end
      and order_row.discord_ticket_delivery_completed_by_discord_user_id is not null
      and order_row.discord_ticket_close_claim_token is null
      and order_row.discord_ticket_close_claimed_at is null
      and order_row.discord_ticket_close_claimed_by_discord_user_id is null
    order by order_row.discord_ticket_delivery_completed_at, order_row.id
    for update of order_row skip locked
    limit p_limit
  ),
  claimed as (
    update public.orders as order_row
    set
      discord_ticket_close_claim_token = gen_random_uuid(),
      discord_ticket_close_claimed_at = v_now,
      discord_ticket_close_claimed_by_discord_user_id =
        order_row.discord_ticket_delivery_completed_by_discord_user_id
    from candidates
    where order_row.id = candidates.id
      and order_row.discord_ticket_status = 'open'
      and order_row.discord_ticket_close_claim_token is null
    returning
      order_row.id,
      order_row.guild_id,
      order_row.discord_ticket_channel_id,
      order_row.discord_ticket_close_claim_token,
      order_row.discord_ticket_close_claimed_at
  )
  select
    claimed.id,
    guild.discord_guild_id,
    claimed.discord_ticket_channel_id,
    claimed.discord_ticket_close_claim_token,
    claimed.discord_ticket_close_claimed_at
  from claimed
  join public.guilds as guild on guild.id = claimed.guild_id
  order by claimed.discord_ticket_close_claimed_at, claimed.id;
end
$$;

create or replace function public.renew_robux_discord_ticket_close_claim(
  p_order_id uuid,
  p_ticket_channel_id text,
  p_claim_token uuid
)
returns table (
  renewed_order_id uuid,
  renewed boolean,
  active boolean,
  ticket_status public.discord_ticket_status,
  ticket_channel_id text,
  claim_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.robux_orders%rowtype;
  v_now timestamptz := statement_timestamp();
  v_discord_guild_id text;
begin
  if p_ticket_channel_id is null
    or p_ticket_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord ticket channel ID is invalid.';
  end if;

  if p_claim_token is null then
    raise exception using
      errcode = '22023',
      message = 'Discord ticket close claim token is required.';
  end if;

  select order_row.*
  into v_order
  from public.robux_orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Order was not found.';
  end if;

  select guild.discord_guild_id into strict v_discord_guild_id
  from public.guilds as guild where guild.id = v_order.guild_id;
  if v_discord_guild_id <> '1401264061101899820' then
    raise exception using errcode = '42501', message = 'Automatic Robux close recovery is restricted to GWStore.';
  end if;

  if v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using
      errcode = '42501',
      message = 'Discord ticket channel does not match this order.';
  end if;

  if v_order.discord_ticket_status = 'closed' then
    return query select
      v_order.id,
      false,
      false,
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id,
      null::timestamptz;
    return;
  end if;

  if v_order.discord_ticket_status <> 'open' then
    raise exception using
      errcode = '22000',
      message = 'Discord ticket is not open.';
  end if;

  if v_order.discord_ticket_close_claim_token is distinct from p_claim_token
    or v_order.discord_ticket_close_claimed_at is null
    or v_order.discord_ticket_close_claimed_by_discord_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Discord ticket close claim does not match.';
  end if;

  if v_order.discord_ticket_close_claimed_at > v_now - interval '5 minutes' then
    return query select
      v_order.id,
      false,
      true,
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id,
      v_order.discord_ticket_close_claimed_at + interval '5 minutes';
    return;
  end if;

  update public.robux_orders
  set discord_ticket_close_claimed_at = v_now, updated_at = v_now
  where id = v_order.id
  returning * into v_order;

  return query select
    v_order.id,
    true,
    false,
    v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id,
    v_order.discord_ticket_close_claimed_at + interval '5 minutes';
end
$$;

create or replace function public.claim_due_gwstore_discord_ticket_closes(
  p_limit integer
)
returns table (
  source text,
  claimed_order_id uuid,
  discord_guild_id text,
  ticket_channel_id text,
  claim_token uuid,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := statement_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Automatic close claim limit is invalid.';
  end if;

  return query
  with purchase_candidates as materialized (
    select order_row.id
    from public.orders as order_row
    join public.guilds as guild on guild.id = order_row.guild_id
    where guild.discord_guild_id = '1401264061101899820'
      and order_row.discord_ticket_status = 'open'
      and order_row.status = 'delivered'
      and order_row.payment_status = 'paid'
      and order_row.paid_at is not null
      and order_row.discord_ticket_channel_id is not null
      and order_row.discord_ticket_delivery_completed_at <= v_now - interval '5 minutes'
      and order_row.discord_ticket_delivery_completed_by_discord_user_id is not null
      and order_row.discord_ticket_close_claim_token is null
      and order_row.discord_ticket_close_claimed_at is null
      and order_row.discord_ticket_close_claimed_by_discord_user_id is null
    order by order_row.discord_ticket_delivery_completed_at, order_row.id
    for update of order_row skip locked
    limit p_limit
  ),
  robux_candidates as materialized (
    select order_row.id
    from public.robux_orders as order_row
    join public.guilds as guild on guild.id = order_row.guild_id
    where guild.discord_guild_id = '1401264061101899820'
      and order_row.discord_ticket_status = 'open'
      and order_row.status = 'paid'
      and order_row.payment_status = 'paid'
      and order_row.paid_at is not null
      and order_row.discord_ticket_channel_id is not null
      and order_row.discord_ticket_delivery_completed_at <= v_now - interval '5 minutes'
      and order_row.discord_ticket_delivery_completed_by_discord_user_id is not null
      and order_row.discord_ticket_close_claim_token is null
      and order_row.discord_ticket_close_claimed_at is null
      and order_row.discord_ticket_close_claimed_by_discord_user_id is null
    order by order_row.discord_ticket_delivery_completed_at, order_row.id
    for update of order_row skip locked
    limit greatest(p_limit - (select count(*)::integer from purchase_candidates), 0)
  ),
  purchase_claims as (
    update public.orders as order_row
    set discord_ticket_close_claim_token = gen_random_uuid(),
      discord_ticket_close_claimed_at = v_now,
      discord_ticket_close_claimed_by_discord_user_id = order_row.discord_ticket_delivery_completed_by_discord_user_id
    from purchase_candidates
    where order_row.id = purchase_candidates.id
      and order_row.discord_ticket_status = 'open'
      and order_row.discord_ticket_close_claim_token is null
    returning order_row.id, order_row.guild_id, order_row.discord_ticket_channel_id,
      order_row.discord_ticket_close_claim_token, order_row.discord_ticket_close_claimed_at
  ),
  robux_claims as (
    update public.robux_orders as order_row
    set discord_ticket_close_claim_token = gen_random_uuid(),
      discord_ticket_close_claimed_at = v_now,
      discord_ticket_close_claimed_by_discord_user_id = order_row.discord_ticket_delivery_completed_by_discord_user_id,
      updated_at = v_now
    from robux_candidates
    where order_row.id = robux_candidates.id
      and order_row.discord_ticket_status = 'open'
      and order_row.discord_ticket_close_claim_token is null
    returning order_row.id, order_row.guild_id, order_row.discord_ticket_channel_id,
      order_row.discord_ticket_close_claim_token, order_row.discord_ticket_close_claimed_at
  ),
  claims as (
    select 'orders'::text as ticket_source, purchase_claims.* from purchase_claims
    union all
    select 'robux'::text as ticket_source, robux_claims.* from robux_claims
  )
  select claims.ticket_source, claims.id, guild.discord_guild_id,
    claims.discord_ticket_channel_id, claims.discord_ticket_close_claim_token,
    claims.discord_ticket_close_claimed_at
  from claims
  join public.guilds as guild on guild.id = claims.guild_id
  order by claims.discord_ticket_close_claimed_at, claims.ticket_source, claims.id;
end
$$;

comment on function public.complete_paid_order_discord_delivery(uuid, text, text, text) is
  'Authorizes and idempotently records delivery; automatic close is five minutes in GWStore and thirty minutes in other guilds.';
comment on function public.complete_robux_discord_ticket_delivery(uuid, text, text, text) is
  'Authorizes and idempotently records Robux delivery; GWStore closes after five minutes, other guilds retain thirty-minute metadata.';
comment on function public.claim_due_delivered_discord_ticket_closes(integer) is
  'Compatibility queue for delivered item tickets, five minutes in GWStore and thirty minutes in other guilds.';
comment on function public.claim_due_gwstore_discord_ticket_closes(integer) is
  'Atomically claims up to one hundred delivered GWStore item or Robux tickets after five minutes; source identifies the exact close RPC.';
comment on function public.renew_robux_discord_ticket_close_claim(uuid, text, uuid) is
  'Renews only an expired exact GWStore Robux close lease, retaining the token for durable Discord retry recovery.';

revoke all on function public.claim_due_gwstore_discord_ticket_closes(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.renew_robux_discord_ticket_close_claim(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_gwstore_discord_ticket_closes(integer) to service_role;
grant execute on function public.renew_robux_discord_ticket_close_claim(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
