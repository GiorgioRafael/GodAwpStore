-- A slice is a bundle: N units of a product, not one.
--
-- "5000x Bamboo Seed" was a product name, so the only way to offer a bigger
-- bundle was a second catalog entry. The slice carries the count now, and the
-- money it represents is the unit price times that count -- which is what the
-- wheel shows and what every calculation downstream uses: RTP, expected value,
-- cost, margin, break-even, and which two slices get the gold outline.
--
-- Two things had to move with it, and neither is cosmetic.
--
-- The spin table records how many units it handed out. Its prize_value_cents
-- was already the frozen worth of the spin, but the panel derives units sold as
-- `spins - redeemed - held`, counting one row as one unit. With bundles a row
-- is N units, and the whole split -- sold, redeemed, still held -- would drift
-- apart from the first spin onward, silently.
--
-- The unique index that bound a product to at most one slice is dropped.
-- Bundles are exactly the reason to list the same product twice: 1x on a common
-- slice and 10x on a rare one is the point, and the inventory already tells the
-- two apart because a row is keyed by its slice as well as its product.

begin;

set local lock_timeout = '5s';

alter table public.roulette_prize_products
  add column if not exists prize_quantity integer not null default 1;

alter table public.roulette_prize_products
  drop constraint if exists roulette_prize_products_quantity_sane;
alter table public.roulette_prize_products
  add constraint roulette_prize_products_quantity_sane
  check (prize_quantity between 1 and 10000);

drop index if exists public.roulette_prize_products_product_unique;

comment on column public.roulette_prize_products.prize_quantity is
  'How many units of the product one win hands over. The slice is worth unit price times this.';

alter table public.roulette_demo_spins
  add column if not exists prize_quantity integer not null default 1;

alter table public.roulette_demo_spins
  drop constraint if exists roulette_demo_spins_quantity_sane;
alter table public.roulette_demo_spins
  add constraint roulette_demo_spins_quantity_sane
  check (prize_quantity between 1 and 10000);

comment on column public.roulette_demo_spins.prize_quantity is
  'Units this spin handed over. The panel splits prizes into sold, redeemed and held by counting units, and one spin is no longer one unit.';

-- ---------------------------------------------------------------------------
-- The spin hands over the whole bundle.
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
  won_quantity integer,
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
  v_unit_value_cents bigint;
  v_quantity integer;
  v_total_value_cents bigint;
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

  select
    product.id,
    product.name,
    product.image_url,
    product.minimum_price_cents::bigint,
    greatest(slot.prize_quantity, 1)
  into v_product_id, v_product_name, v_product_image_url, v_unit_value_cents, v_quantity
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where slot.prize_key = v_prize_key;

  v_unit_value_cents := coalesce(v_unit_value_cents, 0);
  v_quantity := coalesce(v_quantity, 1);
  -- What the spin was worth: the bundle, not one of its units.
  v_total_value_cents := v_unit_value_cents * v_quantity;

  insert into public.roulette_demo_spins (
    auth_user_id,
    discord_user_id,
    prize_key,
    prize_value_cents,
    prize_quantity,
    created_at
  )
  values (
    p_auth_user_id,
    p_discord_user_id,
    v_prize_key,
    v_total_value_cents,
    v_quantity,
    p_spun_at
  )
  returning id into v_spin_id;

  -- The bundle becomes units the moment it is won. A player who wins ten seeds
  -- can sell six and redeem four; keeping the bundle whole would have made the
  -- inventory, the sale and the delivery all learn a second kind of thing.
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
    v_unit_value_cents,
    v_quantity,
    p_spun_at,
    p_spun_at
  )
  on conflict (auth_user_id, prize_key, product_id, unit_value_cents)
  do update set
    discord_user_id = excluded.discord_user_id,
    quantity = public.roulette_demo_inventory.quantity + excluded.quantity,
    updated_at = excluded.updated_at
  returning quantity into v_inventory_quantity;

  -- Both sides of the jackpot test are bundles, or a cheap slice paying ten
  -- units would lose to a dear one paying a single unit.
  select max(product.minimum_price_cents::bigint * greatest(slot.prize_quantity, 1))
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
    -- The feed is a display record, so the count rides in the name it already
    -- carries rather than making every reader of the overlay learn a column.
    case
      when v_quantity > 1 then v_quantity || 'x ' || coalesce(v_product_name, 'Prêmio da roleta')
      else coalesce(v_product_name, 'Prêmio da roleta')
    end,
    v_product_image_url,
    v_total_value_cents,
    private.mask_display_name(p_display_name),
    v_total_value_cents >= coalesce(v_top_value_cents, 0)
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
    -- Per unit, because that is what the inventory row is keyed by and what the
    -- sale pays on. The bundle's worth is that times the count.
    v_unit_value_cents,
    private.roulette_sale_credit(v_unit_value_cents, coalesce(v_sale_rate_bps, 5000)),
    v_quantity,
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
  won_quantity integer,
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
    v_spin.won_quantity,
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
  won_quantity integer,
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
    v_spin.won_quantity,
    v_spin.inventory_quantity,
    private.roulette_coin_balance(p_auth_user_id),
    v_spun_at;
