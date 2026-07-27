-- Roulette prize redemption.
-- A player who wants the item instead of the coins asks for a redemption. The
-- prize leaves the roulette inventory, a row lands in the admin panel and a
-- private Discord ticket is opened so the team delivers it by hand, the same
-- way a paid order is delivered today.
--
-- Redemption deliberately does not reserve commerce stock: the roulette draws
-- prizes that the catalog may be out of at that moment, and the store already
-- fulfils manually inside the ticket. The admin panel shows the live stock next
-- to each request so the team knows what it can hand over.

begin;

set local lock_timeout = '5s';

create table public.roulette_redemptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  discord_user_id text not null,
  guild_id uuid not null references public.guilds (id) on delete restrict,
  prize_key text not null,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  value_cents bigint not null,
  status text not null default 'pending',
  discord_ticket_status text not null default 'pending',
  discord_ticket_channel_id text,
  discord_ticket_claim_token uuid,
  discord_ticket_claimed_at timestamptz,
  discord_ticket_error text,
  delivered_at timestamptz,
  delivered_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roulette_redemptions_discord_id_format
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  constraint roulette_redemptions_prize_key
    check (prize_key in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5')),
  constraint roulette_redemptions_product_name_not_blank
    check (btrim(product_name) <> '' and char_length(product_name) <= 200),
  constraint roulette_redemptions_value_not_negative check (value_cents >= 0),
  constraint roulette_redemptions_status
    check (status in ('pending', 'delivered', 'cancelled')),
  constraint roulette_redemptions_ticket_status
    check (discord_ticket_status in ('pending', 'creating', 'open', 'failed')),
  constraint roulette_redemptions_channel_format check (
    discord_ticket_channel_id is null or discord_ticket_channel_id ~ '^[0-9]{15,22}$'
  ),
  constraint roulette_redemptions_delivery_state check (
    (status = 'pending' and delivered_at is null)
    or (status = 'delivered' and delivered_at is not null)
    or (status = 'cancelled' and delivered_at is null)
  )
);

create unique index roulette_redemptions_channel_unique
  on public.roulette_redemptions (discord_ticket_channel_id)
  where discord_ticket_channel_id is not null;

create index roulette_redemptions_status_created_idx
  on public.roulette_redemptions (status, created_at desc);

create index roulette_redemptions_ticket_reconciliation_idx
  on public.roulette_redemptions (discord_ticket_status, discord_ticket_claimed_at, id);

create index roulette_redemptions_user_created_idx
  on public.roulette_redemptions (auth_user_id, created_at desc);

create trigger roulette_redemptions_set_updated_at
before update on public.roulette_redemptions
for each row execute function private.set_updated_at();

alter table public.roulette_redemptions enable row level security;
alter table public.roulette_redemptions force row level security;

revoke all on table public.roulette_redemptions
  from public, anon, authenticated, service_role;
grant select on table public.roulette_redemptions to authenticated;
grant select, insert, update, delete on table public.roulette_redemptions to service_role;

-- Administrators read every request in the panel; a player never reads the
-- table directly, the RPC returns what they need.
create policy roulette_redemptions_admin_select
on public.roulette_redemptions
for select
to authenticated
using (private.is_admin());

comment on table public.roulette_redemptions is
  'Roulette prizes a player asked to receive, delivered by hand in a Discord ticket.';

create function public.redeem_roulette_prize(p_prize_key text)
returns table (
  redemption_id uuid,
  redeemed_prize_key text,
  redeemed_product_name text,
  redeemed_value_cents bigint,
  remaining_quantity integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_item public.roulette_demo_inventory%rowtype;
  v_guild_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_value_cents bigint;
  v_remaining integer;
  v_redemption_id uuid;
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('roulette_redeem:' || v_auth_user_id::text));

  select item.*
  into v_item
  from public.roulette_demo_inventory as item
  where item.auth_user_id = v_auth_user_id
    and item.prize_key = p_prize_key
  for update;

  if not found then
    raise exception using
      errcode = 'P0008',
      message = 'The prize is not in the inventory.';
  end if;

  select product.id, product.name, product.minimum_price_cents::bigint
  into v_product_id, v_product_name, v_value_cents
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where slot.prize_key = v_item.prize_key
    and product.archived_at is null;

  if v_product_id is null then
    raise exception using
      errcode = 'P0010',
      message = 'The prize no longer has a catalog product.';
  end if;

  -- One active guild answers for the store today; the ticket is opened there.
  select guild.id
  into v_guild_id
  from public.guilds as guild
  where guild.status = 'active'
    and guild.archived_at is null
  order by guild.created_at
  limit 1;

  if v_guild_id is null then
    raise exception using
      errcode = 'P0012',
      message = 'No active Discord guild can host the redemption ticket.';
  end if;

  v_remaining := v_item.quantity - 1;
  if v_remaining > 0 then
    update public.roulette_demo_inventory as item
    set quantity = v_remaining
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_item.prize_key;
  else
    delete from public.roulette_demo_inventory as item
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_item.prize_key;
  end if;

  insert into public.roulette_redemptions (
    auth_user_id,
    discord_user_id,
    guild_id,
    prize_key,
    product_id,
    product_name,
    value_cents
  )
  values (
    v_auth_user_id,
    v_item.discord_user_id,
    v_guild_id,
    v_item.prize_key,
    v_product_id,
    v_product_name,
    v_value_cents
  )
  returning id into v_redemption_id;

  return query
  select v_redemption_id, v_item.prize_key, v_product_name, v_value_cents, v_remaining;
