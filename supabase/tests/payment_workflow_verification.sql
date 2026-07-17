-- Transactional verification for LivePix checkout registration, reconciled
-- payment confirmation and post-payment Discord tickets.

begin;

set local client_min_messages = warning;

do $$
begin
  if not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'payment_webhook_events'
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'payment_webhook_events is missing forced RLS';
  end if;

  if (
    select count(distinct routine.proname)
    from pg_proc as routine
    join pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname in (
        'register_livepix_checkout',
        'confirm_livepix_payment',
        'create_bot_order_with_reservation',
        'claim_discord_ticket',
        'complete_discord_ticket',
        'fail_discord_ticket'
      )
      and routine.prosecdef
  ) <> 6 then
    raise exception 'LivePix or Discord ticket security-definer RPCs are missing';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges as privilege
    where privilege.routine_schema = 'public'
      and privilege.routine_name in (
        'register_livepix_checkout',
        'confirm_livepix_payment',
        'create_bot_order_with_reservation',
        'claim_discord_ticket',
        'complete_discord_ticket',
        'fail_discord_ticket'
      )
      and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'untrusted roles can execute a LivePix RPC';
  end if;
end
$$;

insert into public.whitelist_entries (
  id,
  discord_id,
  label,
  is_active
)
values (
  '60000000-0000-4000-8000-000000000001',
  '610000000000000002',
  'LivePix test seller',
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
  '61000000-0000-4000-8000-000000000001',
  '610000000000000001',
  '610000000000000002',
  '60000000-0000-4000-8000-000000000001',
  'LivePix integration guild',
  'active'
);

insert into public.inventory_batches (
  id,
  product_id,
  source,
  import_method,
  unit_count
)
select
  '61500000-0000-4000-8000-000000000001',
  product.id,
  'livepix-test',
  'manual',
  2
from public.products as product
where product.slug = '2x-moon-bloom'
  and product.archived_at is null;

update public.products
set stock_quantity = 2
where slug = '2x-moon-bloom'
  and archived_at is null;

insert into public.inventory_units (
  id,
  product_id,
  batch_id,
  encrypted_payload,
  iv,
  auth_tag,
  fingerprint,
  status
)
select
  fixture.id,
  product.id,
  '61500000-0000-4000-8000-000000000001',
  decode('01', 'hex'),
  decode(repeat('00', 12), 'hex'),
  decode(repeat('00', 16), 'hex'),
  decode(repeat(fixture.fingerprint_byte, 32), 'hex'),
  'available'
from public.products as product
cross join (
  values
    ('61600000-0000-4000-8000-000000000001'::uuid, '01'::text),
    ('61600000-0000-4000-8000-000000000002'::uuid, '02'::text)
) as fixture(id, fingerprint_byte)
where product.slug = '2x-moon-bloom'
  and product.archived_at is null;

select *
from public.create_bot_order_with_reservation(
  '620000000000000101',
  '61000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  (select id from public.products where slug = '2x-moon-bloom' and archived_at is null),
  '620000000000000001',
  1,
  100,
  3000
);

update public.orders
set id = '62000000-0000-4000-8000-000000000001'
where payment_reference = 'discord:620000000000000101';

do $$
declare
  v_result record;
