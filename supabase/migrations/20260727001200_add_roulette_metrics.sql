-- Roulette metrics, kept apart from the order ledger.
-- The roulette never touches orders, ledger_entries or commissions, so its
-- result has to be assembled from its own tables. This migration freezes what
-- a spin was worth at the time it happened, records the two rates the estimate
-- depends on, and exposes one admin-only aggregate.

begin;

set local lock_timeout = '5s';

alter table public.platform_settings
  add column if not exists roulette_markup_bps integer not null default 7000,
  add column if not exists livepix_fee_bps integer not null default 500;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_roulette_markup_range'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_roulette_markup_range
      check (roulette_markup_bps between 0 and 1000000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_livepix_fee_range'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_livepix_fee_range
      check (livepix_fee_bps between 0 and 10000);
  end if;
end
$$;

comment on column public.platform_settings.roulette_markup_bps is
  'Markup applied over the acquisition cost, in basis points. 7000 means an item bought for R$ 1,00 is listed at R$ 1,70.';
comment on column public.platform_settings.livepix_fee_bps is
  'Share LivePix keeps from each Pix receipt, in basis points.';

-- A spin only stored its slot, so every rebalance silently re-priced history.
alter table public.roulette_demo_spins
  add column if not exists prize_value_cents bigint not null default 0;

comment on column public.roulette_demo_spins.prize_value_cents is
  'Catalog price of the prize at the moment of the spin, so a later rebalance cannot rewrite the numbers.';

-- Best effort for the spins that predate the column: today's slot value.
update public.roulette_demo_spins as spin
set prize_value_cents = product.minimum_price_cents
from public.roulette_prize_products as slot
join public.products as product on product.id = slot.product_id
where slot.prize_key = spin.prize_key
  and spin.prize_value_cents = 0;

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

  select product.name, product.image_url, product.minimum_price_cents::bigint
  into v_product_name, v_product_image_url, v_value_cents
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
    quantity,
    created_at,
    updated_at
  )
  values (p_auth_user_id, p_discord_user_id, v_prize_key, 1, p_spun_at, p_spun_at)
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

/**
 * One row with everything the roulette panel shows. Every prize a spin created
 * ends in exactly one of three places — sold back, redeemed or still held — so
 * the split is derived from that identity instead of a second counter that
 * could drift.
 */
create function public.admin_roulette_metrics()
returns table (
  deposit_count bigint,
  deposit_gross_cents bigint,
  deposit_payer_count bigint,
  provider_fee_cents bigint,
  coin_liability_cents bigint,
  spin_count bigint,
  paid_spin_count bigint,
  admin_spin_count bigint,
  coins_spent_cents bigint,
  awarded_value_cents bigint,
  admin_awarded_value_cents bigint,
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
  v_paid_spins bigint;
  v_coins_spent bigint;
  v_awarded bigint;
  v_admin_awarded bigint;
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
  where purchase.status = 'credited';

  select coalesce(sum(wallet.balance_cents), 0)
  into v_liability
  from public.roulette_coin_balances as wallet;

  select
    count(*),
    coalesce(sum(spin.prize_value_cents), 0)
  into v_spins, v_awarded
  from public.roulette_demo_spins as spin;

  -- A paid spin always leaves a debit in the coin ledger; an admin spin never
  -- does, so the difference names the free ones.
  select count(*), coalesce(sum(abs(entry.amount_cents)), 0)
  into v_paid_spins, v_coins_spent
  from public.roulette_coin_entries as entry
  where entry.kind = 'spin';

  select coalesce(sum(spin.prize_value_cents), 0)
  into v_admin_awarded
  from public.roulette_demo_spins as spin
  where not exists (
    select 1
    from public.roulette_coin_entries as entry
    where entry.spin_id = spin.id
  );

  select coalesce(sum(entry.amount_cents), 0)
  into v_sold_credited
  from public.roulette_coin_entries as entry
  where entry.kind = 'sale';

  select
    coalesce(sum(line.quantity), 0),
    coalesce(sum(line.quantity * line.value_cents), 0)
  into v_redeemed_units, v_redeemed_value
  from public.roulette_redemption_items as line
  join public.roulette_redemptions as redemption on redemption.id = line.redemption_id
  where redemption.status <> 'cancelled';

  select
    coalesce(sum(line.quantity), 0),
    coalesce(sum(line.quantity * line.value_cents), 0)
  into v_delivered_units, v_delivered_value
  from public.roulette_redemption_items as line
  join public.roulette_redemptions as redemption on redemption.id = line.redemption_id
  where redemption.status = 'delivered';

  select count(*)
  into v_pending
  from public.roulette_redemptions as redemption
  where redemption.status = 'pending';

  select
    coalesce(sum(item.quantity), 0),
    coalesce(sum(item.quantity * product.minimum_price_cents), 0)
  into v_held_units, v_held_value
  from public.roulette_demo_inventory as item
  left join public.roulette_prize_products as slot on slot.prize_key = item.prize_key
  left join public.products as product on product.id = slot.product_id;

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
    v_paid_spins,
    v_spins - v_paid_spins,
    v_coins_spent,
    v_awarded,
    v_admin_awarded,
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

comment on function public.admin_roulette_metrics() is
  'Roulette-only result, assembled from the coin ledger and prize tables; never mixes with order revenue.';

commit;
