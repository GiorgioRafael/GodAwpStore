-- Run against an isolated test database after the migrations. The real GWStore
-- guild must not be present: these queue RPCs intentionally claim due tickets.
-- All fixtures and claims are rolled back; this test never calls Discord.
begin;
set local client_min_messages = warning;

do $$
begin
  if exists (select 1 from public.guilds where discord_guild_id = '1401264061101899820') then
    raise exception 'Run automatic-close verification only in an isolated database without the real GWStore guild.';
  end if;
end
$$;

update public.platform_settings
set ticket_close_admin_discord_user_ids = array['234486394414825472']::text[]
where id = 1;

insert into public.games (id, name, slug, status)
values ('75100000-0000-4000-8000-000000000001', 'Auto-close verification game', 'auto-close-verification-game', 'active');
insert into public.substores (id, game_id, name, slug, title, status)
values ('75100000-0000-4000-8000-000000000002', '75100000-0000-4000-8000-000000000001',
  'Auto-close verification store', 'auto-close-verification-store', 'Auto-close verification store', 'active');
insert into public.products (id, substore_id, name, slug, minimum_price_cents, status)
values ('75100000-0000-4000-8000-000000000003', '75100000-0000-4000-8000-000000000002',
  'Auto-close verification product', 'auto-close-verification-product', 100, 'active');
insert into public.guilds (id, discord_guild_id, owner_discord_id, name, status)
values
  ('75100000-0000-4000-8000-000000000004', '1401264061101899820', '751000000000000001', 'GWStore verification guild', 'active'),
  ('75100000-0000-4000-8000-000000000005', '751000000000000002', '751000000000000001', 'Other verification guild', 'active');
insert into public.orders (
  id, guild_id, product_id, buyer_discord_id, status, subtotal_price_cents,
  sale_price_cents, minimum_price_cents, commission_bps, payment_status, paid_at,
  discord_ticket_channel_id, discord_ticket_status, discord_ticket_claimed_at
)
values
  ('75100000-0000-4000-8000-000000000010', '75100000-0000-4000-8000-000000000004',
    '75100000-0000-4000-8000-000000000003', '751000000000000003', 'paid', 100, 100, 100, 3000, 'paid', now(), '751000000000000010', 'open', now()),
  ('75100000-0000-4000-8000-000000000011', '75100000-0000-4000-8000-000000000005',
    '75100000-0000-4000-8000-000000000003', '751000000000000003', 'paid', 100, 100, 100, 3000, 'paid', now(), '751000000000000011', 'open', now()),
  ('75100000-0000-4000-8000-000000000012', '75100000-0000-4000-8000-000000000004',
    '75100000-0000-4000-8000-000000000003', '751000000000000003', 'paid', 100, 100, 100, 3000, 'paid', now(), '751000000000000012', 'open', now()),
  ('75100000-0000-4000-8000-000000000013', '75100000-0000-4000-8000-000000000004',
    '75100000-0000-4000-8000-000000000003', '751000000000000003', 'paid', 100, 100, 100, 3000, 'paid', now(), '751000000000000013', 'open', now());
insert into public.robux_orders (
  id, guild_id, buyer_discord_id, discord_interaction_id, robux_quantity,
  amount_cents, status, payment_status, paid_at, discord_ticket_channel_id,
  discord_ticket_status, discord_ticket_claimed_at
)
values
  ('75100000-0000-4000-8000-000000000020', '75100000-0000-4000-8000-000000000004',
    '751000000000000003', '751000000000000020', 1000, 4000, 'paid', 'paid', now(), '751000000000000021', 'open', now()),
  ('75100000-0000-4000-8000-000000000021', '75100000-0000-4000-8000-000000000005',
    '751000000000000003', '751000000000000022', 1000, 4000, 'paid', 'paid', now(), '751000000000000023', 'open', now()),
  ('75100000-0000-4000-8000-000000000022', '75100000-0000-4000-8000-000000000004',
    '751000000000000003', '751000000000000024', 1000, 4000, 'paid', 'paid', now(), '751000000000000025', 'open', now());

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.claim_due_gwstore_discord_ticket_closes(integer)',
    'public.renew_robux_discord_ticket_close_claim(uuid,text,uuid)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'New automatic-close RPC privileges are invalid: %', v_function;
    end if;
  end loop;
  begin
    perform public.claim_due_gwstore_discord_ticket_closes(0);
    raise exception 'Invalid batch limit was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.claim_due_gwstore_discord_ticket_closes(101);
    raise exception 'Oversized batch limit was accepted';
  exception when invalid_parameter_value then null;
  end;
