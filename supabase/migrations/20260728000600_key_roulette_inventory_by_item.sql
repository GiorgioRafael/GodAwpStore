-- A player owns an item, not a slice of the wheel.
--
-- The inventory was keyed (auth_user_id, prize_key), so a player could hold
-- exactly one row per slice and the row's identity was the slice. That is why
-- repointing a held slice had to be refused: there was nowhere for the old item
-- and the new one to coexist, and the two `on conflict` clauses that add units
-- would have merged them — a prize won as one product silently becoming
-- another, with no event and no way back.
--
-- The row is keyed by what it actually is now: who owns it, which slice it came
-- from, which product it is, and what it was worth when it was won. Winning the
-- same item again adds to the same row; winning a different item on the same
-- slice opens a second row.
--
-- The other half is that the player could not SEE what they own: the inventory
-- RPC returned only prize_key and quantity, so the page had to re-resolve the
-- name, the image and the price from whatever the slice points at today. The
-- server already paid and delivered the frozen product — the screen was the
-- only liar. It now receives the frozen identity and shows that.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- The row gets its own identity.
-- ---------------------------------------------------------------------------

alter table public.roulette_demo_inventory
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.roulette_demo_inventory
  drop constraint roulette_demo_inventory_pkey;

alter table public.roulette_demo_inventory
  add constraint roulette_demo_inventory_pkey primary key (id);

-- Same owner, same slice, same product, same frozen price: one row, units add
-- up. Anything else is a different thing to own. Leading with auth_user_id
-- keeps the owner lookup the old primary key served.
create unique index roulette_demo_inventory_identity_idx
  on public.roulette_demo_inventory (auth_user_id, prize_key, product_id, unit_value_cents);

comment on column public.roulette_demo_inventory.id is
  'The unit''s own identity. The slot is where it came from, not what it is.';

-- ---------------------------------------------------------------------------
-- The spin hands back what it froze, so the page never has to guess.
-- ---------------------------------------------------------------------------

drop function if exists private.record_roulette_spin(uuid, text, text, timestamptz);

