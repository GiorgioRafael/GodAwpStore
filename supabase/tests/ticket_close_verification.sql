-- Transactional verification for authorized and terminal Discord ticket closing.
-- Safe to run against a linked project: every fixture and setting change is rolled back.

begin;

set local client_min_messages = warning;

update public.platform_settings
set ticket_close_admin_discord_user_ids = array[
  '234486394414825472',
  '385924725332901909',
  '911402638975844354'
]::text[]
where id = 1;

insert into public.games (id, name, slug, status)
values (
  '74000000-0000-4000-8000-000000000001',
  'Ticket close verification game',
  'ticket-close-verification-game',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000001',
  'Ticket close verification store',
  'ticket-close-verification-store',
  'Ticket close verification store',
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
  '74000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000002',
  'Ticket close verification product',
  'ticket-close-verification-product',
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
  '74000000-0000-4000-8000-000000000004',
  '740000000000000001',
  '740000000000000002',
  'Ticket close verification guild',
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
  discord_ticket_claimed_at
)
values
  (
    '74000000-0000-4000-8000-000000000005',
    '74000000-0000-4000-8000-000000000004',
    '74000000-0000-4000-8000-000000000003',
    '740000000000000003',
    'paid',
    100,
    100,
    100,
    3000,
    'paid',
    now(),
    '740000000000000004',
    'open',
    now()
  ),
  (
    '74000000-0000-4000-8000-000000000006',
    '74000000-0000-4000-8000-000000000004',
    '74000000-0000-4000-8000-000000000003',
    '740000000000000005',
    'paid',
    100,
    100,
    100,
    3000,
    'paid',
    now(),
    '740000000000000006',
    'open',
    now()
  );

do $$
begin
  if has_function_privilege(
    'anon',
    'public.claim_discord_ticket_close(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_discord_ticket_close(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.claim_discord_ticket_close(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.complete_discord_ticket_close(uuid,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_discord_ticket_close(uuid,text,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_discord_ticket_close(uuid,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.complete_discord_ticket_close(uuid,text,uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_discord_ticket_close(uuid,text,uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_discord_ticket_close(uuid,text,uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.renew_discord_ticket_close_claim(uuid,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.renew_discord_ticket_close_claim(uuid,text,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.renew_discord_ticket_close_claim(uuid,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.release_discord_ticket_close(uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.release_discord_ticket_close(uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.release_discord_ticket_close(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Discord ticket close RPC privileges are invalid';
  end if;
end
$$;

do $$
begin
  update public.platform_settings
  set ticket_close_admin_discord_user_ids = array[]::text[]
  where id = 1;

  begin
    perform public.claim_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000001',
      '740000000000000004',
      '234486394414825472',
      '74000000-0000-4000-8000-000000000010'
    );
    raise exception 'an empty administrator list still authorized a ticket close';
  exception
    when insufficient_privilege then null;
  end;

  update public.platform_settings
  set ticket_close_admin_discord_user_ids = array[
    '234486394414825472',
    '385924725332901909',
    '911402638975844354'
  ]::text[]
  where id = 1;

  begin
    perform public.claim_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000001',
      '740000000000000004',
      '740000000000000099',
      '74000000-0000-4000-8000-000000000011'
    );
    raise exception 'unauthorized Discord user acquired a ticket close lease';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.claim_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000099',
      '740000000000000004',
      '234486394414825472',
      '74000000-0000-4000-8000-000000000011'
    );
    raise exception 'mismatched Discord guild acquired a ticket close lease';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.claim_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000001',
      '740000000000000099',
      '234486394414825472',
      '74000000-0000-4000-8000-000000000011'
    );
    raise exception 'mismatched Discord channel acquired a ticket close lease';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
declare
  v_claim record;
  v_release record;
