-- Transactional verification for Discord 404 ticket reconciliation.
-- Safe to run against a linked project: every fixture is rolled back.

begin;

set local client_min_messages = warning;

insert into public.games (id, name, slug, status)
values (
  '75000000-0000-4000-8000-000000000001',
  'Missing ticket reconciliation verification game',
  'missing-ticket-reconciliation-verification-game',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '75000000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000001',
  'Missing ticket reconciliation verification store',
  'missing-ticket-reconciliation-verification-store',
  'Missing ticket reconciliation verification store',
  'active'
);

insert into public.products (
  id,
  substore_id,
  name,
  slug,
  minimum_price_cents,
  status
)
values (
  '75000000-0000-4000-8000-000000000003',
  '75000000-0000-4000-8000-000000000002',
  'Missing ticket reconciliation verification product',
  'missing-ticket-reconciliation-verification-product',
  100,
  'active'
);

insert into public.guilds (
  id,
  discord_guild_id,
  owner_discord_id,
  name,
  status
)
values (
  '75000000-0000-4000-8000-000000000004',
  '750000000000000001',
  '750000000000000002',
  'Missing ticket reconciliation verification guild',
  'active'
);

insert into public.orders (
  id,
  guild_id,
  product_id,
  buyer_discord_id,
  status,
  subtotal_price_cents,
  sale_price_cents,
  minimum_price_cents,
  commission_bps,
  payment_status,
  paid_at,
  discord_ticket_channel_id,
  discord_ticket_status,
  discord_ticket_claimed_at,
  discord_ticket_close_claim_token,
  discord_ticket_close_claimed_at,
  discord_ticket_close_claimed_by_discord_user_id
)
values
  (
    '75000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000004',
    '75000000-0000-4000-8000-000000000003',
    '750000000000000003',
    'paid',
    100,
    100,
    100,
    3000,
    'paid',
    now(),
    '750000000000000004',
    'open',
    now(),
    null,
    null,
    null
  ),
  (
    '75000000-0000-4000-8000-000000000006',
    '75000000-0000-4000-8000-000000000004',
    '75000000-0000-4000-8000-000000000003',
    '750000000000000005',
    'paid',
    100,
    100,
    100,
    3000,
    'paid',
    now(),
    '750000000000000006',
    'open',
    now(),
    '75000000-0000-4000-8000-000000000010',
    now() - interval '6 minutes',
    '385924725332901909'
  );

do $$
begin
  if has_function_privilege(
    'public',
    'public.reconcile_missing_discord_ticket(uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.reconcile_missing_discord_ticket(uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.reconcile_missing_discord_ticket(uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.reconcile_missing_discord_ticket(uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'Missing Discord ticket reconciliation RPC privileges are invalid';
  end if;
end
$$;

do $$
begin
  begin
    perform public.reconcile_missing_discord_ticket(
      '75000000-0000-4000-8000-000000000005',
      'invalid-channel'
    );
    raise exception 'an invalid Discord channel ID was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.reconcile_missing_discord_ticket(
      '75000000-0000-4000-8000-000000000005',
      '750000000000000099'
    );
    raise exception 'a mismatched Discord channel reconciled an order';
  exception
    when insufficient_privilege then null;
  end;

  if not exists (
    select 1
    from public.orders
    where id = '75000000-0000-4000-8000-000000000005'
      and discord_ticket_status = 'open'
      and discord_ticket_closed_at is null
  ) then
    raise exception 'a failed channel reconciliation mutated the order';
  end if;
end
$$;

do $$
declare
  v_result record;
  v_audit_count integer;
