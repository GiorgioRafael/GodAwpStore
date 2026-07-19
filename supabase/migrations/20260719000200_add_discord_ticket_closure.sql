-- Authorized, audited, and idempotent closing of paid-order Discord tickets.

begin;

set local lock_timeout = '5s';

alter table public.platform_settings
  add column if not exists ticket_close_admin_discord_user_ids text[];

update public.platform_settings
set ticket_close_admin_discord_user_ids = array[
  '234486394414825472',
  '385924725332901909',
  '911402638975844354'
]::text[]
where ticket_close_admin_discord_user_ids is null;

alter table public.platform_settings
  alter column ticket_close_admin_discord_user_ids
    set default array[
      '234486394414825472',
      '385924725332901909',
      '911402638975844354'
    ]::text[],
  alter column ticket_close_admin_discord_user_ids
    set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_ticket_close_admin_ids_cardinality'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ticket_close_admin_ids_cardinality
      check (cardinality(ticket_close_admin_discord_user_ids) between 0 and 25);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_ticket_close_admin_ids_valid'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ticket_close_admin_ids_valid
      check (
        private.valid_unique_discord_user_ids(ticket_close_admin_discord_user_ids)
      );
  end if;
end
$$;

comment on column public.platform_settings.ticket_close_admin_discord_user_ids is
  'Ordered global allowlist of Discord administrators permitted to close paid-order tickets.';

alter table public.orders
  add column if not exists discord_ticket_close_claim_token uuid,
  add column if not exists discord_ticket_close_claimed_at timestamptz,
  add column if not exists discord_ticket_close_claimed_by_discord_user_id text,
  add column if not exists discord_ticket_closed_at timestamptz,
  add column if not exists discord_ticket_closed_by_discord_user_id text;

-- There was no application close flow before this migration. Preserve any
-- manually closed legacy row without inventing an actor identity.
update public.orders
set
  discord_ticket_close_claim_token = null,
  discord_ticket_close_claimed_at = null,
  discord_ticket_close_claimed_by_discord_user_id = null,
  discord_ticket_closed_at = coalesce(
    discord_ticket_closed_at,
    updated_at,
    discord_ticket_claimed_at,
    created_at
  )