create function private.record_roulette_spin(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_display_name text,
  p_spun_at timestamptz
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  won_product_id uuid,
  won_unit_value_cents bigint,
  won_unit_sale_value_cents bigint,
  inventory_quantity integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_prize_key text;
  v_spin_id uuid;
  v_inventory_quantity integer;
  v_product_id uuid;
  v_product_name text;
  v_product_image_url text;
  v_value_cents bigint;
  v_top_value_cents bigint;
  v_sale_rate_bps integer;
begin
  if not exists (
    select 1
    from public.roulette_prize_products as slot
    join public.products as product on product.id = slot.product_id
    where product.archived_at is null
  ) then
    raise exception using
      errcode = 'P0009',
      message = 'The roulette has no prize configured.';
  end if;

  -- Weighted draw over the live slots: the exponential race picks each slot
  -- with probability proportional to its draw_weight in a single pass.
  select slot.prize_key
  into v_prize_key
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null
  order by -ln(greatest(random(), 1e-12)) / slot.draw_weight
  limit 1;

  select product.id, product.name, product.image_url, product.minimum_price_cents::bigint
  into v_product_id, v_product_name, v_product_image_url, v_value_cents
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where slot.prize_key = v_prize_key;

  insert into public.roulette_demo_spins (
    auth_user_id,
    discord_user_id,
    prize_key,
    prize_value_cents,
    created_at
  )
  values (
    p_auth_user_id,
    p_discord_user_id,
    v_prize_key,
    coalesce(v_value_cents, 0),
    p_spun_at
  )
  returning id into v_spin_id;

  insert into public.roulette_demo_inventory (
    auth_user_id,
    discord_user_id,
    prize_key,
    product_id,
    unit_value_cents,
    quantity,
    created_at,
    updated_at
  )
  values (
    p_auth_user_id,
    p_discord_user_id,
    v_prize_key,
    v_product_id,
    coalesce(v_value_cents, 0),
    1,
    p_spun_at,
    p_spun_at
  )
  -- Keyed by the item, so a slice repointed between two spins opens a second
  -- row instead of turning the first win into the second one.
  on conflict (auth_user_id, prize_key, product_id, unit_value_cents)
  do update set
    discord_user_id = excluded.discord_user_id,
    quantity = public.roulette_demo_inventory.quantity + 1,
    updated_at = excluded.updated_at
  returning quantity into v_inventory_quantity;

  select max(product.minimum_price_cents)::bigint
  into v_top_value_cents
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  insert into public.roulette_overlay_events (
    prize_key,
    product_name,
    product_image_url,
    value_cents,
    masked_display_name,
    is_top_prize,
    created_at
  )
  values (
    v_prize_key,
    coalesce(v_product_name, 'Prêmio da roleta'),
    v_product_image_url,
    coalesce(v_value_cents, 0),
    private.mask_display_name(p_display_name),
    coalesce(v_value_cents, 0) >= coalesce(v_top_value_cents, 0)
      and coalesce(v_top_value_cents, 0) > 0,
    p_spun_at
  );

  -- The overlay only ever replays the last minutes, so the feed stays small.
  delete from public.roulette_overlay_events as stale
  where stale.created_at < p_spun_at - interval '1 hour';

  select settings.roulette_sale_rate_bps
  into v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;

  return query
  select
    v_spin_id,
    v_prize_key,
    v_product_id,
    coalesce(v_value_cents, 0),
    -- The very function the sale pays with, so the card the player just won
    -- quotes the number they will actually be credited.
    private.roulette_sale_credit(coalesce(v_value_cents, 0), coalesce(v_sale_rate_bps, 5000)),
    v_inventory_quantity;
end;
$$;

revoke all on function private.record_roulette_spin(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

drop function if exists public.spin_roulette(text, text);

create function public.spin_roulette(
  p_discord_user_id text,
  p_display_name text
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  won_product_id uuid,
  won_unit_value_cents bigint,
  won_unit_sale_value_cents bigint,
  won_inventory_quantity integer,
  coin_balance_cents bigint,
  spun_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_enabled boolean;
  v_spin record;
  v_balance bigint;
  v_spun_at timestamptz := clock_timestamp();
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord user ID is invalid.';
  end if;

  -- The kill switch. Inventories, redemptions and balances stay exactly as they
  -- are; only new spins stop.
  select settings.roulette_enabled
  into v_enabled
  from public.platform_settings as settings
  where settings.id = 1;

  if not coalesce(v_enabled, true) then
    raise exception using
      errcode = 'P0020',
      message = 'The roulette is paused.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_auth_user_id::text));
  if exists (
    select 1
    from public.roulette_demo_spins as recent
    where recent.auth_user_id = v_auth_user_id
      and recent.created_at > v_spun_at - interval '2 seconds'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Wait for the current spin to finish.';
  end if;

  if private.roulette_coin_balance(v_auth_user_id) < 100 then
    raise exception using
      errcode = 'P0007',
      message = 'Not enough roulette coins.';
  end if;

  select * into v_spin
  from private.record_roulette_spin(
    v_auth_user_id,
    p_discord_user_id,
    p_display_name,
    v_spun_at
  );

  v_balance := private.move_roulette_coins(
    v_auth_user_id,
    p_discord_user_id,
    'spin',
    -100,
    null,
    v_spin.recorded_spin_id,
    v_spin.won_prize_key
  );

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.won_product_id,
    v_spin.won_unit_value_cents,
    v_spin.won_unit_sale_value_cents,
    v_spin.inventory_quantity,
    v_balance,
    v_spun_at;
end;
$$;

revoke all on function public.spin_roulette(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.spin_roulette(text, text) to authenticated;

drop function if exists public.spin_roulette_as_admin(uuid, text, text);

create function public.spin_roulette_as_admin(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_display_name text
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  won_product_id uuid,
  won_unit_value_cents bigint,
  won_unit_sale_value_cents bigint,
  won_inventory_quantity integer,
  coin_balance_cents bigint,
  spun_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_spin record;
  v_spun_at timestamptz := clock_timestamp();
begin
  if p_auth_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'Auth user ID is required.';
  end if;
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord user ID is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_auth_user_id::text));
  if exists (
    select 1
    from public.roulette_demo_spins as recent
    where recent.auth_user_id = p_auth_user_id
      and recent.created_at > v_spun_at - interval '2 seconds'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Wait for the current spin to finish.';
  end if;

  select * into v_spin
  from private.record_roulette_spin(
    p_auth_user_id,
    p_discord_user_id,
    p_display_name,
    v_spun_at
  );

  return query
  select
    v_spin.recorded_spin_id,
    v_spin.won_prize_key,
    v_spin.won_product_id,
    v_spin.won_unit_value_cents,
    v_spin.won_unit_sale_value_cents,
    v_spin.inventory_quantity,
    private.roulette_coin_balance(p_auth_user_id),
    v_spun_at;
end;
$$;

revoke all on function public.spin_roulette_as_admin(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.spin_roulette_as_admin(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The selection addresses the item, not the slice.
-- ---------------------------------------------------------------------------

drop function if exists private.read_roulette_item_selection(jsonb);

/**
 * Reads the prize selection a player sent. A line names the item — which slice
 * it came from, which product it is, what it was worth — because a slice can
 * now hold more than one thing a player owns, and "sell premio_3" would be
 * ambiguous between them.
 *
 * The cap is per line, not per slice: ten slices can carry more than ten
 * distinct items once the wheel has been rebalanced a few times.
 */
create function private.read_roulette_item_selection(p_items jsonb)
returns table (
  selected_prize_key text,
  selected_product_id uuid,
  selected_unit_value_cents bigint,
  selected_quantity integer
)
language plpgsql
immutable
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must be an array.';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_items);
  if v_count < 1 or v_count > 50 then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection must hold 1 to 50 prizes.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry
    where entry.value ->> 'prize_key' is null
      or entry.value ->> 'prize_key' !~ '^premio_[1-9][0-9]?$'
      or entry.value ->> 'product_id' is null
      or entry.value ->> 'product_id'
         !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (entry.value ->> 'unit_value_cents') is null
      or (entry.value ->> 'unit_value_cents') !~ '^[0-9]+$'
      or (entry.value ->> 'unit_value_cents')::bigint > 100000000
      or (entry.value ->> 'quantity') is null
      or (entry.value ->> 'quantity') !~ '^[0-9]+$'
      or (entry.value ->> 'quantity')::bigint < 1
      or (entry.value ->> 'quantity')::bigint > 10000
  ) then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection has an invalid line.';
  end if;

  select count(distinct (
    (entry.value ->> 'prize_key')
    || ':' || (entry.value ->> 'product_id')
    || ':' || (entry.value ->> 'unit_value_cents')
  ))
  into v_distinct
  from jsonb_array_elements(p_items) as entry;

  if v_distinct <> v_count then
    raise exception using
      errcode = '22023',
      message = 'Roulette selection repeats a prize.';
  end if;

  return query
  select
    entry.value ->> 'prize_key',
    (entry.value ->> 'product_id')::uuid,
    (entry.value ->> 'unit_value_cents')::bigint,
    (entry.value ->> 'quantity')::integer
  from jsonb_array_elements(p_items) as entry;
end;
$$;

revoke all on function private.read_roulette_item_selection(jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Selling addresses the row it means.
-- ---------------------------------------------------------------------------

create or replace function public.sell_roulette_prizes(p_items jsonb)
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
    select item.*
    into v_item
    from public.roulette_demo_inventory as item
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_selection.selected_prize_key
      and item.product_id = v_selection.selected_product_id
      and item.unit_value_cents = v_selection.selected_unit_value_cents
    for update;

    if not found or v_item.quantity < v_selection.selected_quantity then
      raise exception using
        errcode = 'P0008',
        message = 'The prize is not in the inventory.';
    end if;

    -- The price the unit was won at. Rows created before the freeze fall back
    -- to the catalog once, and only if they never captured a value.
    v_value_cents := nullif(v_item.unit_value_cents, 0);
    if v_value_cents is null then
      select product.minimum_price_cents::bigint
      into v_value_cents
      from public.products as product
      where product.id = v_item.product_id;
    end if;

    if v_value_cents is null then
      raise exception using
        errcode = 'P0010',
        message = 'The prize no longer has a catalog price.';
    end if;

    v_credit_cents :=
      private.roulette_sale_credit(v_value_cents, v_sale_rate_bps)
      * v_selection.selected_quantity;
    if v_credit_cents <= 0 then
      raise exception using
        errcode = 'P0011',
        message = 'The prize is worth no coins.';
    end if;

    v_remaining := v_item.quantity - v_selection.selected_quantity;
    if v_remaining > 0 then
      update public.roulette_demo_inventory as item
      set quantity = v_remaining
      where item.id = v_item.id;
    else
      delete from public.roulette_demo_inventory as item
      where item.id = v_item.id;
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
      'product_id', v_item.product_id,
      'unit_value_cents', v_item.unit_value_cents,
      'quantity', v_selection.selected_quantity,
      'remaining_quantity', v_remaining,
      'credited_cents', v_credit_cents
    );
  end loop;

  return query select v_results, v_total_units, v_total_credit, v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeeming reserves stock for the product the player actually owns.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_roulette_prizes(p_items jsonb)
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
  v_auth_user_id uuid;
  v_guild_id uuid;
  v_selection record;
  v_need record;
  v_item public.roulette_demo_inventory%rowtype;
  v_product record;
  v_value_cents bigint;
  v_remaining integer;
  v_total_units integer := 0;
  v_total_value bigint := 0;
  v_redemption_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_discord_user_id text;
begin
  v_auth_user_id := auth.uid();
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('roulette_redeem:' || v_auth_user_id::text));

  -- Pass one validates the whole request before anything moves. Stock is
  -- checked per product against the SUM of the lines that want it, because two
  -- lines of the same product at different frozen prices are two rows now, and
  -- checking them one at a time would let the pair oversell. Products are read
  -- in a fixed order so concurrent redemptions queue instead of deadlocking.
  for v_need in
    select item.product_id as product_id, sum(selection.selected_quantity)::bigint as quantity
    from private.read_roulette_item_selection(p_items) as selection
    join public.roulette_demo_inventory as item
      on item.auth_user_id = v_auth_user_id
      and item.prize_key = selection.selected_prize_key
      and item.product_id = selection.selected_product_id
      and item.unit_value_cents = selection.selected_unit_value_cents
    group by item.product_id
    order by item.product_id
  loop
    select product.id, product.name, product.stock_quantity, product.archived_at
    into v_product
    from public.products as product
    where product.id = v_need.product_id
    for update;

    if not found or v_product.archived_at is not null then
      raise exception using
        errcode = 'P0010',
        message = 'The prize no longer has a catalog product.';
    end if;

    if v_product.stock_quantity < v_need.quantity then
      raise exception using
        errcode = 'P0016',
        message = format(
          '%s has %s unit(s) in stock and %s were requested.',
          v_product.name, v_product.stock_quantity, v_need.quantity
        );
    end if;
  end loop;

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

  -- Pass two moves the prizes and takes the units out of the catalog.
  for v_selection in
    select * from private.read_roulette_item_selection(p_items)
  loop
    select item.*
    into v_item
    from public.roulette_demo_inventory as item
    where item.auth_user_id = v_auth_user_id
      and item.prize_key = v_selection.selected_prize_key
      and item.product_id = v_selection.selected_product_id
      and item.unit_value_cents = v_selection.selected_unit_value_cents
    for update;

    if not found or v_item.quantity < v_selection.selected_quantity then
      raise exception using
        errcode = 'P0008',
        message = 'The prize is not in the inventory.';
    end if;

    -- The ticket promises the product the player actually won, priced as it was
    -- won, never whatever the slot happens to point at today.
    select product.id, product.name
    into v_product
    from public.products as product
    where product.id = v_item.product_id;

    if v_product.id is null then
      raise exception using
        errcode = 'P0010',
        message = 'The prize no longer has a catalog product.';
    end if;

    v_value_cents := coalesce(nullif(v_item.unit_value_cents, 0), 0);

    v_remaining := v_item.quantity - v_selection.selected_quantity;
    if v_remaining > 0 then
      update public.roulette_demo_inventory as item
      set quantity = v_remaining
      where item.id = v_item.id;
    else
      delete from public.roulette_demo_inventory as item
      where item.id = v_item.id;
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
      v_item.product_id,
      v_product.name,
      v_value_cents,
      v_selection.selected_quantity
    );

    v_total_units := v_total_units + v_selection.selected_quantity;
    v_total_value := v_total_value + v_value_cents * v_selection.selected_quantity;
    v_results := v_results || jsonb_build_object(
      'prize_key', v_item.prize_key,
      'product_id', v_item.product_id,
      'unit_value_cents', v_item.unit_value_cents,
      'product_name', v_product.name,
      'quantity', v_selection.selected_quantity,
      'remaining_quantity', v_remaining,
      'value_cents', v_value_cents
    );
  end loop;

  update public.roulette_redemptions as redemption
  set
    item_count = v_total_units,
    total_value_cents = v_total_value
  where redemption.id = v_redemption_id;

  return query select v_redemption_id, v_results, v_total_units, v_total_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelling puts the units back on the row they left.
-- ---------------------------------------------------------------------------

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
      message = 'A roulette redemption is either delivered or cancelled.';
  end if;

  select redemption.*
  into v_redemption
  from public.roulette_redemptions as redemption
  where redemption.id = p_redemption_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0017',
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
      select line.prize_key, line.product_id, line.value_cents, sum(line.quantity) as quantity
      from public.roulette_redemption_items as line
      where line.redemption_id = v_redemption.id
      group by line.prize_key, line.product_id, line.value_cents
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
      -- Back onto the row it is, which may no longer be the row the slot points
      -- at: the wheel is free to move while a redemption sits pending.
      on conflict (auth_user_id, prize_key, product_id, unit_value_cents)
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

-- ---------------------------------------------------------------------------
-- The page receives what the player owns.
-- ---------------------------------------------------------------------------

drop function if exists public.get_demo_roulette_inventory();

create function public.get_demo_roulette_inventory()
returns table (
  prize_key text,
  product_id uuid,
  product_name text,
  product_image_url text,
  unit_value_cents bigint,
  unit_sale_value_cents bigint,
  quantity integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_sale_rate_bps integer;
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select settings.roulette_sale_rate_bps
  into v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;
  v_sale_rate_bps := coalesce(v_sale_rate_bps, 5000);

  return query
  select
    inventory.prize_key,
    inventory.product_id,
    coalesce(product.name, 'Prêmio da roleta'),
    product.image_url,
    inventory.unit_value_cents,
    -- The same rounding the sale actually pays, so the button never promises a
    -- number the credit does not match.
    private.roulette_sale_credit(inventory.unit_value_cents, v_sale_rate_bps),
    inventory.quantity,
    inventory.updated_at
  from public.roulette_demo_inventory as inventory
  -- A left join, because a product pulled from the catalog must not delete the
  -- player's prize from their own screen.
  left join public.products as product on product.id = inventory.product_id
  where inventory.auth_user_id = v_auth_user_id
  order by
    (substring(inventory.prize_key from '\d+'))::integer,
    inventory.unit_value_cents desc,
    inventory.product_id;
end;
$$;

revoke all on function public.get_demo_roulette_inventory()
  from public, anon, authenticated, service_role;
grant execute on function public.get_demo_roulette_inventory() to authenticated;
grant execute on function public.get_demo_roulette_inventory() to service_role;

-- ---------------------------------------------------------------------------
-- The liability is what the rows froze, not what the wheel points at today.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_roulette_metrics();

create function public.admin_roulette_metrics()
returns table (
  deposit_count bigint,
  deposit_gross_cents bigint,
  deposit_payer_count bigint,
  provider_fee_cents bigint,
  coin_liability_cents bigint,
  spin_count bigint,
  spinner_count bigint,
  coins_spent_cents bigint,
  awarded_value_cents bigint,
  sold_unit_count bigint,
  sold_credited_cents bigint,
  redeemed_unit_count bigint,
  redeemed_value_cents bigint,
  delivered_unit_count bigint,
  delivered_value_cents bigint,
  pending_redemption_count bigint,
  held_unit_count bigint,
  held_value_cents bigint,
  delivered_cost_cents bigint,
  pending_cost_cents bigint,
  held_cost_cents bigint,
  net_profit_cents bigint,
  markup_bps integer,
  fee_bps integer,
  sale_rate_bps integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_markup_bps integer;
  v_fee_bps integer;
  v_sale_rate_bps integer;
  v_deposit_count bigint;
  v_deposit_gross bigint;
  v_payers bigint;
  v_liability bigint;
  v_spins bigint;
  v_spinners bigint;
  v_coins_spent bigint;
  v_awarded bigint;
  v_sold_credited bigint;
  v_redeemed_units bigint;
  v_redeemed_value bigint;
  v_delivered_units bigint;
  v_delivered_value bigint;
  v_pending bigint;
  v_held_units bigint;
  v_held_value bigint;
  v_sold_units bigint;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  select
    coalesce(settings.roulette_markup_bps, 7000),
    coalesce(settings.livepix_fee_bps, 500),
    coalesce(settings.roulette_sale_rate_bps, 5000)
  into v_markup_bps, v_fee_bps, v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;
  v_markup_bps := coalesce(v_markup_bps, 7000);
  v_fee_bps := coalesce(v_fee_bps, 500);
  v_sale_rate_bps := coalesce(v_sale_rate_bps, 5000);

  select count(*), coalesce(sum(purchase.amount_cents), 0), count(distinct purchase.auth_user_id)
  into v_deposit_count, v_deposit_gross, v_payers
  from public.roulette_coin_purchases as purchase
  where purchase.status = 'credited'
    and not exists (
      select 1
      from public.admin_profiles as staff
      where staff.auth_user_id = purchase.auth_user_id
    );

  select coalesce(sum(wallet.balance_cents), 0)
  into v_liability
  from public.roulette_coin_balances as wallet
  where not exists (
    select 1
    from public.admin_profiles as staff
    where staff.auth_user_id = wallet.auth_user_id
  );

  select
    count(*),
    count(distinct spin.auth_user_id),
    coalesce(sum(spin.prize_value_cents), 0)
  into v_spins, v_spinners, v_awarded
  from public.roulette_demo_spins as spin
  where not exists (
    select 1
    from public.admin_profiles as staff
    where staff.auth_user_id = spin.auth_user_id
  );

  select coalesce(sum(abs(entry.amount_cents)), 0)
  into v_coins_spent
  from public.roulette_coin_entries as entry
  where entry.kind = 'spin'
    and not exists (
      select 1
      from public.admin_profiles as staff
      where staff.auth_user_id = entry.auth_user_id
    );

  select coalesce(sum(entry.amount_cents), 0)
  into v_sold_credited
  from public.roulette_coin_entries as entry
  where entry.kind = 'sale'
    and not exists (
      select 1
      from public.admin_profiles as staff
      where staff.auth_user_id = entry.auth_user_id
    );

  select
    coalesce(sum(line.quantity), 0),
    coalesce(sum(line.quantity * line.value_cents), 0)
  into v_redeemed_units, v_redeemed_value
  from public.roulette_redemption_items as line
  join public.roulette_redemptions as redemption on redemption.id = line.redemption_id
  where redemption.status <> 'cancelled'
    and not exists (
      select 1
      from public.admin_profiles as staff
      where staff.auth_user_id = redemption.auth_user_id
    );

  select
    coalesce(sum(line.quantity), 0),
    coalesce(sum(line.quantity * line.value_cents), 0)
  into v_delivered_units, v_delivered_value
  from public.roulette_redemption_items as line
  join public.roulette_redemptions as redemption on redemption.id = line.redemption_id
  where redemption.status = 'delivered'
    and not exists (
      select 1
      from public.admin_profiles as staff
      where staff.auth_user_id = redemption.auth_user_id
    );

  select count(*)
  into v_pending
  from public.roulette_redemptions as redemption
  where redemption.status = 'pending'
    and not exists (
      select 1
      from public.admin_profiles as staff
      where staff.auth_user_id = redemption.auth_user_id
    );

  -- What is owed is what the rows say it is. Pricing held units through the
  -- slot they came from valued them at whatever that slot points at today, and
  -- the frozen fallback read the last spin of the prize_key rather than the
  -- price of this row -- so the liability moved every time the wheel was
  -- rebalanced. The row froze its own price when it was won; use that.
  select
    coalesce(sum(item.quantity), 0),
    coalesce(sum(item.quantity * item.unit_value_cents), 0)
  into v_held_units, v_held_value
  from public.roulette_demo_inventory as item
  where not exists (
    select 1
    from public.admin_profiles as staff
    where staff.auth_user_id = item.auth_user_id
  );

  -- Every prize a spin created is sold, redeemed or still held.
  v_sold_units := greatest(v_spins - v_redeemed_units - v_held_units, 0);

  return query
  select
    v_deposit_count,
    v_deposit_gross,
    v_payers,
    (v_deposit_gross * v_fee_bps) / 10000,
    v_liability,
    v_spins,
    v_spinners,
    v_coins_spent,
    v_awarded,
    v_sold_units,
    v_sold_credited,
    v_redeemed_units,
    v_redeemed_value,
    v_delivered_units,
    v_delivered_value,
    v_pending,
    v_held_units,
    v_held_value,
    -- Cost of goods: the listed price divided by the markup.
    (v_delivered_value * 10000) / (10000 + v_markup_bps),
    ((v_redeemed_value - v_delivered_value) * 10000) / (10000 + v_markup_bps),
    (v_held_value * 10000) / (10000 + v_markup_bps),
    -- What is banked today: deposits, minus the provider fee, minus the cost of
    -- the prizes already handed over. Coins still in wallets and prizes not yet
    -- delivered are liabilities, reported apart.
    v_deposit_gross
      - (v_deposit_gross * v_fee_bps) / 10000
      - (v_delivered_value * 10000) / (10000 + v_markup_bps),
    v_markup_bps,
    v_fee_bps,
    v_sale_rate_bps;
end;
$$;

revoke all on function public.admin_roulette_metrics()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_metrics() to authenticated;

commit;