begin
  select * into strict v_claim
  from public.claim_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000001',
    '740000000000000004',
    '234486394414825472',
    '74000000-0000-4000-8000-000000000011'
  );

  if not v_claim.claimed
    or v_claim.already_closed
    or v_claim.ticket_status <> 'open'
    or v_claim.claim_token <> '74000000-0000-4000-8000-000000000011'::uuid
    or v_claim.claim_expires_at is null then
    raise exception 'valid Discord ticket close lease returned invalid data';
  end if;

  select * into strict v_claim
  from public.claim_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000001',
    '740000000000000004',
    '234486394414825472',
    '74000000-0000-4000-8000-000000000011'
  );
  if not v_claim.claimed
    or v_claim.claim_token <> '74000000-0000-4000-8000-000000000011'::uuid then
    raise exception 'same-token Discord ticket close claim was not idempotent';
  end if;

  select * into strict v_claim
  from public.claim_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000001',
    '740000000000000004',
    '385924725332901909',
    '74000000-0000-4000-8000-000000000012'
  );
  if v_claim.claimed or v_claim.claim_token is not null then
    raise exception 'concurrent Discord ticket close lease was exposed or acquired';
  end if;

  begin
    perform public.submit_paid_order_game_nickname(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000003',
      '740000000000000001',
      '740000000000000004',
      'BlockedWhileClosing'
    );
    raise exception 'game nickname changed during an active ticket close lease';
  exception
    when sqlstate '55000' then null;
  end;

  select * into strict v_release
  from public.release_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '74000000-0000-4000-8000-000000000099'
  );
  if v_release.released then
    raise exception 'mismatched token released a Discord ticket close lease';
  end if;

  select * into strict v_release
  from public.release_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '74000000-0000-4000-8000-000000000011'
  );
  if not v_release.released or v_release.ticket_status <> 'open' then
    raise exception 'matching token did not release a Discord ticket close lease';
  end if;

  if exists (
    select 1
    from public.orders
    where id = '74000000-0000-4000-8000-000000000005'
      and (
        discord_ticket_close_claim_token is not null
        or discord_ticket_close_claimed_at is not null
        or discord_ticket_close_claimed_by_discord_user_id is not null
      )
  ) then
    raise exception 'released Discord ticket close lease retained partial state';
  end if;
end
$$;

do $$
declare
  v_nickname record;
  v_claim record;
begin
  select * into strict v_nickname
  from public.submit_paid_order_game_nickname(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000003',
    '740000000000000001',
    '740000000000000004',
    'AllowedAfterRelease'
  );
  if not v_nickname.was_created or not v_nickname.was_changed then
    raise exception 'game nickname remained blocked after close lease release';
  end if;

  select * into strict v_claim
  from public.claim_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000001',
    '740000000000000004',
    '234486394414825472',
    '74000000-0000-4000-8000-000000000012'
  );
  if not v_claim.claimed then
    raise exception 'released Discord ticket could not be claimed again';
  end if;

  update public.orders
  set discord_ticket_close_claimed_at = statement_timestamp() - interval '6 minutes'
  where id = '74000000-0000-4000-8000-000000000005';

  select * into strict v_claim
  from public.claim_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000001',
    '740000000000000004',
    '385924725332901909',
    '74000000-0000-4000-8000-000000000013'
  );
  if not v_claim.claimed
    or v_claim.claim_token <> '74000000-0000-4000-8000-000000000013'::uuid then
    raise exception 'stale Discord ticket close lease was not reclaimed';
  end if;
end
$$;

do $$
declare
  v_complete record;
  v_claim record;
  v_ticket_claim record;
  v_audit_count integer;
