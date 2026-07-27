-- Multi-item roulette sale and redemption.
-- A player picks several prizes at once instead of one button per unit. Selling
-- settles every line in a single transaction, and a redemption becomes a header
-- with item lines so the team gets one Discord ticket listing everything to
-- hand over instead of one channel per unit.
--
-- Output column names keep the rule from the 42702 incident: none may collide
-- with a column of a table the function touches — `redemption_id` is a column
-- of roulette_redemption_items, hence `created_redemption_id`.

begin;

set local lock_timeout = '5s';

create table public.roulette_redemption_items (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.roulette_redemptions (id) on delete cascade,
  prize_key text not null,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  value_cents bigint not null,
  quantity integer not null,
  created_at timestamptz not null default now(),
  constraint roulette_redemption_items_prize_key
    check (prize_key in ('premio_1', 'premio_2', 'premio_3', 'premio_4', 'premio_5')),
  constraint roulette_redemption_items_product_name_not_blank
    check (btrim(product_name) <> '' and char_length(product_name) <= 200),
  constraint roulette_redemption_items_value_not_negative check (value_cents >= 0),
  constraint roulette_redemption_items_quantity_positive check (quantity > 0)
);

create unique index roulette_redemption_items_prize_unique
  on public.roulette_redemption_items (redemption_id, prize_key);

create index roulette_redemption_items_redemption_idx
  on public.roulette_redemption_items (redemption_id);

alter table public.roulette_redemption_items enable row level security;
alter table public.roulette_redemption_items force row level security;

revoke all on table public.roulette_redemption_items
  from public, anon, authenticated, service_role;
grant select on table public.roulette_redemption_items to authenticated;
grant select, insert, update, delete on table public.roulette_redemption_items to service_role;

create policy roulette_redemption_items_admin_select
on public.roulette_redemption_items
for select
to authenticated
using (private.is_admin());

comment on table public.roulette_redemption_items is
  'Prizes bundled into one roulette redemption request.';

-- The single-prize columns move to the item lines. No redemption exists yet, so
-- there is nothing to backfill.
alter table public.roulette_redemptions
  drop column if exists prize_key,
  drop column if exists product_id,
  drop column if exists product_name,
  drop column if exists value_cents;

alter table public.roulette_redemptions
  add column if not exists item_count integer not null default 0,
  add column if not exists total_value_cents bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'roulette_redemptions_totals_not_negative'
      and conrelid = 'public.roulette_redemptions'::regclass
  ) then
    alter table public.roulette_redemptions
      add constraint roulette_redemptions_totals_not_negative
      check (item_count >= 0 and total_value_cents >= 0);
  end if;
end
$$;

drop function if exists public.sell_roulette_prize(text);
drop function if exists public.redeem_roulette_prize(text);
drop function if exists public.claim_roulette_redemption_ticket(uuid, uuid);
drop function if exists public.admin_settle_roulette_redemption(uuid, text);

-- Reads a `[{"prize_key":"premio_1","quantity":2}]` payload into rows, refusing
-- anything the wheel cannot award.
create function private.read_roulette_item_selection(p_items jsonb)
returns table (selected_prize_key text, selected_quantity integer)
language plpgsql
immutable
as $$
declare
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must be an array.';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_items);
  if v_count < 1 or v_count > 5 then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must hold 1 to 5 prizes.';
  end if;

  return query
  select
    entry.value ->> 'prize_key',
    (entry.value ->> 'quantity')::integer
  from jsonb_array_elements(p_items) as entry;
end;
$$;

