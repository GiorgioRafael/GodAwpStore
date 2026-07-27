-- Transactional verification for Discord delivery completion and the
-- thirty-minute automatic ticket-close queue.

begin;

set local client_min_messages = warning;

update public.platform_settings
set ticket_close_admin_discord_user_ids = array['234486394414825472']::text[]
where id = 1;

insert into public.games (id, name, slug, status)
values (
  '75000000-0000-4000-8000-000000000001',
  'Delivered ticket verification game',
  'delivered-ticket-verification-game',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '75000000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000001',
  'Delivered ticket verification store',
  'delivered-ticket-verification-store',
  'Delivered ticket verification store',
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
  'Delivered ticket verification product',
  'delivered-ticket-verification-product',
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
  'Delivered ticket verification guild',
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
    '75000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000004',
    '75000000-0000-4000-8000-000000000003',
    '750000000000000003',
    'processing',
    100,
    100,
    100,
    3000,
    'paid',
    now(),
    '750000000000000004',
    'open',
    now()
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
    now()
  );

do $$
begin
  if has_function_privilege(
    'anon',
    'public.complete_paid_order_discord_delivery(uuid,text,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_paid_order_discord_delivery(uuid,text,text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_paid_order_discord_delivery(uuid,text,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.claim_due_delivered_discord_ticket_closes(integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_due_delivered_discord_ticket_closes(integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.claim_due_delivered_discord_ticket_closes(integer)',
    'EXECUTE'
  ) then
    raise exception 'Discord delivered-ticket automation RPC privileges are invalid';
  end if;
end
$$;

do $$
begin
  begin
    perform public.complete_paid_order_discord_delivery(
      '75000000-0000-4000-8000-000000000005',
      '750000000000000001',
      '750000000000000004',
      '750000000000000099'
    );
    raise exception 'an unauthorized Discord user completed a delivery';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.complete_paid_order_discord_delivery(
      '75000000-0000-4000-8000-000000000005',
      '750000000000000099',
      '750000000000000004',
      '234486394414825472'
    );
    raise exception 'a mismatched Discord guild completed a delivery';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.complete_paid_order_discord_delivery(
      '75000000-0000-4000-8000-000000000005',
      '750000000000000001',
      '750000000000000099',
      '234486394414825472'
    );
    raise exception 'a mismatched Discord channel completed a delivery';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
declare
  v_first record;
  v_retry record;
  v_audit_count integer;
begin
  select * into strict v_first
  from public.complete_paid_order_discord_delivery(
    '75000000-0000-4000-8000-000000000005',
    '750000000000000001',
    '750000000000000004',
    '234486394414825472'
  );

  if not v_first.was_completed
    or v_first.order_status <> 'delivered'
    or v_first.ticket_status <> 'open'
    or v_first.ticket_channel_id <> '750000000000000004'
    or v_first.delivered_by_discord_user_id <> '234486394414825472'
    or v_first.auto_close_at <> v_first.delivery_completed_at + interval '30 minutes' then
    raise exception 'valid Discord delivery completion returned invalid state';
  end if;

  select * into strict v_retry
  from public.complete_paid_order_discord_delivery(
    '75000000-0000-4000-8000-000000000005',
    '750000000000000001',
    '750000000000000004',
    '234486394414825472'
  );

  if v_retry.was_completed
    or v_retry.delivery_completed_at <> v_first.delivery_completed_at
    or v_retry.auto_close_at <> v_first.auto_close_at then
    raise exception 'Discord delivery completion was not idempotent';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where action = 'bot.order.ticket.delivery.complete'
    and entity_id = '75000000-0000-4000-8000-000000000005';
  if v_audit_count <> 1 then
    raise exception 'Discord delivery completion audit was not recorded exactly once';
  end if;
end
$$;

do $$
declare
  v_claim_count integer;
begin
  select count(*) into v_claim_count
  from public.claim_due_delivered_discord_ticket_closes(100);
  if v_claim_count <> 0 then
    raise exception 'a delivered ticket was claimed before thirty minutes elapsed';
  end if;
end
$$;

update public.orders
set discord_ticket_delivery_completed_at = now() - interval '31 minutes'
where id = '75000000-0000-4000-8000-000000000005';

do $$
declare
  v_claim record;
  v_second_claim_count integer;
begin
  select * into strict v_claim
  from public.claim_due_delivered_discord_ticket_closes(100);

  if v_claim.claimed_order_id <> '75000000-0000-4000-8000-000000000005'
    or v_claim.discord_guild_id <> '750000000000000001'
    or v_claim.ticket_channel_id <> '750000000000000004'
    or v_claim.claim_token is null
    or v_claim.claimed_at is null then
    raise exception 'due delivered ticket returned an invalid automatic close claim';
  end if;

  select count(*) into v_second_claim_count
  from public.claim_due_delivered_discord_ticket_closes(100);
  if v_second_claim_count <> 0 then
    raise exception 'the same delivered ticket was claimed twice';
  end if;
end
$$;

do $$
declare
  v_order public.orders%rowtype;
begin
  select * into strict v_order
  from public.orders
  where id = '75000000-0000-4000-8000-000000000005';

  if v_order.discord_ticket_close_claim_token is null
    or v_order.discord_ticket_close_claimed_at is null
    or v_order.discord_ticket_close_claimed_by_discord_user_id
      <> '234486394414825472' then
    raise exception 'automatic close claim was not persisted atomically';
  end if;
end
$$;

rollback;

select 'Delivered Discord ticket automatic close verification passed' as result;