begin
  select * into strict v_result
  from public.reconcile_missing_discord_ticket(
    '75000000-0000-4000-8000-000000000005',
    '750000000000000004'
  );

  if not v_result.was_closed
    or v_result.ticket_status <> 'closed'
    or v_result.ticket_channel_id <> '750000000000000004'
    or v_result.closed_at is null
    or v_result.closed_by_discord_user_id is not null then
    raise exception 'missing ticket without a claim was not reconciled correctly';
  end if;

  if exists (
    select 1
    from public.orders
    where id = '75000000-0000-4000-8000-000000000005'
      and (
        discord_ticket_close_claim_token is not null
        or discord_ticket_close_claimed_at is not null
        or discord_ticket_close_claimed_by_discord_user_id is not null
      )
  ) then
    raise exception 'reconciliation without a claim retained close lease state';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.reconcile_missing'
    and entity_type = 'order'
    and entity_id = '75000000-0000-4000-8000-000000000005'
    and actor_discord_user_id is null
    and metadata @> jsonb_build_object(
      'discord_guild_id', '750000000000000001',
      'discord_ticket_channel_id', '750000000000000004',
      'source', 'discord_api_unknown_channel_10003',
      'had_claim', false
    );
  if v_audit_count <> 1 then
    raise exception 'unclaimed missing ticket reconciliation audit is invalid';
  end if;

  select * into strict v_result
  from public.reconcile_missing_discord_ticket(
    '75000000-0000-4000-8000-000000000005',
    '750000000000000004'
  );

  if v_result.was_closed
    or v_result.ticket_status <> 'closed'
    or v_result.closed_at is null
    or v_result.closed_by_discord_user_id is not null then
    raise exception 'missing ticket reconciliation was not idempotent';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.reconcile_missing'
    and entity_id = '75000000-0000-4000-8000-000000000005';
  if v_audit_count <> 1 then
    raise exception 'idempotent reconciliation duplicated its audit';
  end if;
end
$$;

do $$
declare
  v_result record;
  v_audit_count integer;
begin
  select * into strict v_result
  from public.reconcile_missing_discord_ticket(
    '75000000-0000-4000-8000-000000000006',
    '750000000000000006'
  );

  if not v_result.was_closed
    or v_result.ticket_status <> 'closed'
    or v_result.closed_at is null
    or v_result.closed_by_discord_user_id <> '385924725332901909' then
    raise exception 'claimed missing ticket was not reconciled with its actor';
  end if;

  if exists (
    select 1
    from public.orders
    where id = '75000000-0000-4000-8000-000000000006'
      and (
        discord_ticket_close_claim_token is not null
        or discord_ticket_close_claimed_at is not null
        or discord_ticket_close_claimed_by_discord_user_id is not null
      )
  ) then
    raise exception 'claimed missing ticket reconciliation retained its lease';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.reconcile_missing'
    and entity_type = 'order'
    and entity_id = '75000000-0000-4000-8000-000000000006'
    and actor_discord_user_id = '385924725332901909'
    and metadata @> jsonb_build_object(
      'discord_guild_id', '750000000000000001',
      'discord_ticket_channel_id', '750000000000000006',
      'source', 'discord_api_unknown_channel_10003',
      'had_claim', true
    );
  if v_audit_count <> 1 then
    raise exception 'claimed missing ticket reconciliation audit is invalid';
  end if;

  select * into strict v_result
  from public.reconcile_missing_discord_ticket(
    '75000000-0000-4000-8000-000000000006',
    '750000000000000006'
  );

  if v_result.was_closed
    or v_result.closed_by_discord_user_id <> '385924725332901909' then
    raise exception 'claimed missing ticket reconciliation was not idempotent';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.reconcile_missing'
    and entity_id = '75000000-0000-4000-8000-000000000006';
  if v_audit_count <> 1 then
    raise exception 'claimed idempotent reconciliation duplicated its audit';
  end if;
end
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.reconcile_missing_discord_ticket(
      '75000000-0000-4000-8000-000000000005',
      '750000000000000004'
    );
    raise exception 'authenticated unexpectedly reconciled a missing Discord ticket';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

rollback;

select 'Missing Discord ticket reconciliation verification passed' as result;