create function public.sell_roulette_prizes(p_items jsonb)
returns table (
  sold_items jsonb,
  sold_item_count integer,
  sold_total_credited_cents bigint,
  coin_balance_cents bigint
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_sale_rate_bps integer;
  v_selection record;
  v_item public.roulette_demo_inventory%rowtype;
  v_value_cents bigint;
  v_credit_cents bigint;
  v_remaining integer;
  v_total_credit bigint := 0;
  v_total_units integer := 0;
  v_balance bigint;
  v_results jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('roulette_sale:' || v_auth_user_id::text));

  select settings.roulette_sale_rate_bps
  into v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;
  v_sale_rate_bps := coalesce(v_sale_rate_bps, 5000);

  for v_selection in
    select * from private.read_roulette_item_selection(p_items)
  loop
    if v_selection.selected_prize_key is null
      or v_selection.selected_quantity is null
      or v_selection.selected_quantity < 1 then
      raise exception using
        errcode = '22023',
        message = 'Roulette selection has an invalid line.';
    end if;
    if v_selection.selected_prize_key = any (v_seen) then
      raise exception using
        errcode = '22023',
        message = 'Roulette selection repeats a prize.';
    end if;
    v_seen := v_seen || v_selection.selected_prize_key;

    select item.*
    into v_item
    from public.roulette_demo_inventory as item
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_selection.selected_prize_key
    for update;

    if not found or v_item.quantity < v_selection.selected_quantity then
      raise exception using
        errcode = 'P0008',
        message = 'The prize is not in the inventory.';
    end if;

    select product.minimum_price_cents::bigint
    into v_value_cents
    from public.roulette_prize_products as slot
    join public.products as product on product.id = slot.product_id
    where slot.prize_key = v_item.prize_key
      and product.archived_at is null;

    if v_value_cents is null then
      raise exception using
        errcode = 'P0010',
        message = 'The prize no longer has a catalog price.';
    end if;

    v_credit_cents := ((v_value_cents * v_sale_rate_bps) / 10000) * v_selection.selected_quantity;
    if v_credit_cents <= 0 then
      raise exception using
        errcode = 'P0011',
        message = 'The prize is worth no coins.';
    end if;

    v_remaining := v_item.quantity - v_selection.selected_quantity;
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

    v_balance := private.move_roulette_coins(
      v_auth_user_id,
      v_item.discord_user_id,
      'sale',
      v_credit_cents,
      null,
      null,
      v_item.prize_key
    );

    v_total_credit := v_total_credit + v_credit_cents;
    v_total_units := v_total_units + v_selection.selected_quantity;
    v_results := v_results || jsonb_build_object(
      'prize_key', v_item.prize_key,
      'quantity', v_selection.selected_quantity,
      'remaining_quantity', v_remaining,
      'credited_cents', v_credit_cents
    );
  end loop;

  return query select v_results, v_total_units, v_total_credit, v_balance;
end;
$$;

create function public.redeem_roulette_prizes(p_items jsonb)
returns table (
  created_redemption_id uuid,
  redeemed_items jsonb,
  redeemed_item_count integer,
  redeemed_total_value_cents bigint
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_guild_id uuid;
  v_selection record;
  v_item public.roulette_demo_inventory%rowtype;
  v_product_id uuid;
  v_product_name text;
  v_value_cents bigint;
  v_remaining integer;
  v_total_units integer := 0;
  v_total_value bigint := 0;
  v_redemption_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
  v_discord_user_id text;
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('roulette_redeem:' || v_auth_user_id::text));

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

  insert into public.roulette_redemptions (
    auth_user_id,
    discord_user_id,
    guild_id
  )
  select
    v_auth_user_id,
    wallet.discord_user_id,
    v_guild_id
  from public.roulette_coin_balances as wallet
  where wallet.auth_user_id = v_auth_user_id
  returning id, discord_user_id into v_redemption_id, v_discord_user_id;

  if v_redemption_id is null then
    -- A player who never bought coins still has an inventory from admin spins.
    select item.discord_user_id
    into v_discord_user_id
    from public.roulette_demo_inventory as item
    where item.auth_user_id = v_auth_user_id
    limit 1;

    if v_discord_user_id is null then
      raise exception using
        errcode = 'P0008',
        message = 'The prize is not in the inventory.';
    end if;

    insert into public.roulette_redemptions (auth_user_id, discord_user_id, guild_id)
    values (v_auth_user_id, v_discord_user_id, v_guild_id)
    returning id into v_redemption_id;
  end if;

  for v_selection in
    select * from private.read_roulette_item_selection(p_items)
  loop
    if v_selection.selected_prize_key is null
      or v_selection.selected_quantity is null
      or v_selection.selected_quantity < 1 then
      raise exception using
        errcode = '22023',
        message = 'Roulette selection has an invalid line.';
    end if;
    if v_selection.selected_prize_key = any (v_seen) then
      raise exception using
        errcode = '22023',
        message = 'Roulette selection repeats a prize.';
    end if;
    v_seen := v_seen || v_selection.selected_prize_key;

    select item.*
    into v_item
    from public.roulette_demo_inventory as item
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_selection.selected_prize_key
    for update;

    if not found or v_item.quantity < v_selection.selected_quantity then
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

    v_remaining := v_item.quantity - v_selection.selected_quantity;
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

    insert into public.roulette_redemption_items (
      redemption_id,
      prize_key,
      product_id,
      product_name,
      value_cents,
      quantity
    )
    values (
      v_redemption_id,
      v_item.prize_key,
      v_product_id,
      v_product_name,
      v_value_cents,
      v_selection.selected_quantity
    );

    v_total_units := v_total_units + v_selection.selected_quantity;
    v_total_value := v_total_value + v_value_cents * v_selection.selected_quantity;
    v_results := v_results || jsonb_build_object(
      'prize_key', v_item.prize_key,
      'product_name', v_product_name,
      'quantity', v_selection.selected_quantity,
      'remaining_quantity', v_remaining,
      'value_cents', v_value_cents
    );
  end loop;

  update public.roulette_redemptions as redemption
  set item_count = v_total_units,
      total_value_cents = v_total_value
  where redemption.id = v_redemption_id;

  return query select v_redemption_id, v_results, v_total_units, v_total_value;
