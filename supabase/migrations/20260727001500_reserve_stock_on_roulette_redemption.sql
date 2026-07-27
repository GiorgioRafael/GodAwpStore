-- Stop the roulette promising what the store cannot hand over.
--
-- Redemption ignored catalog stock, so the wheel could award an item with zero
-- units and a player could open a ticket nobody was able to honour. The request
-- now refuses to open unless the units exist, and the whole selection is checked
-- before a single prize moves so the player is told which item is short instead
-- of watching the request fail halfway.
--
-- The catalog itself is decremented when the administrator marks the ticket
-- delivered, not when the player asks. private.audit_admin_mutation() requires
-- an administrative actor on every product mutation, and that invariant is
-- worth more than a reservation: moving the write to the delivery keeps the
-- audit trail honest and attributes the unit to whoever handed it over. The
-- gap it leaves — stock draining between the request and the handover — is
-- caught at delivery, which is the moment the operator can still act on it.

begin;

set local lock_timeout = '5s';

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
  v_product record;
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

  -- Pass one validates the whole request before anything moves. Products are
  -- read in a fixed order so concurrent redemptions queue instead of
  -- deadlocking.
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
  end loop;

  for v_selection in
    select selection.selected_prize_key, selection.selected_quantity, item.product_id
    from private.read_roulette_item_selection(p_items) as selection
    join public.roulette_demo_inventory as item
      on item.auth_user_id = v_auth_user_id
      and item.prize_key = selection.selected_prize_key
    order by item.product_id
  loop
    select product.id, product.name, product.stock_quantity, product.archived_at
    into v_product
    from public.products as product
    where product.id = v_selection.product_id
    for update;

    if not found or v_product.archived_at is not null then
      raise exception using
        errcode = 'P0010',
        message = 'The prize no longer has a catalog product.';
    end if;

    if v_product.stock_quantity < v_selection.selected_quantity then
      raise exception using
        errcode = 'P0016',
        message = format(
          '%s has %s unit(s) in stock and %s were requested.',
          v_product.name, v_product.stock_quantity, v_selection.selected_quantity
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
      v_product.name,
      v_value_cents,
      v_selection.selected_quantity
    );

    v_total_units := v_total_units + v_selection.selected_quantity;
    v_total_value := v_total_value + v_value_cents * v_selection.selected_quantity;
    v_results := v_results || jsonb_build_object(
      'prize_key', v_item.prize_key,
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

-- Delivering is what takes the unit out of the catalog: the administrator is
-- the actor the audit trigger demands, so the movement is attributed to
-- whoever actually handed the item over.
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
    delivered_by = v_admin_id
  where redemption.id = v_redemption.id
  returning * into v_redemption;

  return query select v_redemption.id, v_redemption.status;
end;
$$;

revoke all on function public.redeem_roulette_prizes(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.redeem_roulette_prizes(jsonb) to authenticated, service_role;

revoke all on function public.admin_settle_roulette_redemption(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_settle_roulette_redemption(uuid, text) to authenticated;

comment on function public.redeem_roulette_prizes(jsonb) is
  'Bundles several prizes into one redemption request, refusing anything the catalog cannot cover.';
comment on function public.admin_settle_roulette_redemption(uuid, text) is
  'Settles a redemption. Delivering takes the units out of the catalog under the administrator that handed them over; cancelling gives the prize back to the player.';

commit;