end
$$;

do $$
declare
  v_first record;
  v_retry record;
  v_other record;
  v_robux record;
begin
  begin
    perform public.complete_paid_order_discord_delivery(
      '75100000-0000-4000-8000-000000000010', '1401264061101899820', '751000000000000010', '751000000000000099');
    raise exception 'Unauthorized user completed a delivery';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.complete_robux_discord_ticket_delivery(
      '75100000-0000-4000-8000-000000000020', '1401264061101899820', '751000000000000099', '234486394414825472');
    raise exception 'Mismatched Robux channel completed a delivery';
  exception when insufficient_privilege then null;
  end;

  select * into strict v_first from public.complete_paid_order_discord_delivery(
    '75100000-0000-4000-8000-000000000010', '1401264061101899820', '751000000000000010', '234486394414825472');
  select * into strict v_retry from public.complete_paid_order_discord_delivery(
    '75100000-0000-4000-8000-000000000010', '1401264061101899820', '751000000000000010', '234486394414825472');
  select * into strict v_other from public.complete_paid_order_discord_delivery(
    '75100000-0000-4000-8000-000000000011', '751000000000000002', '751000000000000011', '234486394414825472');
  select * into strict v_robux from public.complete_robux_discord_ticket_delivery(
    '75100000-0000-4000-8000-000000000020', '1401264061101899820', '751000000000000021', '234486394414825472');
  if not v_first.was_completed or v_retry.was_completed
    or v_retry.delivery_completed_at <> v_first.delivery_completed_at
    or v_retry.auto_close_at <> v_first.auto_close_at
    or v_first.auto_close_at <> v_first.delivery_completed_at + interval '5 minutes'
    or v_robux.auto_close_at <> v_robux.delivery_completed_at + interval '5 minutes'
    or v_other.auto_close_at <> v_other.delivery_completed_at + interval '30 minutes' then
    raise exception 'GWStore five-minute delivery scheduling, foreign duration, or idempotency failed';
  end if;
  select * into strict v_other from public.complete_robux_discord_ticket_delivery(
    '75100000-0000-4000-8000-000000000021', '751000000000000002', '751000000000000023', '234486394414825472');
  if v_other.auto_close_at <> v_other.delivery_completed_at + interval '30 minutes' then
    raise exception 'Foreign Robux duration changed';
  end if;
end
$$;

update public.orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '4 minutes 59 seconds'
where id = '75100000-0000-4000-8000-000000000010';
update public.robux_orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '4 minutes 59 seconds'
where id = '75100000-0000-4000-8000-000000000020';
update public.orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '20 minutes'
where id = '75100000-0000-4000-8000-000000000011';
update public.robux_orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '40 minutes'
where id = '75100000-0000-4000-8000-000000000021';
do $$
begin
  if exists (select 1 from public.claim_due_gwstore_discord_ticket_closes(100))
    or exists (select 1 from public.claim_due_delivered_discord_ticket_closes(100)) then
    raise exception 'A ticket was claimed early or from another guild before its original deadline';
  end if;
end
$$;

update public.orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '5 minutes 1 second'
where id = '75100000-0000-4000-8000-000000000010';
update public.robux_orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '5 minutes 1 second'
where id = '75100000-0000-4000-8000-000000000020';
create temporary table verification_close_claims as select * from public.claim_due_gwstore_discord_ticket_closes(1);
do $$
begin
  if (select count(*) from verification_close_claims) <> 1 then
    raise exception 'The batch limit was not shared between item and Robux tickets';
  end if;
end
$$;
insert into verification_close_claims select * from public.claim_due_gwstore_discord_ticket_closes(1);
do $$
begin
  if (select count(*) from verification_close_claims) <> 2
    or (select count(*) from verification_close_claims where source = 'orders'
      and claimed_order_id = '75100000-0000-4000-8000-000000000010') <> 1
    or (select count(*) from verification_close_claims where source = 'robux'
      and claimed_order_id = '75100000-0000-4000-8000-000000000020') <> 1
    or exists (select 1 from public.claim_due_gwstore_discord_ticket_closes(100)) then
    raise exception 'Due purchase/Robux tickets were not claimed exactly once with their source';
  end if;
  if exists (select 1 from public.robux_orders where id in (
    '75100000-0000-4000-8000-000000000021', '75100000-0000-4000-8000-000000000022')
    and discord_ticket_close_claim_token is not null)
    or exists (select 1 from public.orders where id in (
      '75100000-0000-4000-8000-000000000011', '75100000-0000-4000-8000-000000000012')
      and discord_ticket_close_claim_token is not null) then
    raise exception 'An undelivered ticket or foreign Robux ticket was claimed';
  end if;