end;
$$;

revoke all on function public.spin_roulette_as_admin(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.spin_roulette_as_admin(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- What the wheel is worth, to the player and to the operator.
-- ---------------------------------------------------------------------------

drop function if exists public.get_roulette_prizes();

create function public.get_roulette_prizes()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_product_image_url text,
  slot_prize_quantity integer,
  slot_value_cents bigint,
  slot_sale_value_cents bigint,
  slot_draw_weight integer,
  slot_draw_chance_bps integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_sale_rate_bps integer;
  v_total_weight bigint;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select settings.roulette_sale_rate_bps
  into v_sale_rate_bps
  from public.platform_settings as settings
  where settings.id = 1;
  v_sale_rate_bps := coalesce(v_sale_rate_bps, 5000);

  select sum(slot.draw_weight)
  into v_total_weight
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null;

  return query
  select
    slot.prize_key,
    product.id,
    product.name,
    product.image_url,
    greatest(slot.prize_quantity, 1),
    -- The slice's worth: the whole bundle.
    product.minimum_price_cents::bigint * greatest(slot.prize_quantity, 1),
    -- Per unit first, then multiplied, because that is the order the sale pays
    -- in: quoting the rounded whole would promise a cent the units never add to.
    private.roulette_sale_credit(product.minimum_price_cents::bigint, v_sale_rate_bps)
      * greatest(slot.prize_quantity, 1),
    slot.draw_weight,
    case
      when coalesce(v_total_weight, 0) > 0
        then ((slot.draw_weight::bigint * 10000) / v_total_weight)::integer
      else 0
    end
  from public.roulette_prize_products as slot
  join public.products as product on product.id = slot.product_id
  where product.archived_at is null
  order by (substring(slot.prize_key from '\d+'))::integer;
end;
$$;

-- The editor gets the unit price and the count apart, because it has to let the
-- operator change either one and show the product of the two.
drop function if exists public.admin_roulette_wheel();

create function public.admin_roulette_wheel()
returns table (
  slot_prize_key text,
  slot_product_id uuid,
  slot_product_name text,
  slot_value_cents bigint,
  slot_prize_quantity integer,
  slot_stock_quantity bigint,
  slot_draw_weight integer,
  slot_draw_chance_bps integer,
  slot_held_units bigint,
  slot_retired_units bigint,
  slot_archived boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_total_weight bigint;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  select coalesce(sum(slot.draw_weight), 0)
  into v_total_weight
  from public.roulette_prize_products as slot;

  return query
  select
    slot.prize_key,
    product.id,
    coalesce(product.name, 'Produto removido'),
    coalesce(product.minimum_price_cents, 0)::bigint,
    greatest(slot.prize_quantity, 1),
    coalesce(product.stock_quantity, 0)::bigint,
    slot.draw_weight,
    case
      when v_total_weight > 0 then ((slot.draw_weight::bigint * 10000) / v_total_weight)::integer
      else 0
    end,
    coalesce(
      (
        select sum(item.quantity)
        from public.roulette_demo_inventory as item
        where item.prize_key = slot.prize_key
          and item.product_id = slot.product_id
      ),
      0
    )::bigint,
    coalesce(
      (
        select sum(item.quantity)
        from public.roulette_demo_inventory as item
        where item.prize_key = slot.prize_key
          and item.product_id <> slot.product_id
      ),
      0
    )::bigint,
    product.archived_at is not null
  from public.roulette_prize_products as slot
  left join public.products as product on product.id = slot.product_id
  order by (substring(slot.prize_key from '\d+'))::integer;
end;
$$;

revoke all on function public.admin_roulette_wheel()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_roulette_wheel() to authenticated;

commit;