where discord_ticket_status = 'closed';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discord_ticket_close_claimed_by_format'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_close_claimed_by_format
      check (
        discord_ticket_close_claimed_by_discord_user_id is null
        or discord_ticket_close_claimed_by_discord_user_id ~ '^[0-9]{15,22}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discord_ticket_closed_by_format'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_closed_by_format
      check (
        discord_ticket_closed_by_discord_user_id is null
        or discord_ticket_closed_by_discord_user_id ~ '^[0-9]{15,22}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discord_ticket_close_claim_state'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_close_claim_state
      check (
        (
          discord_ticket_close_claim_token is null
          and discord_ticket_close_claimed_at is null
          and discord_ticket_close_claimed_by_discord_user_id is null
        )
        or (
          discord_ticket_status = 'open'
          and discord_ticket_close_claim_token is not null
          and discord_ticket_close_claimed_at is not null
          and discord_ticket_close_claimed_by_discord_user_id is not null
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discord_ticket_closed_state'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discord_ticket_closed_state
      check (
        (
          discord_ticket_status = 'closed'
          and discord_ticket_closed_at is not null
          and discord_ticket_close_claim_token is null
          and discord_ticket_close_claimed_at is null
          and discord_ticket_close_claimed_by_discord_user_id is null
        )
        or (
          discord_ticket_status <> 'closed'
          and discord_ticket_closed_at is null
          and discord_ticket_closed_by_discord_user_id is null
        )
      );
  end if;
end
$$;

comment on column public.orders.discord_ticket_close_claim_token is
  'Opaque five-minute lease token for one in-progress Discord channel close.';
comment on column public.orders.discord_ticket_close_claimed_at is
  'Timestamp at which the current Discord ticket close lease was acquired.';
comment on column public.orders.discord_ticket_close_claimed_by_discord_user_id is
  'Authorized Discord administrator holding the current ticket close lease.';
comment on column public.orders.discord_ticket_closed_at is
  'Timestamp at which the paid-order Discord ticket reached its terminal closed state.';
comment on column public.orders.discord_ticket_closed_by_discord_user_id is
  'Discord administrator that completed the ticket close; NULL only for legacy rows.';

create index if not exists orders_discord_ticket_close_reconciliation_idx
  on public.orders (discord_ticket_close_claimed_at, id)
  where discord_ticket_status = 'open'
    and discord_ticket_close_claim_token is not null
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
    ) then
    raise exception using
      errcode = '55000',
      message = 'A closed Discord ticket is terminal and immutable.';
  end if;

  return new;
end
$$;

comment on function private.prevent_closed_discord_ticket_mutation() is
  'Prevents any closed Discord ticket from being reopened or having its closure evidence rewritten.';

revoke all on function private.prevent_closed_discord_ticket_mutation()
  from public, anon, authenticated, service_role;

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
  discord_ticket_closed_by_discord_user_id
on public.orders
for each row execute function private.prevent_closed_discord_ticket_mutation();

create or replace function public.claim_discord_ticket_close(
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

  if p_closed_by_discord_user_id is null
    or p_closed_by_discord_user_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord ticket closer ID is invalid.';
  end if;

  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Discord ticket close claim token is required.';
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

  if not (p_closed_by_discord_user_id = any(v_authorized_discord_user_ids)) then
    raise exception using errcode = '42501', message = 'Discord user is not authorized to close tickets.';
  end if;

  if v_order.discord_ticket_status = 'closed' then
    return query select
      v_order.id,
      false,
      true,
      v_order.discord_ticket_status,
      v_order.discord_ticket_channel_id,
      null::uuid,
      null::timestamptz,
      v_order.discord_ticket_closed_at,
      v_order.discord_ticket_closed_by_discord_user_id;
    return;
  end if;

  if v_order.discord_ticket_status <> 'open' then
    raise exception using errcode = '22000', message = 'Discord ticket is not open.';
  end if;

  if v_order.discord_ticket_close_claim_token is not null
    and v_order.discord_ticket_close_claimed_at > v_now - interval '5 minutes' then
    if v_order.discord_ticket_close_claim_token = p_claim_token
      and v_order.discord_ticket_close_claimed_by_discord_user_id
        = p_closed_by_discord_user_id then
      return query select
        v_order.id,
        true,
        false,
        v_order.discord_ticket_status,
        v_order.discord_ticket_channel_id,
        v_order.discord_ticket_close_claim_token,
        v_order.discord_ticket_close_claimed_at + interval '5 minutes',
        null::timestamptz,
        null::text;
    else
      return query select
        v_order.id,
        false,
        false,
        v_order.discord_ticket_status,
        v_order.discord_ticket_channel_id,
        null::uuid,
        v_order.discord_ticket_close_claimed_at + interval '5 minutes',
        null::timestamptz,
        null::text;
    end if;
    return;
  end if;

  update public.orders
  set
    discord_ticket_close_claim_token = p_claim_token,
    discord_ticket_close_claimed_at = v_now,
    discord_ticket_close_claimed_by_discord_user_id = p_closed_by_discord_user_id
  where id = v_order.id
  returning * into v_order;

  return query select
    v_order.id,
    true,
    false,
    v_order.discord_ticket_status,
    v_order.discord_ticket_channel_id,
    v_order.discord_ticket_close_claim_token,
    v_order.discord_ticket_close_claimed_at + interval '5 minutes',
    null::timestamptz,
    null::text;
end
$$;

comment on function public.claim_discord_ticket_close(uuid, text, text, text, uuid) is
  'Authorizes and acquires an idempotent five-minute lease for closing one open paid-order Discord ticket.';

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
    raise exception using errcode = '22023', message = 'Discord ticket channel ID is invalid.';
  end if;

  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Discord ticket close claim token is required.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  if v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using errcode = '42501', message = 'Discord ticket channel does not match this order.';
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
    raise exception using errcode = '22000', message = 'Discord ticket is not open.';
  end if;

  if v_order.discord_ticket_close_claim_token is distinct from p_claim_token
    or v_order.discord_ticket_close_claimed_at is null
    or v_order.discord_ticket_close_claimed_by_discord_user_id is null then
    raise exception using errcode = '42501', message = 'Discord ticket close claim does not match.';
  end if;

  v_closed_by_discord_user_id := v_order.discord_ticket_close_claimed_by_discord_user_id;

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
      'source', 'discord_http_interaction'
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

comment on function public.complete_discord_ticket_close(uuid, text, uuid) is
  'Completes the currently stored close token even after lease expiry, enabling durable recovery while a takeover token still blocks stale workers.';

create or replace function public.release_discord_ticket_close(
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
declare
  v_order public.orders%rowtype;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Discord ticket close claim token is required.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  if v_order.discord_ticket_status = 'closed'
    or v_order.discord_ticket_close_claim_token is distinct from p_claim_token then
    return query select v_order.id, false, v_order.discord_ticket_status;
    return;
  end if;

  update public.orders
  set
    discord_ticket_close_claim_token = null,
    discord_ticket_close_claimed_at = null,
    discord_ticket_close_claimed_by_discord_user_id = null
  where id = v_order.id
  returning * into v_order;

  return query select v_order.id, true, v_order.discord_ticket_status;
end
$$;

comment on function public.release_discord_ticket_close(uuid, uuid) is
  'Releases only the Discord ticket close lease identified by the matching opaque token.';

-- Preserve the existing buyer/guild/channel/payment validation and audit
-- semantics while refusing nickname edits during a live close lease.
create or replace function public.submit_paid_order_game_nickname(
  p_order_id uuid,
  p_buyer_discord_id text,
  p_discord_guild_id text,
  p_ticket_channel_id text,
  p_game_nickname text
)
returns table (
  order_id uuid,
  game_nickname text,
  was_created boolean,
  was_changed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_discord_guild_id text;
  v_game_nickname text := btrim(p_game_nickname);
  v_was_created boolean;
  v_was_changed boolean;
begin
  if p_buyer_discord_id is null
    or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord buyer ID is invalid.';
  end if;

  if p_discord_guild_id is null
    or p_discord_guild_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord guild ID is invalid.';
  end if;

  if p_ticket_channel_id is null
    or p_ticket_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord ticket channel ID is invalid.';
  end if;

  if v_game_nickname is null
    or char_length(v_game_nickname) not between 2 and 64
    or v_game_nickname ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '22023',
      message = 'Game nickname is invalid.';
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

  if v_order.buyer_discord_id <> p_buyer_discord_id then
    raise exception using
      errcode = '42501',
      message = 'Discord buyer does not own this order.';
  end if;

  select guild.discord_guild_id
  into strict v_discord_guild_id
  from public.guilds as guild
  where guild.id = v_order.guild_id;

  if v_discord_guild_id <> p_discord_guild_id then
    raise exception using
      errcode = '42501',
      message = 'Discord guild does not match this order.';
  end if;

  if v_order.status not in ('paid', 'processing', 'delivered')
    or v_order.payment_status <> 'paid'
    or v_order.paid_at is null then
    raise exception using
      errcode = '22000',
      message = 'Order payment is not eligible for a game nickname.';
  end if;

  if v_order.discord_ticket_status <> 'open' then
    raise exception using
      errcode = '22000',
      message = 'Discord ticket is not open.';
  end if;

  if v_order.discord_ticket_channel_id is distinct from p_ticket_channel_id then
    raise exception using
      errcode = '42501',
      message = 'Discord ticket channel does not match this order.';
  end if;

  if v_order.discord_ticket_close_claim_token is not null
    and v_order.discord_ticket_close_claimed_at > statement_timestamp() - interval '5 minutes' then
    raise exception using
      errcode = '55000',
      message = 'Discord ticket is currently being closed.';
  end if;

  v_was_created := v_order.game_nickname is null;
  v_was_changed := v_order.game_nickname is distinct from v_game_nickname;

  if v_was_changed then
    update public.orders
    set
      game_nickname = v_game_nickname,
      game_nickname_submitted_at = now()
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
      p_buyer_discord_id,
      case
        when v_was_created then 'bot.order.game_nickname.set'
        else 'bot.order.game_nickname.update'
      end,
      'order',
      v_order.id,
      jsonb_build_object(
        'discord_ticket_channel_id', p_ticket_channel_id,
        'discord_guild_id', p_discord_guild_id,
        'source', 'discord_http_interaction'
      )
    );
  end if;

  return query
  select
    v_order.id,
    v_order.game_nickname,
    v_was_created,
    v_was_changed;
end
$$;

comment on function public.submit_paid_order_game_nickname(uuid, text, text, text, text) is
  'Validates the paid order buyer, guild and open ticket, blocks live close leases, then idempotently stores the buyer in-game nickname.';

revoke all on function public.claim_discord_ticket_close(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_discord_ticket_close(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.release_discord_ticket_close(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_paid_order_game_nickname(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_discord_ticket_close(uuid, text, text, text, uuid)
  to service_role;
grant execute on function public.complete_discord_ticket_close(uuid, text, uuid)
  to service_role;
grant execute on function public.release_discord_ticket_close(uuid, uuid)
  to service_role;
grant execute on function public.submit_paid_order_game_nickname(uuid, text, text, text, text)
  to service_role;

revoke insert, update, delete on table public.orders from public, anon, authenticated;
grant select on table public.platform_settings to service_role;

commit;