begin
  if (
    select count(*) from public.orders
    where id = '62000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'LivePix order fixture was not created';
  end if;

  if not exists (
    select 1
    from public.orders as order_row
    join public.products as product on product.id = order_row.product_id
    where order_row.id = '62000000-0000-4000-8000-000000000001'
      and order_row.quantity = 1
      and order_row.inventory_unit_id is null
      and product.stock_quantity = 1
  ) then
    raise exception 'bot order did not atomically reserve aggregate stock';
  end if;

  select *
  into strict v_result
  from public.register_livepix_checkout(
    '62000000-0000-4000-8000-000000000001',
    'livepix-reference-1',
    'https://checkout.livepix.example/1',
    null
  );

  if v_result.registered_order_id <> '62000000-0000-4000-8000-000000000001'
    or v_result.provider_reference <> 'livepix-reference-1'
    or not v_result.was_created then
    raise exception 'first LivePix checkout registration returned an invalid result';
  end if;

  select *
  into strict v_result
  from public.register_livepix_checkout(
    '62000000-0000-4000-8000-000000000001',
    'livepix-reference-1',
    'https://checkout.livepix.example/1',
    null
  );

  if v_result.was_created then
    raise exception 'LivePix checkout registration was not idempotent';
  end if;

  if not exists (
    select 1
    from public.orders
    where id = '62000000-0000-4000-8000-000000000001'
      and payment_reference = 'discord:620000000000000101'
      and payment_provider_reference = 'livepix-reference-1'
      and payment_checkout_url = 'https://checkout.livepix.example/1'
      and payment_status = 'pending'
      and status = 'awaiting_payment'
  ) then
    raise exception 'registered LivePix checkout was not persisted correctly';
  end if;

  begin
    perform public.register_livepix_checkout(
      '62000000-0000-4000-8000-000000000001',
      'livepix-reference-1',
      'https://checkout.livepix.example/different',
      null
    );
    raise exception 'checkout registration accepted different data for the same order';
  exception
    when data_exception then null;
  end;

  begin
    update public.orders
    set
      discord_ticket_status = 'open',
      discord_ticket_channel_id = '620000000000000011'
    where id = '62000000-0000-4000-8000-000000000001';
    raise exception 'an unpaid order accepted a Discord ticket channel';
  exception
    when check_violation then null;
  end;
end
$$;

do $$
declare
  v_result record;
  v_updated_at timestamptz;
begin
  begin
    perform public.confirm_livepix_payment(
      'livepix-checkout-wrong-amount',
      'livepix-proof-wrong-amount',
      'livepix-reference-1',
      999999,
      'BRL',
      '2026-07-16 12:00:00+00'::timestamptz,
      repeat('9', 64)
    );
    raise exception 'LivePix confirmation accepted a mismatched amount';
  exception
    when data_exception then null;
  end;

  if exists (
    select 1 from public.payment_webhook_events
    where provider_checkout_id = 'livepix-checkout-wrong-amount'
  ) then
    raise exception 'failed amount validation left a claimed event behind';
  end if;

  select *
  into strict v_result
  from public.confirm_livepix_payment(
    'livepix-checkout-1',
    'livepix-proof-1',
    'livepix-reference-1',
    100,
    'BRL',
    '2026-07-16 12:00:00+00'::timestamptz,
    repeat('a', 64)
  );

  if v_result.processed_order_id <> '62000000-0000-4000-8000-000000000001'
    or v_result.discord_guild_id <> '610000000000000001'
    or v_result.buyer_discord_id <> '620000000000000001'
    or v_result.product_name <> '2x Moon Bloom'
    or v_result.paid_amount_cents <> 100
    or v_result.resulting_order_status <> 'paid'
    or not v_result.first_confirmation
    or v_result.existing_ticket_channel_id is not null
    or v_result.ticket_status <> 'not_created' then
    raise exception 'first reconciled LivePix confirmation returned an invalid result';
  end if;

  if not exists (
    select 1
    from public.orders
    where id = '62000000-0000-4000-8000-000000000001'
      and status = 'paid'
      and payment_provider = 'livepix'
      and payment_provider_reference = 'livepix-reference-1'
      and payment_provider_checkout_id = 'livepix-checkout-1'
      and payment_provider_proof_id = 'livepix-proof-1'
      and payment_provider_created_at = '2026-07-16 12:00:00+00'::timestamptz
      and payment_status = 'paid'
      and paid_at is not null
  ) then
    raise exception 'reconciled LivePix confirmation did not persist payment state';
  end if;

  if (
    select count(*)
    from public.ledger_entries
    where order_id = '62000000-0000-4000-8000-000000000001'
      and (
        (kind = 'sale_profit' and amount_cents = 70)
        or (kind = 'commission' and amount_cents = 30)
      )
  ) <> 2 then
    raise exception 'paid order did not create profit and commission ledger entries';
  end if;

  if not exists (
    select 1
    from public.whitelist_balances
    where whitelist_entry_id = '60000000-0000-4000-8000-000000000001'
      and balance_cents = 70
      and pending_balance_cents = 70
      and total_profit_cents = 70
  ) then
    raise exception 'seller balance did not exclude platform commission';
  end if;

  select updated_at
  into strict v_updated_at
  from public.orders
  where id = '62000000-0000-4000-8000-000000000001';

  -- The hash may differ because JSON formatting can differ. Material GET fields
  -- remain authoritative and the same checkout still confirms only once.
  select *
  into strict v_result
  from public.confirm_livepix_payment(
    'livepix-checkout-1',
    'livepix-proof-1',
    'livepix-reference-1',
    100,
    'BRL',
    '2026-07-16 12:00:00+00'::timestamptz,
    repeat('b', 64)
  );

  if v_result.first_confirmation then
    raise exception 'duplicate LivePix confirmation was treated as new';
  end if;

  if (
    select updated_at from public.orders
    where id = '62000000-0000-4000-8000-000000000001'
  ) <> v_updated_at then
    raise exception 'duplicate LivePix confirmation rewrote the order';
  end if;

  if (
    select count(*) from public.payment_webhook_events
    where provider_checkout_id = 'livepix-checkout-1'
      and order_id = '62000000-0000-4000-8000-000000000001'
      and processed_at is not null
      and state_changed
  ) <> 1 then
    raise exception 'LivePix checkout confirmation was not recorded exactly once';
  end if;

  if (
    select count(*) from public.ledger_entries
    where order_id = '62000000-0000-4000-8000-000000000001'
      and kind in ('sale_profit', 'commission')
  ) <> 2 then
    raise exception 'duplicate LivePix confirmation duplicated financial entries';
  end if;

  begin
    perform public.confirm_livepix_payment(
      'livepix-checkout-1',
      'different-proof',
      'livepix-reference-1',
      100,
      'BRL',
      '2026-07-16 12:00:00+00'::timestamptz,
      repeat('c', 64)
    );
    raise exception 'checkout ID accepted different reconciled material data';
  exception
    when data_exception then null;
  end;

  begin
    perform public.confirm_livepix_payment(
      'livepix-checkout-unknown',
      'livepix-proof-unknown',
      'livepix-reference-unknown',
      100,
      'BRL',
      '2026-07-16 12:00:01+00'::timestamptz,
      repeat('d', 64)
    );
    raise exception 'unknown LivePix reference was accepted';
  exception
    when no_data_found then null;
  end;

  if exists (
    select 1 from public.payment_webhook_events
    where provider_checkout_id = 'livepix-checkout-unknown'
  ) then
    raise exception 'unknown checkout left a claimed event behind';
  end if;
end
$$;

do $$
declare
  v_claim record;
  v_complete record;
begin
  select * into strict v_claim
  from public.claim_discord_ticket('62000000-0000-4000-8000-000000000001');

  if not v_claim.claimed
    or v_claim.discord_guild_id <> '610000000000000001'
    or v_claim.buyer_discord_id <> '620000000000000001'
    or v_claim.product_name <> '2x Moon Bloom'
    or v_claim.paid_amount_cents <> 100
    or v_claim.ticket_status <> 'creating'
    or v_claim.existing_channel_id is not null then
    raise exception 'paid Discord ticket claim returned invalid data';
  end if;

  select * into strict v_claim
  from public.claim_discord_ticket('62000000-0000-4000-8000-000000000001');
  if v_claim.claimed or v_claim.ticket_status <> 'creating' then
    raise exception 'active Discord ticket lease was claimed twice';
  end if;

  select * into strict v_complete
  from public.complete_discord_ticket(
    '62000000-0000-4000-8000-000000000001',
    '620000000000000011'
  );
  if not v_complete.was_completed
    or v_complete.channel_id <> '620000000000000011' then
    raise exception 'Discord ticket completion returned invalid data';
  end if;

  select * into strict v_complete
  from public.complete_discord_ticket(
    '62000000-0000-4000-8000-000000000001',
    '620000000000000011'
  );
  if v_complete.was_completed then
    raise exception 'Discord ticket completion was not idempotent';
  end if;
end
$$;

select *
from public.create_bot_order_with_reservation(
  '620000000000000102',
  '61000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  (select id from public.products where slug = '2x-moon-bloom' and archived_at is null),
  '620000000000000002',
  1,
  100,
  3000
);

update public.orders
set id = '62000000-0000-4000-8000-000000000002'
where payment_reference = 'discord:620000000000000102';

do $$
declare
  v_result record;
begin
  select * into strict v_result
  from public.create_bot_order_with_reservation(
    '620000000000000103',
    '61000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    (select id from public.products where slug = '2x-moon-bloom' and archived_at is null),
    '620000000000000003',
    1,
    100,
    3000
  );
  if not v_result.out_of_stock or v_result.created_order_id is not null then
    raise exception 'atomic reservation allowed overselling the last unit';
  end if;
end
$$;

do $$
declare
  v_claim record;
  v_failed record;
begin
  begin
    perform public.register_livepix_checkout(
      '62000000-0000-4000-8000-000000000002',
      'livepix-reference-1',
      'https://checkout.livepix.example/2',
      null
    );
    raise exception 'two orders accepted the same LivePix reference';
  exception
    when data_exception or unique_violation then null;
  end;

  update public.orders
  set
    status = 'paid',
    payment_status = 'paid',
    paid_at = now()
  where id = '62000000-0000-4000-8000-000000000002';

  select * into strict v_claim
  from public.claim_discord_ticket('62000000-0000-4000-8000-000000000002');
  if not v_claim.claimed then
    raise exception 'second paid order could not claim its Discord ticket';
  end if;

  select * into strict v_failed
  from public.fail_discord_ticket('62000000-0000-4000-8000-000000000002');
  if not v_failed.was_failed then
    raise exception 'failed Discord ticket claim was not released';
  end if;

  select * into strict v_claim
  from public.claim_discord_ticket('62000000-0000-4000-8000-000000000002');
  if not v_claim.claimed then
    raise exception 'failed Discord ticket could not be retried';
  end if;

  update public.orders
  set discord_ticket_claimed_at = now() - interval '10 minutes'
  where id = '62000000-0000-4000-8000-000000000002';

  select * into strict v_claim
  from public.claim_discord_ticket('62000000-0000-4000-8000-000000000002');
  if not v_claim.claimed then
    raise exception 'stale Discord ticket lease was not reclaimed';
  end if;

  begin
    perform public.complete_discord_ticket(
      '62000000-0000-4000-8000-000000000002',
      '620000000000000011'
    );
    raise exception 'two orders accepted the same Discord ticket channel';
  exception
    when unique_violation then null;
  end;
end
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.create_bot_order_with_reservation(
      '620000000000000104',
      '61000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      (select id from public.products where slug = '2x-moon-bloom' and archived_at is null),
      '620000000000000004',
      1,
      100,
      3000
    );
    raise exception 'authenticated unexpectedly executed create_bot_order_with_reservation';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.register_livepix_checkout(
      '62000000-0000-4000-8000-000000000001',
      'untrusted-reference',
      'https://checkout.livepix.example/untrusted',
      null
    );
    raise exception 'authenticated unexpectedly executed register_livepix_checkout';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.confirm_livepix_payment(
      'untrusted-checkout',
      'untrusted-proof',
      'livepix-reference-1',
      100,
      'BRL',
      now(),
      repeat('e', 64)
    );
    raise exception 'authenticated unexpectedly executed confirm_livepix_payment';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.claim_discord_ticket('62000000-0000-4000-8000-000000000001');
    raise exception 'authenticated unexpectedly executed claim_discord_ticket';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.complete_discord_ticket(
      '62000000-0000-4000-8000-000000000001',
      '620000000000000011'
    );
    raise exception 'authenticated unexpectedly executed complete_discord_ticket';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.fail_discord_ticket('62000000-0000-4000-8000-000000000001');
    raise exception 'authenticated unexpectedly executed fail_discord_ticket';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

rollback;

select 'LivePix payment workflow verification passed' as result;
