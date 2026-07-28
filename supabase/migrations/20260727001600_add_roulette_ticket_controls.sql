-- Give the roulette redemption ticket the same two controls a paid order has:
-- the player states their in-game nick, and an administrator concludes the
-- delivery without leaving Discord.
--
-- Neither could be wired to the existing handlers. admin_settle_roulette_
-- redemption is security definer on auth.uid() + private.is_admin() and is
-- granted to authenticated only, so the webhook — which runs as service_role
-- with no JWT — raises 42501 the moment it calls it. And the redemption had
-- nowhere to store a nick.
--
-- The settlement body moves into private.settle_roulette_redemption so the
-- panel and the Discord button share one implementation: the stock decrement,
-- the inventory restore on cancel and the audit attribution cannot drift apart.

begin;

set local lock_timeout = '5s';

alter table public.roulette_redemptions
  add column if not exists game_nickname text,
  add column if not exists game_nickname_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'roulette_redemptions_game_nickname_length'
      and conrelid = 'public.roulette_redemptions'::regclass
  ) then
    alter table public.roulette_redemptions
      add constraint roulette_redemptions_game_nickname_length
      check (
        game_nickname is null
        or char_length(game_nickname) between 2 and 64
      );
  end if;
end
$$;

comment on column public.roulette_redemptions.game_nickname is
  'In-game name the player typed in the ticket, so the team knows who to deliver to.';

/**
 * The one place a redemption is settled. Delivering takes the units out of the
 * catalog; cancelling gives the prize back to the player. p_admin_auth_user_id
 * is the administrator answering for it — the panel passes auth.uid(), the
 * Discord button passes the profile it resolved from the pressing user.
 */
