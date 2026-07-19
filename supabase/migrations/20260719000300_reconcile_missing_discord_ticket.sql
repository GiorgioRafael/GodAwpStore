-- Terminally reconcile an order when Discord confirms that its ticket channel
-- no longer exists (HTTP 404 with Discord code 10003), including legacy rows
-- without a close actor.

begin;

set local lock_timeout = '5s';

create or replace function public.complete_discord_ticket_close(
  p_order_id uuid,
  p_ticket_channel_id text,
  p_claim_token uuid,
  p_completion_source text
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
  v_order public.orders%rowtype;
  v_now timestamptz := statement_timestamp();
  v_closed_by_discord_user_id text;
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

  if p_completion_source is null
    or p_completion_source not in (
      'discord_http_interaction',
      'discord_close_reconciliation'
    ) then
    raise exception using
      errcode = '22023',
      message = 'Discord ticket close completion source is invalid.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Order was not found.';
  end if;

  if v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using
      errcode = '42501',
      message = 'Discord ticket channel does not match this order.';
  end if;

  select guild.discord_guild_id
  into strict v_discord_guild_id
  from public.guilds as guild
  where guild.id = v_order.guild_id;

  if v_order.discord_ticket_status = 'closed' then
    return query select
      v_order.id,
      false,
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id,
      v_order.discord_ticket_closed_at,
      v_order.discord_ticket_closed_by_discord_user_id;
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

  v_closed_by_discord_user_id :=
    v_order.discord_ticket_close_claimed_by_discord_user_id;

  update public.orders
  set
    discord_ticket_status = 'closed',
    discord_ticket_close_claim_token = null,
    discord_ticket_close_claimed_at = null,
    discord_ticket_close_claimed_by_discord_user_id = null,
    discord_ticket_closed_at = v_now,
    discord_ticket_closed_by_discord_user_id = v_closed_by_discord_user_id
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
    v_closed_by_discord_user_id,
    'bot.order.ticket.close',
    'order',
    v_order.id,
    jsonb_build_object(
      'discord_ticket_channel_id', p_ticket_channel_id,
      'discord_guild_id', v_discord_guild_id,
      'source', p_completion_source
    )
  );

  return query select
    v_order.id,
    true,
    v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id,
    v_order.discord_ticket_closed_at,
    v_order.discord_ticket_closed_by_discord_user_id;
end
$$;

comment on function public.complete_discord_ticket_close(uuid, text, uuid, text) is
  'Completes an exact Discord ticket close lease and records an allowlisted interaction or reconciliation audit source.';

-- Preserve the existing API while routing its audit attribution through the
-- source-aware implementation.
create or replace function public.complete_discord_ticket_close(
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
language sql
security definer
set search_path = pg_catalog
as $$
  select completion.*
  from public.complete_discord_ticket_close(
    p_order_id,
    p_ticket_channel_id,
    p_claim_token,
    'discord_http_interaction'
  ) as completion
$$;

comment on function public.complete_discord_ticket_close(uuid, text, uuid) is
  'Compatibility wrapper that completes a Discord ticket close with the discord_http_interaction audit source.';

create or replace function public.renew_discord_ticket_close_claim(
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
  v_order public.orders%rowtype;
  v_now timestamptz := statement_timestamp();
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
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Order was not found.';
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

  update public.orders
  set discord_ticket_close_claimed_at = v_now
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

comment on function public.renew_discord_ticket_close_claim(uuid, text, uuid) is
  'Atomically renews one expired exact Discord ticket close lease before a reconciliation worker calls Discord; an active lease is never extended twice.';

create or replace function public.reconcile_missing_discord_ticket(
  p_order_id uuid,
  p_ticket_channel_id text
)
returns table (
  reconciled_order_id uuid,
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
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_closed_by_discord_user_id text;
  v_had_claim boolean;
  v_now timestamptz := statement_timestamp();
begin
  if p_ticket_channel_id is null
    or p_ticket_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord ticket channel ID is invalid.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Order was not found.';
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
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id,
      v_order.discord_ticket_closed_at,
      v_order.discord_ticket_closed_by_discord_user_id;
    return;
  end if;

  if v_order.discord_ticket_status <> 'open' then
    raise exception using
      errcode = '22000',
      message = 'Discord ticket is not open.';
  end if;

  select guild.discord_guild_id
  into strict v_discord_guild_id
  from public.guilds as guild
  where guild.id = v_order.guild_id;

  v_closed_by_discord_user_id :=
    v_order.discord_ticket_close_claimed_by_discord_user_id;
  v_had_claim := v_closed_by_discord_user_id is not null;

  update public.orders
  set
    discord_ticket_status = 'closed',
    discord_ticket_close_claim_token = null,
    discord_ticket_close_claimed_at = null,
    discord_ticket_close_claimed_by_discord_user_id = null,
    discord_ticket_closed_at = v_now,
    discord_ticket_closed_by_discord_user_id = v_closed_by_discord_user_id
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
    v_closed_by_discord_user_id,
    'bot.order.ticket.reconcile_missing',
    'order',
    v_order.id,
    jsonb_build_object(
      'discord_guild_id', v_discord_guild_id,
      'discord_ticket_channel_id', p_ticket_channel_id,
      'source', 'discord_api_unknown_channel_10003',
      'had_claim', v_had_claim
    )
  );

  return query select
    v_order.id,
    true,
    v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id,
    v_order.discord_ticket_closed_at,
    v_order.discord_ticket_closed_by_discord_user_id;
end
$$;

comment on function public.reconcile_missing_discord_ticket(uuid, text) is
  'Atomically and idempotently closes an open ticket after a trusted worker confirms Discord Unknown Channel (HTTP 404, code 10003) for the exact channel.';

comment on column public.orders.discord_ticket_closed_by_discord_user_id is
  'Discord administrator attributed to the ticket close; NULL for legacy or system reconciliation closes without a prior actor claim.';

revoke all on function public.reconcile_missing_discord_ticket(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.renew_discord_ticket_close_claim(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_discord_ticket_close(uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_discord_ticket_close(uuid, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.reconcile_missing_discord_ticket(uuid, text)
  to service_role;
grant execute on function public.renew_discord_ticket_close_claim(uuid, text, uuid)
  to service_role;
grant execute on function public.complete_discord_ticket_close(uuid, text, uuid, text)
  to service_role;
grant execute on function public.complete_discord_ticket_close(uuid, text, uuid)
  to service_role;

commit;