begin
  begin
    perform public.complete_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000004',
      '74000000-0000-4000-8000-000000000012'
    );
    raise exception 'mismatched token completed a Discord ticket close';
  exception
    when insufficient_privilege then null;
  end;

  -- Durable reconciliation must be able to finish the exact token that is
  -- still stored even after its interactive lease window elapsed.
  update public.orders
  set discord_ticket_close_claimed_at = statement_timestamp() - interval '6 minutes'
  where id = '74000000-0000-4000-8000-000000000005'
    and discord_ticket_close_claim_token = '74000000-0000-4000-8000-000000000013';

  select * into strict v_complete
  from public.complete_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000004',
    '74000000-0000-4000-8000-000000000013'
  );

  if not v_complete.was_closed
    or v_complete.ticket_status <> 'closed'
    or v_complete.ticket_channel_id <> '740000000000000004'
    or v_complete.closed_at is null
    or v_complete.closed_by_discord_user_id <> '385924725332901909' then
    raise exception 'expired matching token did not complete the Discord ticket close';
  end if;

  if exists (
    select 1
    from public.orders
    where id = '74000000-0000-4000-8000-000000000005'
      and (
        discord_ticket_close_claim_token is not null
        or discord_ticket_close_claimed_at is not null
        or discord_ticket_close_claimed_by_discord_user_id is not null
      )
  ) then
    raise exception 'completed Discord ticket close retained its lease';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.close'
    and entity_type = 'order'
    and entity_id = '74000000-0000-4000-8000-000000000005'
    and actor_discord_user_id = '385924725332901909'
    and metadata @> jsonb_build_object(
      'discord_ticket_channel_id', '740000000000000004',
      'discord_guild_id', '740000000000000001',
      'source', 'discord_http_interaction'
    );
  if v_audit_count <> 1 then
    raise exception 'Discord ticket close audit was not recorded exactly once';
  end if;

  select * into strict v_complete
  from public.complete_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000004',
    '74000000-0000-4000-8000-000000000013'
  );
  if v_complete.was_closed then
    raise exception 'Discord ticket close completion was not idempotent';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.close'
    and entity_id = '74000000-0000-4000-8000-000000000005';
  if v_audit_count <> 1 then
    raise exception 'idempotent Discord ticket close duplicated its audit';
  end if;

  select * into strict v_claim
  from public.claim_discord_ticket_close(
    '74000000-0000-4000-8000-000000000005',
    '740000000000000001',
    '740000000000000004',
    '911402638975844354',
    '74000000-0000-4000-8000-000000000014'
  );
  if v_claim.claimed or not v_claim.already_closed or v_claim.ticket_status <> 'closed' then
    raise exception 'closed Discord ticket close claim was not terminal and idempotent';
  end if;

  select * into strict v_ticket_claim
  from public.claim_discord_ticket('74000000-0000-4000-8000-000000000005');
  if v_ticket_claim.claimed
    or v_ticket_claim.ticket_status <> 'closed'
    or v_ticket_claim.existing_channel_id <> '740000000000000004' then
    raise exception 'payment webhook retry attempted to reopen a closed Discord ticket';
  end if;

  begin
    perform public.complete_discord_ticket(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000004'
    );
    raise exception 'ticket creation completion reopened a closed Discord ticket';
  exception
    when data_exception then null;
  end;

  begin
    perform public.submit_paid_order_game_nickname(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000003',
      '740000000000000001',
      '740000000000000004',
      'BlockedAfterClose'
    );
    raise exception 'game nickname changed after the Discord ticket closed';
  exception
    when data_exception then null;
  end;

  begin
    update public.orders
    set discord_ticket_status = 'open'
    where id = '74000000-0000-4000-8000-000000000005';
    raise exception 'direct update reopened a closed Discord ticket';
  exception
    when sqlstate '55000' then null;
  end;
end
$$;

do $$
declare
  v_claim record;
  v_complete record;
  v_renew record;
  v_audit_count integer;