create or replace function private.settle_roulette_redemption(
  p_redemption_id uuid,
  p_status text,
  p_admin_auth_user_id uuid
)
returns table (settled_redemption_id uuid, settled_status text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_redemption public.roulette_redemptions%rowtype;
  v_line record;
begin
  if p_status not in ('delivered', 'cancelled') then
    raise exception using
      errcode = '22023',
      message = 'Redemption status is invalid.';
  end if;

  select redemption.*
  into v_redemption
  from public.roulette_redemptions as redemption
  where redemption.id = p_redemption_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette redemption was not found.';
  end if;
  -- The admin panel matches P0013 to tell the operator it was already settled.
  if v_redemption.status <> 'pending' then
    raise exception using
      errcode = 'P0013',
      message = 'Roulette redemption was already settled.';
  end if;

  if p_status = 'cancelled' then
    for v_line in
      select line.prize_key, line.product_id, line.value_cents, line.quantity
      from public.roulette_redemption_items as line
      where line.redemption_id = v_redemption.id
      order by line.product_id
    loop
      insert into public.roulette_demo_inventory (
        auth_user_id,
        discord_user_id,
        prize_key,
        product_id,
        unit_value_cents,
        quantity
      )
      values (
        v_redemption.auth_user_id,
        v_redemption.discord_user_id,
        v_line.prize_key,
        v_line.product_id,
        v_line.value_cents,
        v_line.quantity
      )
      on conflict (auth_user_id, prize_key)
      do update set
        quantity = public.roulette_demo_inventory.quantity + excluded.quantity;
    end loop;
  end if;

  if p_status = 'delivered' then
    for v_line in
      select line.product_id, line.product_name, sum(line.quantity) as quantity
      from public.roulette_redemption_items as line
      where line.redemption_id = v_redemption.id
      group by line.product_id, line.product_name
      order by line.product_id
    loop
      update public.products as product
      set stock_quantity = product.stock_quantity - v_line.quantity
      where product.id = v_line.product_id
        and product.stock_quantity >= v_line.quantity;

      if not found then
        raise exception using
          errcode = 'P0016',
          message = format(
            '%s no longer has %s unit(s) in stock.', v_line.product_name, v_line.quantity
          );
      end if;
    end loop;
  end if;

  update public.roulette_redemptions as redemption
  set
    status = p_status,
    delivered_at = case when p_status = 'delivered' then clock_timestamp() else null end,
    delivered_by = p_admin_auth_user_id
  where redemption.id = v_redemption.id
  returning * into v_redemption;

  return query select v_redemption.id, v_redemption.status;
end;
$$;

revoke all on function private.settle_roulette_redemption(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.admin_settle_roulette_redemption(
  p_redemption_id uuid,
  p_status text
)
returns table (
  settled_redemption_id uuid,
  settled_status text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  return query
  select * from private.settle_roulette_redemption(p_redemption_id, p_status, auth.uid());
end;
$$;

revoke all on function public.admin_settle_roulette_redemption(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_settle_roulette_redemption(uuid, text) to authenticated;

/**
 * The Discord button. The bot has no JWT, so the pressing user's Discord id is
 * the credential: it has to match an active administrative profile, and the
 * ticket it was pressed in has to be the ticket of that redemption.
 */
create or replace function public.complete_roulette_redemption_discord_delivery(
  p_redemption_id uuid,
  p_admin_discord_id text,
  p_channel_id text
)
returns table (
  settled_redemption_id uuid,
  settled_status text,
  player_discord_id text,
  item_summary text,
  delivered_nickname text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_admin_auth_user_id uuid;
  v_redemption public.roulette_redemptions%rowtype;
  v_summary text;
  v_settled record;
begin
  if p_redemption_id is null or p_admin_discord_id is null or p_channel_id is null then
    raise exception using
      errcode = '22023',
      message = 'The redemption, the administrator and the channel are all required.';
  end if;

  select profile.auth_user_id
  into v_admin_auth_user_id
  from public.admin_profiles as profile
  where profile.discord_user_id = p_admin_discord_id
    and profile.is_active;

  if v_admin_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  select redemption.*
  into v_redemption
  from public.roulette_redemptions as redemption
  where redemption.id = p_redemption_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette redemption was not found.';
  end if;

  -- A button can only settle the ticket it lives in.
  if v_redemption.discord_ticket_channel_id is distinct from p_channel_id then
    raise exception using
      errcode = 'P0017',
      message = 'The button does not belong to this redemption ticket.';
  end if;

  select string_agg(
    format('%sx %s', line.quantity, line.product_name),
    E'\n'
    order by line.product_name
  )
  into v_summary
  from public.roulette_redemption_items as line
  where line.redemption_id = v_redemption.id;

  select * into v_settled
  from private.settle_roulette_redemption(p_redemption_id, 'delivered', v_admin_auth_user_id);

  return query
  select
    v_settled.settled_redemption_id,
    v_settled.settled_status,
    v_redemption.discord_user_id,
    coalesce(v_summary, 'Prêmio da roleta'),
    v_redemption.game_nickname;
end;
$$;

revoke all on function public.complete_roulette_redemption_discord_delivery(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_roulette_redemption_discord_delivery(uuid, text, text)
  to service_role;

/**
 * The nick the player types in the ticket. Only the player who owns the
 * redemption may set it, and only while the prize has not been handed over.
 */
create or replace function public.submit_roulette_redemption_nickname(
  p_redemption_id uuid,
  p_player_discord_id text,
  p_nickname text
)
returns table (
  updated_redemption_id uuid,
  updated_nickname text,
  updated_player_discord_id text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_nickname text := btrim(p_nickname);
  v_redemption public.roulette_redemptions%rowtype;
begin
  -- A null would compare as null and fall through every check below, clearing
  -- the name the player had already given.
  if p_redemption_id is null or p_player_discord_id is null or v_nickname is null then
    raise exception using
      errcode = '22023',
      message = 'The redemption, the player and the name are all required.';
  end if;

  if char_length(v_nickname) < 2 or char_length(v_nickname) > 64 then
    raise exception using
      errcode = '22023',
      message = 'The in-game name has an invalid length.';
  end if;

  select redemption.*
  into v_redemption
  from public.roulette_redemptions as redemption
  where redemption.id = p_redemption_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette redemption was not found.';
  end if;

  if v_redemption.discord_user_id is distinct from p_player_discord_id then
    raise exception using
      errcode = '42501',
      message = 'Only the player who redeemed may state the in-game name.';
  end if;

  if v_redemption.status <> 'pending' then
    raise exception using
      errcode = 'P0013',
      message = 'Roulette redemption was already settled.';
  end if;

  update public.roulette_redemptions as redemption
  set game_nickname = v_nickname,
      game_nickname_at = clock_timestamp()
  where redemption.id = v_redemption.id
  returning * into v_redemption;

  return query
  select v_redemption.id, v_redemption.game_nickname, v_redemption.discord_user_id;
end;
$$;

revoke all on function public.submit_roulette_redemption_nickname(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_roulette_redemption_nickname(uuid, text, text)
  to service_role;

comment on function public.complete_roulette_redemption_discord_delivery(uuid, text, text) is
  'Settles a redemption as delivered from its Discord ticket, authorizing by the pressing administrator Discord id.';
comment on function public.submit_roulette_redemption_nickname(uuid, text, text) is
  'Records the in-game name the player typed in their own redemption ticket.';

commit;
