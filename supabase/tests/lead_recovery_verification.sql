-- Abandoned checkout recovery: eligibility, composition, ownership,
-- idempotency, deferred stock and a fresh LivePix order.

begin;

set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label)
values (
  'b1000000-0000-4000-8000-000000000001',
  '810000000000000001',
  'Lead recovery seller'
);

insert into public.games (id, name, slug, status)
values (
  'b2000000-0000-4000-8000-000000000001',
  'Lead Recovery Game',
  'lead-recovery-game',
  'active'
);

insert into public.substores (
  id, game_id, name, slug, title, description, status
)
values (
  'b3000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'Lead Recovery Store',
  'lead-recovery-store',
  'Lead Recovery Store',
  'Recovery verification fixture.',
  'active'
);

insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status
)
values
  (
    'b4000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'Recovery Product',
    'recovery-product',
    1000,
    10,
    'active'
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    'b3000000-0000-4000-8000-000000000001',
    'Late Payment Product',
    'late-payment-product',
    600,
    5,
    'active'
  );

insert into public.guilds (
  id, discord_guild_id, owner_discord_id, whitelist_entry_id, name, status
)
values (
  'b5000000-0000-4000-8000-000000000001',
  '850000000000000001',
  '810000000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'Lead Recovery Guild',
  'active'
);

update public.platform_settings
set
  lead_recovery_enabled = true,
  lead_recovery_discount_bps = 500,
  lead_recovery_delay_minutes = 15
where id = 1;

-- The unpaid source order does not reserve aggregate stock.
insert into public.orders (
  id,
  guild_id,
  seller_whitelist_entry_id,
  product_id,
  buyer_discord_id,
  quantity,
  status,
  currency_code,
  subtotal_price_cents,
  sale_price_cents,
  minimum_price_cents,
  discount_bps,
  discount_amount_cents,
  discount_reason,
  commission_bps,
  payment_reference,
  payment_provider,
  payment_provider_reference,
  payment_checkout_url,
  payment_status,
  payment_expires_at,
  created_at
)
values (
  'b6000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  '870000000000000001',
  1,
  'awaiting_payment',
  'BRL',
  1000,
  900,
  1000,
  1000,
  100,
  'server_booster',
  1000,
  'discord:860000000000000001',
  'livepix',
  'expired-checkout-reference',
  'https://livepix.gg/checkout/expired-reference',
  'pending',
  now() - interval '1 hour',
  now() - interval '3 hours'
);

select public.expire_unpaid_orders(10);

do $$
declare
  source public.orders%rowtype;
  claim record;
  accepted record;
  replayed record;
  conflicted record;
  confirmation record;
  ticket record;
  recovered public.orders%rowtype;
begin
  select * into strict source
  from public.orders
  where id = 'b6000000-0000-4000-8000-000000000001';

  if source.status <> 'cancelled'
    or source.payment_status <> 'cancelled'
    or source.stock_release_reason <> 'payment_timeout'
    or (
      select stock_quantity
      from public.products
      where id = 'b4000000-0000-4000-8000-000000000001'
    ) <> 10 then
    raise exception 'source checkout did not expire without consuming stock';
  end if;

  select * into strict claim
  from public.claim_lead_recovery_offers(
    'b7000000-0000-4000-8000-000000000001',
    25
  );

  if claim.source_order_id <> source.id
    or claim.original_sale_price_cents <> 900
    or claim.recovered_sale_price_cents <> 855
    or claim.discount_bps <> 500
    or jsonb_array_length(claim.items) <> 1 then
    raise exception 'recovery offer was not composed over the final source price';
  end if;

  if not public.complete_lead_recovery_delivery(
    claim.offer_id,
    'b7000000-0000-4000-8000-000000000001',
    '880000000000000001',
    '890000000000000001'
  ) then
    raise exception 'recovery DM was not confirmed';
  end if;

  begin
    perform public.finalize_lead_recovery_offer(
      claim.offer_id,
      '870000000000000002',
      true,
      '890000000000000002'
    );
    raise exception 'another Discord user accepted the recovery';
  exception
    when insufficient_privilege then null;
  end;

  select * into strict accepted
  from public.finalize_lead_recovery_offer(
    claim.offer_id,
    '870000000000000001',
    true,
    '890000000000000003'
  );

  if not accepted.was_created
    or accepted.out_of_stock
    or accepted.offer_expired
    or accepted.offer_invalidated
    or accepted.decision_conflict
    or accepted.checkout_order_id is null then
    raise exception 'accepting the recovery did not create an order';
  end if;

  select * into strict recovered
  from public.orders
  where id = accepted.checkout_order_id;

  if recovered.status <> 'awaiting_payment'
    or recovered.payment_status <> 'uninitialized'
    or recovered.payment_provider_reference is not null
    or recovered.payment_checkout_url is not null
    or recovered.payment_reference <> 'lead-recovery:' || claim.offer_id::text
    or recovered.lead_recovery_source_order_id <> source.id
    or recovered.lead_recovery_offer_id <> claim.offer_id
    or recovered.subtotal_price_cents <> 1000
    or recovered.sale_price_cents <> 855
    or recovered.discount_amount_cents <> 145
    or recovered.discount_bps <> 1000
    or recovered.lead_recovery_discount_bps <> 500
    or recovered.lead_recovery_discount_amount_cents <> 45
    or recovered.discount_reason <> 'server_booster'
    or (
      select sale_price_cents
      from public.order_items
      where order_id = recovered.id
    ) <> 855
    or (
      select stock_quantity
      from public.products
      where id = 'b4000000-0000-4000-8000-000000000001'
    ) <> 10 then
    raise exception 'recovered order totals, fresh checkout state or stock are inconsistent';
  end if;

  perform public.claim_livepix_checkout(
    recovered.id,
    'ba000000-0000-4000-8000-000000000001'
  );
  perform public.register_claimed_livepix_checkout(
    recovered.id,
    'ba000000-0000-4000-8000-000000000001',
    'recovery-livepix-reference',
    'https://livepix.gg/checkout/recovery-livepix-reference',
    null
  );
  select * into strict confirmation
  from public.confirm_livepix_payment(
    'recovery-livepix-payment',
    'recovery-livepix-proof',
    'recovery-livepix-reference',
    855,
    'BRL',
    now(),
    repeat('a', 64)
  );
  if confirmation.processed_order_id <> recovered.id
    or confirmation.resulting_order_status <> 'paid'
    or confirmation.paid_amount_cents <> 855
    or not confirmation.first_confirmation then
    raise exception 'the fresh recovery checkout could not be paid normally';
  end if;

  select * into strict ticket
  from public.claim_discord_ticket(recovered.id);
  if not ticket.claimed
    or ticket.buyer_discord_id <> '870000000000000001'
    or ticket.paid_amount_cents <> 855
    or ticket.order_quantity <> 1
    or ticket.product_name not like '%Recovery Product%' then
    raise exception 'the paid recovery order was not eligible for a normal Discord ticket';
  end if;

  select * into strict replayed
  from public.finalize_lead_recovery_offer(
    claim.offer_id,
    '870000000000000001',
    true,
    '890000000000000004'
  );
  if replayed.was_created
    or replayed.checkout_order_id <> recovered.id
    or (
      select stock_quantity
      from public.products
      where id = 'b4000000-0000-4000-8000-000000000001'
    ) <> 9 then
    raise exception 'replayed recovery acceptance duplicated order or stock';
  end if;

  select * into strict conflicted
  from public.finalize_lead_recovery_offer(
    claim.offer_id,
    '870000000000000001',
    false,
    '890000000000000005'
  );
  if not conflicted.decision_conflict then
    raise exception 'opposite recovery decision did not conflict';
  end if;