begin
  select * into strict v_claim
  from public.claim_discord_ticket_close(
    '74000000-0000-4000-8000-000000000006',
    '740000000000000001',
    '740000000000000006',
    '911402638975844354',
    '74000000-0000-4000-8000-000000000015'
  );

  if not v_claim.claimed then
    raise exception 'reconciliation-source ticket close lease was not acquired';
  end if;

  update public.orders
  set discord_ticket_close_claimed_at = statement_timestamp() - interval '6 minutes'
  where id = '74000000-0000-4000-8000-000000000006';

  begin
    perform public.renew_discord_ticket_close_claim(
      '74000000-0000-4000-8000-000000000006',
      '740000000000000006',
      '74000000-0000-4000-8000-000000000099'
    );
    raise exception 'reconciliation lease renewal accepted a mismatched token';
  exception
    when insufficient_privilege then null;
  end;

  select * into strict v_renew
  from public.renew_discord_ticket_close_claim(
    '74000000-0000-4000-8000-000000000006',
    '740000000000000006',
    '74000000-0000-4000-8000-000000000015'
  );

  if not v_renew.renewed
    or v_renew.active
    or v_renew.ticket_status <> 'open'
    or v_renew.ticket_channel_id <> '740000000000000006'
    or v_renew.claim_expires_at <= statement_timestamp() then
    raise exception 'reconciliation lease was not renewed atomically';
  end if;

  select * into strict v_renew
  from public.renew_discord_ticket_close_claim(
    '74000000-0000-4000-8000-000000000006',
    '740000000000000006',
    '74000000-0000-4000-8000-000000000015'
  );

  if v_renew.renewed
    or not v_renew.active
    or v_renew.claim_expires_at <= statement_timestamp() then
    raise exception 'an overlapping reconciliation renewed an active lease';
  end if;

  begin
    perform public.complete_discord_ticket_close(
      '74000000-0000-4000-8000-000000000006',
      '740000000000000006',
      '74000000-0000-4000-8000-000000000099',
      'discord_close_reconciliation'
    );
    raise exception 'source-aware completion accepted a mismatched claim token';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.complete_discord_ticket_close(
      '74000000-0000-4000-8000-000000000006',
      '740000000000000006',
      '74000000-0000-4000-8000-000000000015',
      'untrusted_reconciliation_source'
    );
    raise exception 'source-aware completion accepted an untrusted audit source';
  exception
    when invalid_parameter_value then null;
  end;

  select * into strict v_complete
  from public.complete_discord_ticket_close(
    '74000000-0000-4000-8000-000000000006',
    '740000000000000006',
    '74000000-0000-4000-8000-000000000015',
    'discord_close_reconciliation'
  );

  if not v_complete.was_closed
    or v_complete.ticket_status <> 'closed'
    or v_complete.ticket_channel_id <> '740000000000000006'
    or v_complete.closed_at is null
    or v_complete.closed_by_discord_user_id <> '911402638975844354' then
    raise exception 'source-aware reconciliation did not preserve the requested actor';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.close'
    and entity_type = 'order'
    and entity_id = '74000000-0000-4000-8000-000000000006'
    and actor_discord_user_id = '911402638975844354'
    and metadata @> jsonb_build_object(
      'discord_ticket_channel_id', '740000000000000006',
      'discord_guild_id', '740000000000000001',
      'source', 'discord_close_reconciliation'
    );
  if v_audit_count <> 1 then
    raise exception 'reconciliation completion audit source or actor is invalid';
  end if;

  select * into strict v_complete
  from public.complete_discord_ticket_close(
    '74000000-0000-4000-8000-000000000006',
    '740000000000000006',
    '74000000-0000-4000-8000-000000000015',
    'discord_close_reconciliation'
  );
  if v_complete.was_closed then
    raise exception 'source-aware reconciliation completion was not idempotent';
  end if;

  select * into strict v_complete
  from public.complete_discord_ticket_close(
    '74000000-0000-4000-8000-000000000006',
    '740000000000000006',
    '74000000-0000-4000-8000-000000000015'
  );
  if v_complete.was_closed then
    raise exception 'compatibility completion duplicated a reconciled close';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.close'
    and entity_id = '74000000-0000-4000-8000-000000000006';
  if v_audit_count <> 1 then
    raise exception 'idempotent completion paths duplicated the reconciliation audit';
  end if;

  if exists (
    select 1
    from public.audit_events
    where action = 'bot.order.ticket.close'
      and entity_id = '74000000-0000-4000-8000-000000000006'
      and metadata ->> 'source' <> 'discord_close_reconciliation'
  ) then
    raise exception 'idempotent compatibility completion rewrote the original audit source';
  end if;
end
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.claim_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000001',
      '740000000000000004',
      '234486394414825472',
      '74000000-0000-4000-8000-000000000020'
    );
    raise exception 'authenticated unexpectedly claimed a Discord ticket close';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.complete_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '740000000000000004',
      '74000000-0000-4000-8000-000000000020'
    );
    raise exception 'authenticated unexpectedly completed a Discord ticket close';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.complete_discord_ticket_close(
      '74000000-0000-4000-8000-000000000006',
      '740000000000000006',
      '74000000-0000-4000-8000-000000000020',
      'discord_close_reconciliation'
    );
    raise exception 'authenticated unexpectedly completed a source-aware Discord ticket close';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.renew_discord_ticket_close_claim(
      '74000000-0000-4000-8000-000000000006',
      '740000000000000006',
      '74000000-0000-4000-8000-000000000020'
    );
    raise exception 'authenticated unexpectedly renewed a Discord ticket close';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.release_discord_ticket_close(
      '74000000-0000-4000-8000-000000000005',
      '74000000-0000-4000-8000-000000000020'
    );
    raise exception 'authenticated unexpectedly released a Discord ticket close';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

rollback;

select 'Discord ticket close verification passed' as result;