end
$$;

do $$
declare v_claim record; v_result record;
begin
  select * into strict v_claim from verification_close_claims where source = 'robux';
  select * into strict v_result from public.renew_robux_discord_ticket_close_claim(
    v_claim.claimed_order_id, v_claim.ticket_channel_id, v_claim.claim_token);
  if v_result.renewed or not v_result.active then raise exception 'An active Robux lease was extended'; end if;
  begin
    perform public.renew_robux_discord_ticket_close_claim(v_claim.claimed_order_id, v_claim.ticket_channel_id, gen_random_uuid());
    raise exception 'A stale token renewed the Robux lease';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.complete_robux_discord_ticket_close(v_claim.claimed_order_id, v_claim.ticket_channel_id, gen_random_uuid());
    raise exception 'A stale token completed the Robux close';
  exception when insufficient_privilege then null;
  end;
end
$$;
update public.robux_orders set discord_ticket_close_claimed_at = statement_timestamp() - interval '6 minutes'
where id = '75100000-0000-4000-8000-000000000020';
do $$
declare v_claim record; v_result record;
begin
  select * into strict v_claim from verification_close_claims where source = 'robux';
  select * into strict v_result from public.renew_robux_discord_ticket_close_claim(
    v_claim.claimed_order_id, v_claim.ticket_channel_id, v_claim.claim_token);
  if not v_result.renewed or v_result.active
    or (select discord_ticket_close_claim_token from public.robux_orders where id = v_claim.claimed_order_id) <> v_claim.claim_token then
    raise exception 'An expired Robux lease was not recovered with its exact token';
  end if;
  select * into strict v_result from public.complete_robux_discord_ticket_close(
    v_claim.claimed_order_id, v_claim.ticket_channel_id, v_claim.claim_token);
  if not v_result.was_closed or v_result.ticket_status <> 'closed' then raise exception 'Recovered Robux close failed'; end if;
  select * into strict v_result from public.complete_robux_discord_ticket_close(
    v_claim.claimed_order_id, v_claim.ticket_channel_id, v_claim.claim_token);
  if v_result.was_closed then raise exception 'Robux completion was not idempotent'; end if;
  select * into strict v_result from public.renew_robux_discord_ticket_close_claim(
    v_claim.claimed_order_id, v_claim.ticket_channel_id, v_claim.claim_token);
  if v_result.renewed or v_result.active or v_result.ticket_status <> 'closed' then raise exception 'A closed Robux ticket was renewed'; end if;

  select * into strict v_claim from verification_close_claims where source = 'orders';
  select * into strict v_result from public.complete_discord_ticket_close(
    v_claim.claimed_order_id, v_claim.ticket_channel_id, v_claim.claim_token, 'discord_close_reconciliation');
  if not v_result.was_closed or v_result.ticket_status <> 'closed' then raise exception 'Item completion with the existing RPC failed'; end if;
end
$$;

select * from public.complete_paid_order_discord_delivery(
  '75100000-0000-4000-8000-000000000013', '1401264061101899820', '751000000000000013', '234486394414825472');
update public.orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '5 minutes 1 second'
where id = '75100000-0000-4000-8000-000000000013';
do $$
declare v_claim record;
begin
  select * into strict v_claim from public.claim_due_delivered_discord_ticket_closes(100);
  if v_claim.claimed_order_id <> '75100000-0000-4000-8000-000000000013' then
    raise exception 'The compatibility queue did not honor GWStore five-minute scheduling';
  end if;
  perform public.complete_discord_ticket_close(v_claim.claimed_order_id, v_claim.ticket_channel_id,
    v_claim.claim_token, 'discord_close_reconciliation');
end
$$;

update public.orders set discord_ticket_delivery_completed_at = statement_timestamp() - interval '31 minutes'
where id = '75100000-0000-4000-8000-000000000011';
do $$
declare v_claim record;
begin
  select * into strict v_claim from public.claim_due_delivered_discord_ticket_closes(100);
  if v_claim.claimed_order_id <> '75100000-0000-4000-8000-000000000011' then
    raise exception 'The original thirty-minute queue no longer serves other guilds';
  end if;
  begin
    perform public.renew_robux_discord_ticket_close_claim('75100000-0000-4000-8000-000000000021', '751000000000000023', gen_random_uuid());
    raise exception 'Foreign Robux recovery was accepted';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
select 'GWStore purchase and Robux automatic close verification passed' as result;