end;
$$;

-- Exactly-once lease so two workers never open two channels for one request.
create function public.claim_roulette_redemption_ticket(
  p_redemption_id uuid,
  p_claim_token uuid
)
returns table (
  claimed_redemption_id uuid,
  claim_succeeded boolean,
  claimed_guild_discord_id text,
  claimed_discord_user_id text,
  claimed_product_name text,
  claimed_value_cents bigint,
  claimed_channel_id text,
  claimed_ticket_status text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_redemption public.roulette_redemptions%rowtype;
  v_guild_discord_id text;
  v_now timestamptz := clock_timestamp();
begin
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

  select guild.discord_guild_id
  into strict v_guild_discord_id
  from public.guilds as guild
  where guild.id = v_redemption.guild_id;

  if v_redemption.discord_ticket_status = 'open' then
    return query
    select
      v_redemption.id,
      false,
      v_guild_discord_id,
      v_redemption.discord_user_id,
      v_redemption.product_name,
      v_redemption.value_cents,
      v_redemption.discord_ticket_channel_id,
      v_redemption.discord_ticket_status;
    return;
  end if;

  -- A lease younger than two minutes still belongs to the worker that took it.
  if v_redemption.discord_ticket_status = 'creating'
    and v_redemption.discord_ticket_claimed_at is not null
    and v_redemption.discord_ticket_claimed_at > v_now - interval '2 minutes' then
    return query
    select
      v_redemption.id,
      false,
      v_guild_discord_id,
      v_redemption.discord_user_id,
      v_redemption.product_name,
      v_redemption.value_cents,
      v_redemption.discord_ticket_channel_id,
      v_redemption.discord_ticket_status;
    return;
  end if;

  update public.roulette_redemptions as redemption
  set
    discord_ticket_status = 'creating',
    discord_ticket_claim_token = p_claim_token,
    discord_ticket_claimed_at = v_now,
    discord_ticket_error = null
  where redemption.id = v_redemption.id
  returning * into v_redemption;

  return query
  select
    v_redemption.id,
    true,
    v_guild_discord_id,
    v_redemption.discord_user_id,
    v_redemption.product_name,
    v_redemption.value_cents,
    v_redemption.discord_ticket_channel_id,
    v_redemption.discord_ticket_status;
end;
$$;

create function public.complete_roulette_redemption_ticket(
  p_redemption_id uuid,
  p_channel_id text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  if p_channel_id is null or p_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord channel ID is invalid.';
  end if;

  update public.roulette_redemptions as redemption
  set
    discord_ticket_status = 'open',
    discord_ticket_channel_id = p_channel_id,
    discord_ticket_claim_token = null,
    discord_ticket_error = null
  where redemption.id = p_redemption_id;
end;
$$;

create function public.fail_roulette_redemption_ticket(
  p_redemption_id uuid,
  p_error text
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  update public.roulette_redemptions as redemption
  set
    discord_ticket_status = 'failed',
    discord_ticket_claim_token = null,
    discord_ticket_claimed_at = null,
    discord_ticket_error = left(coalesce(p_error, 'Falha ao abrir o ticket.'), 500)
  where redemption.id = p_redemption_id
    and redemption.discord_ticket_status <> 'open';
end;
$$;

create function public.admin_settle_roulette_redemption(
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
declare
  v_admin_id uuid := auth.uid();
  v_redemption public.roulette_redemptions%rowtype;
begin
  if v_admin_id is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;
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
  if v_redemption.status <> 'pending' then
    raise exception using
      errcode = 'P0013',
      message = 'Roulette redemption was already settled.';
  end if;

  -- A cancelled request puts the prize back in the player inventory.
  if p_status = 'cancelled' then
    insert into public.roulette_demo_inventory (
      auth_user_id,
      discord_user_id,
      prize_key,
      quantity
    )
    values (
      v_redemption.auth_user_id,
      v_redemption.discord_user_id,
      v_redemption.prize_key,
      1
    )
    on conflict (auth_user_id, prize_key)
    do update set quantity = public.roulette_demo_inventory.quantity + 1;
  end if;

  update public.roulette_redemptions as redemption
  set
    status = p_status,
    delivered_at = case when p_status = 'delivered' then clock_timestamp() else null end,
    delivered_by = v_admin_id
  where redemption.id = v_redemption.id
  returning * into v_redemption;

  return query select v_redemption.id, v_redemption.status;
end;
$$;

revoke all on function public.redeem_roulette_prize(text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_roulette_redemption_ticket(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_roulette_redemption_ticket(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_roulette_redemption_ticket(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_settle_roulette_redemption(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.redeem_roulette_prize(text) to authenticated, service_role;
grant execute on function public.admin_settle_roulette_redemption(uuid, text) to authenticated;
grant execute on function public.claim_roulette_redemption_ticket(uuid, uuid) to service_role;
grant execute on function public.complete_roulette_redemption_ticket(uuid, text) to service_role;
grant execute on function public.fail_roulette_redemption_ticket(uuid, text) to service_role;

comment on function public.redeem_roulette_prize(text) is
  'Takes one prize out of the roulette inventory and queues it for hand delivery.';
comment on function public.admin_settle_roulette_redemption(uuid, text) is
  'Marks a redemption delivered, or cancels it and returns the prize to the player.';

commit;
