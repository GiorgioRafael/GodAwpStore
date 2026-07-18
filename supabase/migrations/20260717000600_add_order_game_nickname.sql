-- Store the buyer's in-game nickname only after a paid Discord ticket is open.

begin;

set local lock_timeout = '5s';

alter table public.orders
  add column if not exists game_nickname text,
  add column if not exists game_nickname_submitted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_game_nickname_trimmed'
  ) then
    alter table public.orders
      add constraint orders_game_nickname_trimmed
      check (game_nickname is null or game_nickname = btrim(game_nickname));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_game_nickname_length'
  ) then
    alter table public.orders
      add constraint orders_game_nickname_length
      check (
        game_nickname is null
        or char_length(game_nickname) between 2 and 64
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_game_nickname_no_control_characters'
  ) then
    alter table public.orders
      add constraint orders_game_nickname_no_control_characters
      check (game_nickname is null or game_nickname !~ '[[:cntrl:]]');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_game_nickname_submission_state'
  ) then
    alter table public.orders
      add constraint orders_game_nickname_submission_state
      check (
        (game_nickname is null and game_nickname_submitted_at is null)
        or
        (game_nickname is not null and game_nickname_submitted_at is not null)
      );
  end if;
end
$$;

comment on column public.orders.game_nickname is
  'Buyer-provided in-game nickname collected inside the paid order Discord ticket.';
comment on column public.orders.game_nickname_submitted_at is
  'Timestamp of the latest effective in-game nickname submission.';

drop function if exists public.submit_paid_order_game_nickname(uuid, text, text, text, text);

create function public.submit_paid_order_game_nickname(
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
  'Validates the paid order buyer, guild and open ticket, then idempotently stores the buyer in-game nickname.';

revoke all on function public.submit_paid_order_game_nickname(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_paid_order_game_nickname(uuid, text, text, text, text)
  to service_role;

commit;
