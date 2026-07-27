-- Two live defects in the roulette economy.
--
-- 1. The resale floored per unit before multiplying by the quantity, so the
--    R$ 0,15 prize paid R$ 0,07 instead of R$ 0,075 — 46,7% on the slot that
--    wins 48% of the time, while the site advertises 50%. The credit now
--    rounds half up.
--
-- 2. roulette_demo_inventory held only (auth_user_id, prize_key). Both the sale
--    and the redemption resolved the price live from the catalog, so editing a
--    product's price, archiving it, or re-running the rebalance silently
--    repriced — or outright replaced — every unit a player already owned. The
--    spin already freezes prize_value_cents for exactly this reason; the
--    inventory now freezes the product and its price too, and a deferred
--    constraint refuses any slot change that would repoint held units.

begin;

set local lock_timeout = '5s';

alter table public.roulette_demo_inventory
  add column if not exists product_id uuid references public.products (id),
  add column if not exists unit_value_cents bigint not null default 0;

-- Backfill from the slot mapping as it stands right now; where the slot is
-- already gone, the most recent spin of that prize still knows what it paid.
update public.roulette_demo_inventory as item
set
  product_id = coalesce(item.product_id, slot.product_id),
  unit_value_cents = case
    when item.unit_value_cents > 0 then item.unit_value_cents
    else coalesce(product.minimum_price_cents::bigint, 0)
  end
from public.roulette_prize_products as slot
join public.products as product on product.id = slot.product_id
where slot.prize_key = item.prize_key
  and (item.product_id is null or item.unit_value_cents = 0);

-- A scalar subquery, not a lateral join: an UPDATE target cannot be referenced
-- from its own FROM clause.
update public.roulette_demo_inventory as item
set unit_value_cents = coalesce(
  (
    select spin.prize_value_cents
    from public.roulette_demo_spins as spin
    where spin.prize_key = item.prize_key
      and spin.prize_value_cents > 0
    order by spin.created_at desc
    limit 1
  ),
  0
)
where item.unit_value_cents = 0;

do $$
declare
  v_orphans integer;
begin
  select count(*)
  into v_orphans
  from public.roulette_demo_inventory as item
  where item.product_id is null;

  if v_orphans > 0 then
    raise exception using
      errcode = 'P0015',
      message = format(
        '%s inventory row(s) point at a prize with no catalog product; resolve them before freezing.',
        v_orphans
      );
  end if;
end
$$;

alter table public.roulette_demo_inventory
  alter column product_id set not null;

comment on column public.roulette_demo_inventory.product_id is
  'Product the unit actually is, frozen when it was won. A player owns an item, not a wheel slot.';
comment on column public.roulette_demo_inventory.unit_value_cents is
  'Catalog price per unit at the moment it was won, so a later price edit cannot rewrite what it is worth.';

/**
 * A player owns the product that was on the wheel when they spun. Repointing a
 * slot at a different product while somebody still holds units would rewrite
 * what they own, so the whole mapping is checked once at commit: a rebalance
 * that keeps its products passes, one that swaps a held slot is refused.
 */
create or replace function private.assert_roulette_inventory_intact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_conflict record;
begin
  select item.prize_key, item.product_id as held_product_id, slot.product_id as slot_product_id
  into v_conflict
  from public.roulette_demo_inventory as item
  join public.roulette_prize_products as slot on slot.prize_key = item.prize_key
  where slot.product_id <> item.product_id
  limit 1;

  if found then
    raise exception using
      errcode = 'P0014',
      message = format(
        'Slot %s still holds units of product %s and cannot be repointed at %s.',
        v_conflict.prize_key, v_conflict.held_product_id, v_conflict.slot_product_id
      );
  end if;

  return null;
end;
$$;

revoke all on function private.assert_roulette_inventory_intact()
  from public, anon, authenticated, service_role;

drop trigger if exists roulette_prize_products_keep_inventory on public.roulette_prize_products;
create constraint trigger roulette_prize_products_keep_inventory
  after insert or update or delete on public.roulette_prize_products
  deferrable initially deferred
  for each row
  execute function private.assert_roulette_inventory_intact();

-- Spins now record which product the unit is, next to what it was worth.
create or replace function private.record_roulette_spin(
  p_auth_user_id uuid,
  p_discord_user_id text,
  p_display_name text,
  p_spun_at timestamptz
)
returns table (
  recorded_spin_id uuid,
  won_prize_key text,
  inventory_quantity integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_prize_keys text[];
  v_prize_key text;
  v_spin_id uuid;
  v_inventory_quantity integer;
  v_product_id uuid;
  v_product_name text;
  v_product_image_url text;
  v_value_cents bigint;
  v_top_value_cents bigint;
begin
  select array_agg(slot.prize_key order by slot.prize_key)
  into v_prize_keys
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  if v_prize_keys is null or array_length(v_prize_keys, 1) is null then
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
  on conflict (auth_user_id, prize_key)
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

  return query select v_spin_id, v_prize_key, v_inventory_quantity;
end;
$$;

revoke all on function private.record_roulette_spin(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

/** Half up, so the advertised share is what the player actually receives. */
create or replace function private.roulette_sale_credit(
  p_value_cents bigint,
  p_sale_rate_bps integer
)
returns bigint
language sql
immutable
set search_path = pg_catalog
as $$
  select (greatest(p_value_cents, 0) * greatest(p_sale_rate_bps, 0) + 5000) / 10000;
$$;

revoke all on function private.roulette_sale_credit(bigint, integer)
  from public, anon, authenticated, service_role;

comment on function private.roulette_sale_credit(bigint, integer) is
  'Coins credited for one unit. Rounds half up: flooring turned the 15 cent prize into 7 cents while the store advertised half.';

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
  v_auth_user_id uuid := auth.uid();
  v_guild_id uuid;
  v_selection record;
  v_item public.roulette_demo_inventory%rowtype;
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

    -- The ticket promises the product the player actually won, priced as it was
    -- won, never whatever the slot happens to point at today.
    select product.name
    into v_product_name
    from public.products as product
    where product.id = v_item.product_id;

    if v_product_name is null then
      raise exception using
        errcode = 'P0010',
        message = 'The prize no longer has a catalog product.';
    end if;

    v_value_cents := nullif(v_item.unit_value_cents, 0);
    if v_value_cents is null then
      select product.minimum_price_cents::bigint
      into v_value_cents
      from public.products as product
      where product.id = v_item.product_id;
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
      v_item.product_id,
      v_product_name,
      coalesce(v_value_cents, 0),
      v_selection.selected_quantity
    );

    v_total_units := v_total_units + v_selection.selected_quantity;
    v_total_value := v_total_value + coalesce(v_value_cents, 0) * v_selection.selected_quantity;
    v_results := v_results || jsonb_build_object(
      'prize_key', v_item.prize_key,
      'product_name', v_product_name,
      'quantity', v_selection.selected_quantity,
      'remaining_quantity', v_remaining,
      'value_cents', coalesce(v_value_cents, 0)
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

-- A cancelled ticket has to give back the very product it took, at its price.
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

revoke all on function public.admin_settle_roulette_redemption(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_settle_roulette_redemption(uuid, text) to authenticated;

commit;
