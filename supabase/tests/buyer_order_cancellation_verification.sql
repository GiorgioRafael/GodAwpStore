-- Transactional verification for voluntary Discord cancellation, rebuild
-- eligibility, delayed payment handling and RPC privileges.

begin;

set transaction isolation level repeatable read;
set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label, is_active)
values (
  '86000000-0000-4000-8000-000000000001',
  '861000000000000002',
  'Buyer cancellation seller',
  true
);

insert into public.guilds (
  id,
  discord_guild_id,
  owner_discord_id,
  whitelist_entry_id,
  name,
  status
)
values (
  '86100000-0000-4000-8000-000000000001',
  '861000000000000001',
  '861000000000000002',
  '86000000-0000-4000-8000-000000000001',
  'Buyer cancellation guild',
  'active'
);

insert into public.games (id, name, slug, status)
values (
  '86200000-0000-4000-8000-000000000001',
  'Buyer cancellation game',
  'buyer-cancellation-game',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '86300000-0000-4000-8000-000000000001',
  '86200000-0000-4000-8000-000000000001',
  'Buyer cancellation store',
  'buyer-cancellation-store',
  'Buyer cancellation store',
  'active'
);

insert into public.products (
  id,
  substore_id,
  name,
  slug,
  minimum_price_cents,
  stock_quantity,
  status,
  low_stock_threshold
)
values (
  '86400000-0000-4000-8000-000000000001',
  '86300000-0000-4000-8000-000000000001',
  'Buyer cancellation product',
  'buyer-cancellation-product',
  100,
  20,
  'active',
  1
);

select *
from public.create_bot_order_with_reservation(
  '865000000000000101',
  '86100000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  '86400000-0000-4000-8000-000000000001',
  '865000000000000001',
  10,
  1000,
  1000
);

insert into public.lead_recovery_offers (
  id,
  source_order_id,
  guild_id,
  seller_whitelist_entry_id,
  buyer_discord_id,
  items,
  original_subtotal_price_cents,
  original_sale_price_cents,
  original_discount_bps,
  commission_bps,
  discount_bps,
  discount_amount_cents,
  recovered_sale_price_cents,
  status,
  dm_channel_id,
  dm_message_id,
  sent_at
)
select
  '86400000-0000-4000-8000-000000000099',
  order_row.id,
  order_row.guild_id,
  order_row.seller_whitelist_entry_id,
  order_row.buyer_discord_id,
  jsonb_build_array(jsonb_build_object('product_id', order_row.product_id)),
  order_row.subtotal_price_cents,
  order_row.sale_price_cents,
  order_row.discount_bps,
  order_row.commission_bps,
  500,
  trunc(order_row.sale_price_cents::numeric * 500 / 10000)::bigint,
  order_row.sale_price_cents
    - trunc(order_row.sale_price_cents::numeric * 500 / 10000)::bigint,
  'sent',
  '866000000000000001',
  '866000000000000002',
  now()
from public.orders as order_row
where order_row.payment_reference = 'discord:865000000000000101';

do $$
declare
  v_order_id uuid;
  v_result record;
begin
  select id into strict v_order_id
  from public.orders
  where payment_reference = 'discord:865000000000000101';

  select * into strict v_result
  from public.cancel_discord_unpaid_order(
    v_order_id,
    '861000000000000001',
    '865000000000000099'
  );

  if not v_result.unavailable or v_result.was_cancelled then
    raise exception 'another Discord buyer could cancel the order';
  end if;
end
$$;

do $$
declare
  v_order public.orders%rowtype;
  v_result record;
  v_stock bigint;
  v_audits integer;
  v_offer_status text;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:865000000000000101';

  select * into strict v_result
  from public.cancel_discord_unpaid_order(
    v_order.id,
    '861000000000000001',
    '865000000000000001'
  );

  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.id = v_order.id;

  select stock_quantity into strict v_stock
  from public.products
  where id = v_order.product_id;

  select count(*)::integer into v_audits
  from public.audit_events
  where action = 'bot.order.buyer_cancelled'
    and entity_id = v_order.id;

  select status into strict v_offer_status
  from public.lead_recovery_offers
  where source_order_id = v_order.id;

  if not v_result.was_cancelled
    or not v_result.can_rebuild
    or v_result.stock_changed
    or v_result.payment_confirmed
    or v_order.status <> 'cancelled'
    or v_order.payment_status <> 'cancelled'
    or v_order.stock_release_reason <> 'buyer_cancelled'
    or v_order.stock_released_at is null
    or v_result.recovery_dm_channel_id is distinct from '866000000000000001'
    or v_result.recovery_dm_message_id is distinct from '866000000000000002'
    or v_offer_status <> 'invalidated'
    or v_stock <> 20
    or v_audits <> 1 then
    raise exception 'buyer cancellation did not close the checkout without consuming stock';
  end if;

  select * into strict v_result
  from public.cancel_discord_unpaid_order(
    v_order.id,
    '861000000000000001',
    '865000000000000001'
  );

  if not v_result.already_cancelled or not v_result.can_rebuild then
    raise exception 'buyer cancellation is not idempotent';
  end if;

  select count(*)::integer into v_audits
  from public.audit_events
  where action = 'bot.order.buyer_cancelled'
    and entity_id = v_order.id;

  if v_audits <> 1 then
    raise exception 'buyer cancellation duplicated its audit event';
  end if;
end
$$;

-- A provider notification after the buyer cancels records money for manual
-- review but must not revive the order or consume stock.
update public.orders
set
  payment_provider_reference = 'buyer-cancelled-provider-reference',
  payment_provider_checkout_id = 'buyer-cancelled-checkout',
  payment_checkout_url = 'https://livepix.gg/checkout/buyer-cancelled'
where payment_reference = 'discord:865000000000000101';

select *
from public.confirm_livepix_payment(
  'buyer-cancelled-checkout',
  'buyer-cancelled-proof',
  'buyer-cancelled-provider-reference',
  1000,
  'BRL',
  clock_timestamp(),
  repeat('a', 64)
);

do $$
declare
  v_order public.orders%rowtype;
  v_stock bigint;
begin
  select order_row.* into strict v_order
  from public.orders as order_row
  where order_row.payment_reference = 'discord:865000000000000101';

  select stock_quantity into strict v_stock
  from public.products
  where id = v_order.product_id;

  if v_order.status <> 'cancelled'
    or v_order.payment_status <> 'paid'
    or v_order.late_payment_detected_at is null
    or v_order.stock_committed_at is not null
    or v_stock <> 20 then
    raise exception 'delayed payment revived a buyer-cancelled order or consumed stock';
  end if;
end
$$;

do $$
begin
  if has_function_privilege(
      'anon',
      'public.cancel_discord_unpaid_order(uuid,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.cancel_discord_unpaid_order(uuid,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.cancel_discord_unpaid_order(uuid,text,text)',
      'EXECUTE'
    ) then
    raise exception 'buyer cancellation RPC privileges are unsafe';
  end if;
end
$$;

rollback;