end
$$;

update public.products
set stock_quantity = 5
where id = 'b4000000-0000-4000-8000-000000000002';

insert into public.orders (
  id,
  guild_id,
  seller_whitelist_entry_id,
  product_id,
  buyer_discord_id,
  quantity,
  status,
  currency_code,
  subtotal_price_cents,
  sale_price_cents,
  minimum_price_cents,
  discount_bps,
  discount_amount_cents,
  discount_reason,
  commission_bps,
  payment_reference,
  payment_provider,
  payment_provider_reference,
  payment_checkout_url,
  payment_status,
  payment_expires_at,
  created_at
)
values (
  'b6000000-0000-4000-8000-000000000002',
  'b5000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000002',
  '870000000000000002',
  1,
  'awaiting_payment',
  'BRL',
  600,
  600,
  600,
  0,
  0,
  null,
  1000,
  'discord:860000000000000002',
  'livepix',
  'late-checkout-reference',
  'https://livepix.gg/checkout/late-reference',
  'pending',
  now() - interval '1 hour',
  now() - interval '3 hours'
);

select public.expire_unpaid_orders(10);

do $$
declare
  claim record;
  late_confirmation record;
  invalidated record;
begin
  select * into strict claim
  from public.claim_lead_recovery_offers(
    'b7000000-0000-4000-8000-000000000002',
    25
  );
  perform public.complete_lead_recovery_delivery(
    claim.offer_id,
    'b7000000-0000-4000-8000-000000000002',
    '880000000000000002',
    '890000000000000010'
  );

  select * into strict late_confirmation
  from public.confirm_livepix_payment(
    'late-livepix-payment',
    'late-livepix-proof',
    'late-checkout-reference',
    600,
    'BRL',
    now(),
    repeat('b', 64)
  );
  if late_confirmation.resulting_order_status <> 'cancelled'
    or (
      select late_payment_detected_at
      from public.orders
      where id = 'b6000000-0000-4000-8000-000000000002'
    ) is null then
    raise exception 'late source payment was not recorded safely';
  end if;

  select * into strict invalidated
  from public.finalize_lead_recovery_offer(
    claim.offer_id,
    '870000000000000002',
    true,
    '890000000000000011'
  );

  if not invalidated.offer_invalidated
    or invalidated.checkout_order_id is not null
    or (
      select status
      from public.lead_recovery_offers
      where id = claim.offer_id
    ) <> 'invalidated'
    or (
      select stock_quantity
      from public.products
      where id = 'b4000000-0000-4000-8000-000000000002'
    ) <> 5 then
    raise exception 'late payment did not invalidate recovery before reserving stock';
  end if;
end
$$;

do $$
begin
  begin
    update public.platform_settings
    set lead_recovery_discount_bps = 501
    where id = 1;
    raise exception 'platform accepted a recovery discount above 5 percent';
  exception
    when check_violation then null;
  end;

  if has_table_privilege('anon', 'public.lead_recovery_offers', 'select')
    or has_table_privilege('authenticated', 'public.lead_recovery_offers', 'select')
    or has_table_privilege('service_role', 'public.lead_recovery_offers', 'select') then
    raise exception 'recovery offer rows are directly readable';
  end if;

  if has_function_privilege(
    'anon',
    'public.finalize_lead_recovery_offer(uuid,text,boolean,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.finalize_lead_recovery_offer(uuid,text,boolean,text)',
    'execute'
  ) then
    raise exception 'untrusted database roles can finalize recovery offers';
  end if;
end
$$;

rollback;

select 'Lead recovery verification passed' as result;
