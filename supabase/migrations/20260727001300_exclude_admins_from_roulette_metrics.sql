-- Keep internal testing out of the roulette result.
-- Administrators spin for free to check the wheel, so their spins, prizes and
-- wallets were inflating every number on the panel: 27 spins and R$ 38,50 in
-- prizes against R$ 0,00 of revenue. The panel now counts player accounts only,
-- and the two administrator columns are gone instead of merely hidden.

begin;

set local lock_timeout = '5s';

drop function if exists public.admin_roulette_metrics();

/**
 * One row with everything the roulette panel shows, counting player accounts
 * only. Every prize a spin created ends in exactly one of three places — sold
 * back, redeemed or still held — so the split is derived from that identity
 * instead of a second counter that could drift.
 *
 * An account is internal when it has a row in admin_profiles, regardless of
 * whether that authorization is still valid: an expired administrator was
 * still testing, not playing.
 */
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

  -- Rebalancing the wheel rewrites roulette_prize_products, so a player can be
  -- holding a prize whose slot no longer exists. Pricing it from the catalog
  -- alone would count the unit but drop its value, understating the liability;
  -- the frozen price from the spin that created it fills the gap.
  select
    coalesce(sum(item.quantity), 0),
    coalesce(sum(item.quantity * coalesce(product.minimum_price_cents, frozen.value_cents, 0)), 0)
  into v_held_units, v_held_value
  from public.roulette_demo_inventory as item
  left join public.roulette_prize_products as slot on slot.prize_key = item.prize_key
  left join public.products as product on product.id = slot.product_id
  left join lateral (
    select spin.prize_value_cents as value_cents
    from public.roulette_demo_spins as spin
    where spin.prize_key = item.prize_key
      and spin.prize_value_cents > 0
    order by spin.created_at desc
    limit 1
  ) as frozen on true
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

comment on function public.admin_roulette_metrics() is
  'Roulette result for player accounts only, assembled from the coin ledger and prize tables; administrator testing and order revenue are both left out.';

commit;
