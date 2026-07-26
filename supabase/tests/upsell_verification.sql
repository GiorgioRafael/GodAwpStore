-- Discord upsell cap, ownership, idempotency and deferred stock.
-- Every fixture is rolled back.

begin;

set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label)
values ('a1000000-0000-4000-8000-000000000001', '710000000000000001', 'Upsell seller');

insert into public.games (id, name, slug, status)
values ('a2000000-0000-4000-8000-000000000001', 'Upsell Game', 'upsell-game', 'active');

insert into public.substores (
  id, game_id, name, slug, title, description, status
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Upsell Store',
  'upsell-store',
  'Upsell Store',
  'Transactional upsell fixture.',
  'active'
);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'Upsell Product',
  'upsell-product',
  200,
  10,
  'active'
);

insert into public.guilds (
  id, discord_guild_id, owner_discord_id, whitelist_entry_id, name, status
)
values (
  'a5000000-0000-4000-8000-000000000001',
  '750000000000000001',
  '710000000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Upsell Guild',
  'active'
);

update public.platform_settings
set
  upsell_enabled = true,
  upsell_discount_bps = 500,
  upsell_strategy = 'same_product'
where id = 1;

do $$
declare
  offer_row record;
  accepted record;
  replayed record;
  conflicted record;
  order_row public.orders%rowtype;
  stored_offer public.upsell_offers%rowtype;
begin
  select * into strict offer_row
  from public.create_bot_upsell_offer(
    '760000000000000001',
    'a5000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '770000000000000001',
    '[{"product_id":"a4000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    0,
    null,
    1000
  );

  if not offer_row.offered
    or not offer_row.was_created
    or offer_row.discount_bps <> 500
    or offer_row.offered_unit_price_cents <> 200
    or offer_row.discounted_unit_price_cents <> 190 then
    raise exception 'server-priced 5 percent upsell was not created';
  end if;

  select * into strict accepted
  from public.finalize_bot_upsell_offer(
    offer_row.offer_id,
    '750000000000000001',
    '770000000000000001',
    true,
    '780000000000000001'
  );

  if not accepted.was_created
    or accepted.out_of_stock
    or accepted.offer_expired
    or accepted.decision_conflict
    or accepted.checkout_order_id is null then
    raise exception 'upsell acceptance did not create an order';
  end if;

  select * into strict order_row
  from public.orders
  where id = accepted.checkout_order_id;
  select * into strict stored_offer
  from public.upsell_offers
  where id = offer_row.offer_id;

  if order_row.quantity <> 2
    or order_row.subtotal_price_cents <> 400
    or order_row.sale_price_cents <> 390
    or order_row.discount_amount_cents <> 10
    or order_row.discount_reason <> 'upsell'
    or order_row.upsell_discount_bps <> 500
    or order_row.upsell_discount_amount_cents <> 10
    or order_row.upsell_offer_id <> offer_row.offer_id
    or stored_offer.status <> 'accepted'
    or stored_offer.order_id <> accepted.checkout_order_id
    or (
      select quantity
      from public.order_items
      where order_id = accepted.checkout_order_id
        and product_id = 'a4000000-0000-4000-8000-000000000001'
    ) <> 2
    or (
      select stock_quantity
      from public.products
      where id = 'a4000000-0000-4000-8000-000000000001'
    ) <> 10 then
    raise exception 'accepted upsell totals, audit link or stock are inconsistent';
  end if;

  select * into strict replayed
  from public.finalize_bot_upsell_offer(
    offer_row.offer_id,
    '750000000000000001',
    '770000000000000001',
    true,
    '780000000000000002'
  );
  if replayed.was_created
    or replayed.checkout_order_id <> accepted.checkout_order_id
    or (
      select stock_quantity
      from public.products
      where id = 'a4000000-0000-4000-8000-000000000001'
    ) <> 10 then
    raise exception 'replayed acceptance changed the order or stock';
  end if;

  select * into strict conflicted
  from public.finalize_bot_upsell_offer(
    offer_row.offer_id,
    '750000000000000001',
    '770000000000000001',
    false,
    '780000000000000003'
  );
  if not conflicted.decision_conflict then
    raise exception 'opposite upsell decision did not conflict';
  end if;

  begin
    perform public.finalize_bot_upsell_offer(
      offer_row.offer_id,
      '750000000000000001',
      '770000000000000002',
      true,
      '780000000000000004'
    );
    raise exception 'another Discord user finalized the upsell';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
declare
  no_offer record;
  declined_offer record;
  declined record;
  expired_offer record;
  expired_result record;
begin
  select * into strict no_offer
  from public.create_bot_upsell_offer(
    '760000000000000010',
    'a5000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '770000000000000010',
    '[{"product_id":"a4000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    500,
    'server_booster',
    1000
  );
  if no_offer.offered or no_offer.offer_id is not null then
    raise exception 'upsell was offered over an equal existing discount';
  end if;

  select * into strict declined_offer
  from public.create_bot_upsell_offer(
    '760000000000000011',
    'a5000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '770000000000000011',
    '[{"product_id":"a4000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    0,
    null,
    1000
  );
  select * into strict declined
  from public.finalize_bot_upsell_offer(
    declined_offer.offer_id,
    '750000000000000001',
    '770000000000000011',
    false,
    '780000000000000011'
  );
  if not declined.was_created
    or (
      select upsell_quantity
      from public.orders
      where id = declined.checkout_order_id
    ) <> 0
    or (
      select status
      from public.upsell_offers
      where id = declined_offer.offer_id
    ) <> 'declined' then
    raise exception 'declining an upsell did not create only the base order';
  end if;

  select * into strict expired_offer
  from public.create_bot_upsell_offer(
    '760000000000000012',
    'a5000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '770000000000000012',
    '[{"product_id":"a4000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    0,
    null,
    1000
  );
  update public.upsell_offers
  set expires_at = now() - interval '1 second'
  where id = expired_offer.offer_id;
  select * into strict expired_result
  from public.finalize_bot_upsell_offer(
    expired_offer.offer_id,
    '750000000000000001',
    '770000000000000012',
    true,
    '780000000000000012'
  );
  if not expired_result.offer_expired
    or expired_result.checkout_order_id is not null
    or (
      select status
      from public.upsell_offers
      where id = expired_offer.offer_id
    ) <> 'expired' then
    raise exception 'expired upsell created an order';
  end if;
end
$$;

do $$
begin
  begin
    update public.platform_settings
    set upsell_discount_bps = 501
    where id = 1;
    raise exception 'platform accepted an upsell discount above 5 percent';
  exception
    when check_violation then null;
  end;

  if has_table_privilege('anon', 'public.upsell_offers', 'select')
    or has_table_privilege('authenticated', 'public.upsell_offers', 'select')
    or has_table_privilege('service_role', 'public.upsell_offers', 'select') then
    raise exception 'upsell offer rows are directly readable';
  end if;

  if has_function_privilege(
    'anon',
    'public.finalize_bot_upsell_offer(uuid,text,text,boolean,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.finalize_bot_upsell_offer(uuid,text,text,boolean,text)',
    'execute'
  ) then
    raise exception 'untrusted database roles can finalize upsells';
  end if;
end
$$;

rollback;

select 'Discord upsell verification passed' as result;
