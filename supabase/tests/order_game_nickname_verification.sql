-- Transactional verification for paid-ticket in-game nickname persistence.

begin;

set local client_min_messages = warning;

insert into public.games (
  id,
  name,
  slug,
  status
)
values (
  '71000000-0000-4000-8000-000000000001',
  'Nickname verification game',
  'nickname-verification-game',
  'active'
);

insert into public.substores (
  id,
  game_id,
  name,
  slug,
  title,
  status
)
values (
  '71000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000001',
  'Nickname verification store',
  'nickname-verification-store',
  'Nickname verification store',
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
  '71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000002',
  'Nickname verification product',
  'nickname-verification-product',
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
  '71000000-0000-4000-8000-000000000004',
  '710000000000000001',
  '710000000000000002',
  'Nickname verification guild',
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
values (
  '71000000-0000-4000-8000-000000000005',
  '71000000-0000-4000-8000-000000000004',
  '71000000-0000-4000-8000-000000000003',
  '710000000000000003',
  'paid',
  100,
  100,
  100,
  3000,
  'paid',
  now(),
  '710000000000000004',
  'open',
  now()
);

do $$
declare
  v_result record;
  v_submitted_at timestamptz;
begin
  select *
  into strict v_result
  from public.submit_paid_order_game_nickname(
    '71000000-0000-4000-8000-000000000005',
    '710000000000000003',
    '710000000000000001',
    '710000000000000004',
    '  SpeedyBR  '
  );

  if v_result.order_id <> '71000000-0000-4000-8000-000000000005'
    or v_result.game_nickname <> 'SpeedyBR'
    or not v_result.was_created
    or not v_result.was_changed then
    raise exception 'first game nickname submission returned invalid data';
  end if;

  select game_nickname_submitted_at
  into strict v_submitted_at
  from public.orders
  where id = '71000000-0000-4000-8000-000000000005'
    and game_nickname = 'SpeedyBR';

  if v_submitted_at is null then
    raise exception 'first game nickname submission was not persisted';
  end if;

  if not exists (
    select 1
    from public.audit_events
    where entity_type = 'order'
      and entity_id = '71000000-0000-4000-8000-000000000005'
      and actor_discord_user_id = '710000000000000003'
      and action = 'bot.order.game_nickname.set'
      and metadata = jsonb_build_object(
        'discord_ticket_channel_id', '710000000000000004',
        'discord_guild_id', '710000000000000001',
        'source', 'discord_http_interaction'
      )
      and not (metadata ? 'game_nickname')
  ) then
    raise exception 'first game nickname submission audit is invalid';
  end if;

  select *
  into strict v_result
  from public.submit_paid_order_game_nickname(
    '71000000-0000-4000-8000-000000000005',
    '710000000000000003',
    '710000000000000001',
    '710000000000000004',
    'SpeedyBR'
  );

  if v_result.was_created or v_result.was_changed then
    raise exception 'identical game nickname submission was not idempotent';
  end if;

  if (
    select count(*)
    from public.audit_events
    where entity_type = 'order'
      and entity_id = '71000000-0000-4000-8000-000000000005'
      and action like 'bot.order.game_nickname.%'
  ) <> 1 then
    raise exception 'identical game nickname submission duplicated its audit';
  end if;

  select *
  into strict v_result
  from public.submit_paid_order_game_nickname(
    '71000000-0000-4000-8000-000000000005',
    '710000000000000003',
    '710000000000000001',
    '710000000000000004',
    'SpeedyBR2'
  );

  if v_result.game_nickname <> 'SpeedyBR2'
    or v_result.was_created
    or not v_result.was_changed then
    raise exception 'updated game nickname submission returned invalid data';
  end if;

  if not exists (
    select 1
    from public.audit_events
    where entity_type = 'order'
      and entity_id = '71000000-0000-4000-8000-000000000005'
      and actor_discord_user_id = '710000000000000003'
      and action = 'bot.order.game_nickname.update'
      and not (metadata ? 'game_nickname')
  ) then
    raise exception 'updated game nickname submission audit is invalid';
  end if;

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      '710000000000000003',
      '710000000000000001',
      '710000000000000004',
      'x'
    );
    raise exception 'one-character game nickname was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      '710000000000000003',
      '710000000000000001',
      '710000000000000004',
      E'Bad\nNick'
    );
    raise exception 'control character in game nickname was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      '710000000000000099',
      '710000000000000001',
      '710000000000000004',
      'WrongBuyer'
    );
    raise exception 'different Discord buyer updated the game nickname';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      '710000000000000003',
      '710000000000000099',
      '710000000000000004',
      'WrongGuild'
    );
    raise exception 'different Discord guild updated the game nickname';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      '710000000000000003',
      '710000000000000001',
      '710000000000000099',
      'WrongChannel'
    );
    raise exception 'different Discord ticket channel updated the game nickname';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000099',
      '710000000000000003',
      '710000000000000001',
      '710000000000000004',
      'MissingOrder'
    );
    raise exception 'missing order accepted a game nickname';
  exception
    when no_data_found then null;
  end;

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      'invalid-id',
      '710000000000000001',
      '710000000000000004',
      'InvalidId'
    );
    raise exception 'invalid Discord ID was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  update public.orders
  set payment_status = 'pending'
  where id = '71000000-0000-4000-8000-000000000005';

  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      '710000000000000003',
      '710000000000000001',
      '710000000000000004',
      'UnpaidState'
    );
    raise exception 'unpaid order state accepted a game nickname';
  exception
    when data_exception then null;
  end;
end
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.submit_paid_order_game_nickname(
      '71000000-0000-4000-8000-000000000005',
      '710000000000000003',
      '710000000000000001',
      '710000000000000004',
      'UntrustedRole'
    );
    raise exception 'authenticated unexpectedly executed submit_paid_order_game_nickname';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

rollback;

select 'Paid order game nickname verification passed' as result;