end;
$$;

create function public.claim_roulette_redemption_ticket(
  p_redemption_id uuid,
  p_claim_token uuid
)
returns table (
  claimed_redemption_id uuid,
  claim_succeeded boolean,
  claimed_guild_discord_id text,
  claimed_discord_user_id text,
  claimed_item_summary text,
  claimed_total_value_cents bigint,
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
  v_summary text;
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

  select string_agg(
    line.quantity || 'x ' || line.product_name,
    E'\n' order by line.prize_key
  )
  into v_summary
  from public.roulette_redemption_items as line
  where line.redemption_id = v_redemption.id;
  v_summary := coalesce(v_summary, 'Prêmio da roleta');

  if v_redemption.discord_ticket_status = 'open'
    or (
      v_redemption.discord_ticket_status = 'creating'
      and v_redemption.discord_ticket_claimed_at is not null
      and v_redemption.discord_ticket_claimed_at > v_now - interval '2 minutes'
    ) then
    return query
    select
      v_redemption.id,
      false,
      v_guild_discord_id,
      v_redemption.discord_user_id,
      v_summary,
      v_redemption.total_value_cents,
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
    v_summary,
    v_redemption.total_value_cents,
    v_redemption.discord_ticket_channel_id,
    v_redemption.discord_ticket_status;
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
  v_line record;
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

  -- A cancelled request puts every prize back in the player inventory.
  if p_status = 'cancelled' then
    for v_line in
      select line.prize_key, line.quantity
      from public.roulette_redemption_items as line
      where line.redemption_id = v_redemption.id
    loop
      insert into public.roulette_demo_inventory (
        auth_user_id,
        discord_user_id,
        prize_key,
        quantity
      )
      values (
        v_redemption.auth_user_id,
        v_redemption.discord_user_id,
        v_line.prize_key,
        v_line.quantity
      )
      on conflict (auth_user_id, prize_key)
      do update set
        quantity = public.roulette_demo_inventory.quantity + excluded.quantity;
    end loop;
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

revoke all on function private.read_roulette_item_selection(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.sell_roulette_prizes(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.redeem_roulette_prizes(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_roulette_redemption_ticket(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_settle_roulette_redemption(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.sell_roulette_prizes(jsonb) to authenticated, service_role;
grant execute on function public.redeem_roulette_prizes(jsonb) to authenticated, service_role;
grant execute on function public.admin_settle_roulette_redemption(uuid, text) to authenticated;
grant execute on function public.claim_roulette_redemption_ticket(uuid, uuid) to service_role;

comment on function public.sell_roulette_prizes(jsonb) is
  'Sells several inventory prizes at once for the configured share of their value.';
comment on function public.redeem_roulette_prizes(jsonb) is
  'Bundles several prizes into one redemption request and one delivery ticket.';

commit;
