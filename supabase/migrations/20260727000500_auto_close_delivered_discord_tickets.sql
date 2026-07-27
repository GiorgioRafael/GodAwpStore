-- Persist paid-ticket delivery completion and atomically claim tickets for
-- automatic closure thirty minutes later.

begin;

set local lock_timeout = '5s';

alter table public.orders
  add column if not exists discord_ticket_delivery_completed_at timestamptz,
  add column if not exists discord_ticket_delivery_completed_by_discord_user_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discord_ticket_delivery_completed_by_format'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_delivery_completed_by_format
      check (
        discord_ticket_delivery_completed_by_discord_user_id is null
        or discord_ticket_delivery_completed_by_discord_user_id ~ '^[0-9]{15,22}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discord_ticket_delivery_completion_state'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_delivery_completion_state
      check (
        (
          discord_ticket_delivery_completed_at is null
          and discord_ticket_delivery_completed_by_discord_user_id is null
        )
        or (
          discord_ticket_delivery_completed_at is not null
          and discord_ticket_delivery_completed_by_discord_user_id is not null
        )
      );
  end if;
end
$$;

comment on column public.orders.discord_ticket_delivery_completed_at is
  'Timestamp at which an authorized Discord administrator marked the paid ticket delivery complete.';
comment on column public.orders.discord_ticket_delivery_completed_by_discord_user_id is
  'Authorized Discord administrator that marked the paid ticket delivery complete.';

create index if not exists orders_discord_ticket_delivery_auto_close_idx
  on public.orders (discord_ticket_delivery_completed_at, id)
  where discord_ticket_status = 'open'
    and status = 'delivered'
    and discord_ticket_delivery_completed_at is not null
    and discord_ticket_close_claim_token is null
    and discord_ticket_channel_id is not null;

create or replace function private.prevent_closed_discord_ticket_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.discord_ticket_status = 'closed'
    and (
      new.discord_ticket_status is distinct from old.discord_ticket_status
      or new.discord_ticket_channel_id is distinct from old.discord_ticket_channel_id
      or new.discord_ticket_claimed_at is distinct from old.discord_ticket_claimed_at
      or new.discord_ticket_close_claim_token is distinct from old.discord_ticket_close_claim_token
      or new.discord_ticket_close_claimed_at is distinct from old.discord_ticket_close_claimed_at
      or new.discord_ticket_close_claimed_by_discord_user_id
        is distinct from old.discord_ticket_close_claimed_by_discord_user_id
      or new.discord_ticket_closed_at is distinct from old.discord_ticket_closed_at
      or new.discord_ticket_closed_by_discord_user_id
        is distinct from old.discord_ticket_closed_by_discord_user_id
      or new.discord_ticket_delivery_completed_at
        is distinct from old.discord_ticket_delivery_completed_at
      or new.discord_ticket_delivery_completed_by_discord_user_id
        is distinct from old.discord_ticket_delivery_completed_by_discord_user_id
    ) then
    raise exception using
      errcode = '55000',
      message = 'A closed Discord ticket is terminal and immutable.';
  end if;

  return new;
end
$$;

drop trigger if exists orders_prevent_closed_discord_ticket_mutation on public.orders;
create trigger orders_prevent_closed_discord_ticket_mutation
before update of
  discord_ticket_status,
  discord_ticket_channel_id,
  discord_ticket_claimed_at,
  discord_ticket_close_claim_token,
  discord_ticket_close_claimed_at,
  discord_ticket_close_claimed_by_discord_user_id,
  discord_ticket_closed_at,
  discord_ticket_closed_by_discord_user_id,
  discord_ticket_delivery_completed_at,
  discord_ticket_delivery_completed_by_discord_user_id
on public.orders
for each row execute function private.prevent_closed_discord_ticket_mutation();

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
      v_order.discord_ticket_delivery_completed_at + interval '30 minutes',
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
      'auto_close_at', v_order.discord_ticket_delivery_completed_at + interval '30 minutes',
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
    v_order.discord_ticket_delivery_completed_at + interval '30 minutes',
    v_order.discord_ticket_delivery_completed_by_discord_user_id;
end
$$;

comment on function public.complete_paid_order_discord_delivery(uuid, text, text, text) is
  'Authorizes and idempotently records a paid-ticket delivery, scheduling its automatic close after thirty minutes.';

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
    where order_row.discord_ticket_status = 'open'
      and order_row.status = 'delivered'
      and order_row.discord_ticket_channel_id is not null
      and order_row.discord_ticket_delivery_completed_at
        <= v_now - interval '30 minutes'
      and order_row.discord_ticket_delivery_completed_by_discord_user_id is not null
      and order_row.discord_ticket_close_claim_token is null
      and order_row.discord_ticket_close_claimed_at is null
      and order_row.discord_ticket_close_claimed_by_discord_user_id is null
    order by order_row.discord_ticket_delivery_completed_at, order_row.id
    for update skip locked
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

comment on function public.claim_due_delivered_discord_ticket_closes(integer) is
  'Atomically claims up to one hundred delivered paid tickets whose thirty-minute post-delivery window elapsed.';

revoke all on function public.complete_paid_order_discord_delivery(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_due_delivered_discord_ticket_closes(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_paid_order_discord_delivery(uuid, text, text, text)
  to service_role;
grant execute on function public.claim_due_delivered_discord_ticket_closes(integer)
  to service_role;

commit;
