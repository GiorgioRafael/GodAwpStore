-- Local transactional verification only. No real invoice, payment or Discord call.
begin;
insert into auth.users(id) values
 ('99000000-0000-4000-8000-000000000001'),('99000000-0000-4000-8000-000000000002'),('99000000-0000-4000-8000-000000000003');
insert into auth.identities(id,provider_id,user_id,provider,identity_data) values
 ('99000000-0000-4000-8000-000000000011','990000000000000001','99000000-0000-4000-8000-000000000001','discord','{"sub":"990000000000000001"}'),
 ('99000000-0000-4000-8000-000000000012','990000000000000002','99000000-0000-4000-8000-000000000002','discord','{"sub":"990000000000000002"}');
insert into public.whitelist_entries(id,discord_id,label) values('99000000-0000-4000-8000-000000000020','990000000000000020','Web test seller');
insert into public.games(id,name,slug,status) values('99000000-0000-4000-8000-000000000021','Web test','web-transaction-test','active');
insert into public.substores(id,game_id,name,slug,title,description,status) values
 ('99000000-0000-4000-8000-000000000022','99000000-0000-4000-8000-000000000021','Web','web-transaction-test','Web','Rollback','active');
insert into public.products(id,substore_id,name,slug,minimum_price_cents,stock_quantity,unlimited_stock,status) values
 ('99000000-0000-4000-8000-000000000023','99000000-0000-4000-8000-000000000022','Serviço','web-test-service',200,0,true,'active'),
 ('99000000-0000-4000-8000-000000000024','99000000-0000-4000-8000-000000000022','Item finito','web-test-item',1000,5,false,'active');
insert into public.guilds(id,discord_guild_id,owner_discord_id,whitelist_entry_id,name,status) values
 ('99000000-0000-4000-8000-000000000025','1401264061101899820','990000000000000020','99000000-0000-4000-8000-000000000020','GW web fixture','active');
insert into public.admin_profiles(auth_user_id,discord_user_id,display_name,is_active,authorization_expires_at) values
 ('99000000-0000-4000-8000-000000000003','990000000000000003','Staff',true,now()+interval '5 minutes');


-- Additional customer accounts: confirmed email, verified Google, unconfirmed email.
insert into auth.users(id,email,email_confirmed_at) values
 ('99000000-0000-4000-8000-000000000004','email-buyer@example.com',now()),
 ('99000000-0000-4000-8000-000000000005','google-buyer@example.com',now()),
 ('99000000-0000-4000-8000-000000000006','unconfirmed@example.com',null);
insert into auth.identities(id,provider_id,user_id,provider,identity_data) values
 ('99000000-0000-4000-8000-000000000014','99000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000004','email','{"email":"email-buyer@example.com"}'),
 ('99000000-0000-4000-8000-000000000015','google-buyer','99000000-0000-4000-8000-000000000005','google','{"email":"google-buyer@example.com","email_verified":true}'),
 ('99000000-0000-4000-8000-000000000016','99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000006','email','{"email":"unconfirmed@example.com"}');

do $$
declare created record; retried record; bot record; late_web record; v_order public.orders%rowtype; v_message uuid; v_ledger bigint;
  v_items jsonb := '[{"product_id":"99000000-0000-4000-8000-000000000023","quantity":5},{"product_id":"99000000-0000-4000-8000-000000000024","quantity":3}]';
begin
  if has_function_privilege('authenticated','public.create_gwstore_web_purchase(uuid,uuid,uuid,text,jsonb,integer,text,integer,text,boolean,uuid,text)','execute')
    or has_function_privilege('anon','public.send_gwstore_web_order_message(uuid,uuid,uuid,text,text,text)','execute') then raise exception 'Web mutation RPC leaked'; end if;
  select * into strict created from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000031','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020','990000000000000001',v_items,0,null,1000,'Player_123',true,'99000000-0000-4000-8000-000000000001','Buyer');
  select * into strict v_order from public.orders where id=created.checkout_order_id;
  if not created.was_created or v_order.payment_reference<>'web:99000000-0000-4000-8000-000000000031'
    or v_order.web_buyer_auth_user_id<>'99000000-0000-4000-8000-000000000001' or v_order.game_nickname<>'Player_123'
    or jsonb_array_length(v_order.web_items_snapshot)<>2 or v_order.sale_price_cents<>4000 then raise exception 'Web identity/prices/snapshot were not persisted'; end if;
  if exists(select 1 from public.web_order_chats where order_id=v_order.id)
    or (select stock_quantity from public.products where id='99000000-0000-4000-8000-000000000024')<>5 then raise exception 'Unpaid order changed chat/stock'; end if;
  select * into strict retried from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000031','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020','990000000000000001',v_items,0,null,1000,'Player_123',true,'99000000-0000-4000-8000-000000000001','Buyer');
  if retried.was_created or retried.checkout_order_id<>created.checkout_order_id then raise exception 'Web retry duplicated order'; end if;
  begin
    perform * from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000031','99000000-0000-4000-8000-000000000025',
      '99000000-0000-4000-8000-000000000020','990000000000000002',v_items,0,null,1000,'Player_123',true,'99000000-0000-4000-8000-000000000002','Other');
    raise exception 'Another buyer claimed same request';
  exception when sqlstate '22000' then null; end;
  update public.orders set status='paid',payment_status='paid',paid_at=now() where id=created.checkout_order_id;
  if not private.commit_paid_order_stock(created.checkout_order_id,now()) then raise exception 'Paid stock commit failed'; end if;
  perform public.ensure_gwstore_web_order_chat(created.checkout_order_id);
  perform public.ensure_gwstore_web_order_chat(created.checkout_order_id);
  if (select count(*) from public.web_order_messages where order_id=created.checkout_order_id and system_event='payment_confirmed')<>1
    or (select stock_quantity from public.products where id='99000000-0000-4000-8000-000000000023')<>0
    or (select stock_quantity from public.products where id='99000000-0000-4000-8000-000000000024')<>2 then raise exception 'Paid chat/stock idempotency failed'; end if;
  begin perform * from public.claim_discord_ticket(created.checkout_order_id); raise exception 'Web payment claimed Discord ticket';
  exception when sqlstate '42501' then null; end;
  v_message:=public.send_gwstore_web_order_message(created.checkout_order_id,'99000000-0000-4000-8000-000000000041',
    '99000000-0000-4000-8000-000000000001','990000000000000001','Buyer',E'Olá\nPlayer_123');
  if v_message<>public.send_gwstore_web_order_message(created.checkout_order_id,v_message,'99000000-0000-4000-8000-000000000001','990000000000000001','Buyer',E'Olá\nPlayer_123')
    or (select author_role from public.web_order_messages where id=v_message)<>'buyer' then raise exception 'Message retry/role failed'; end if;
  begin perform public.send_gwstore_web_order_message(created.checkout_order_id,v_message,'99000000-0000-4000-8000-000000000001','990000000000000001','Buyer','Changed'); raise exception 'Message retry changed body';
  exception when sqlstate '22000' then null; end;
  begin perform public.send_gwstore_web_order_message(created.checkout_order_id,'99000000-0000-4000-8000-000000000042','99000000-0000-4000-8000-000000000002','990000000000000002','Other','Spy'); raise exception 'Other buyer entered chat';
  exception when sqlstate '42501' then null; end;
  begin perform public.complete_gwstore_web_order_delivery(created.checkout_order_id,'99000000-0000-4000-8000-000000000001','990000000000000001'); raise exception 'Buyer completed own order';
  exception when sqlstate '42501' then null; end;
  select sum(amount_cents) into v_ledger from public.ledger_entries where order_id=created.checkout_order_id;
  if not public.complete_gwstore_web_order_delivery(created.checkout_order_id,'99000000-0000-4000-8000-000000000003','990000000000000003')
    or public.complete_gwstore_web_order_delivery(created.checkout_order_id,'99000000-0000-4000-8000-000000000003','990000000000000003') then raise exception 'Delivery retry failed'; end if;
  if (select sum(amount_cents) from public.ledger_entries where order_id=created.checkout_order_id)<>v_ledger
    or (select count(*) from public.web_order_messages where order_id=created.checkout_order_id and system_event='delivered')<>1 then raise exception 'Delivery changed money/duplicated message'; end if;
  select * into strict late_web from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000032','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020','990000000000000001','[{"product_id":"99000000-0000-4000-8000-000000000023","quantity":1}]',0,null,1000,'Player_123',true,'99000000-0000-4000-8000-000000000001','Buyer');
  update public.orders set status='cancelled',payment_status='paid',paid_at=now(),stock_released_at=now(),stock_release_reason='buyer_cancelled',cancelled_at=now(),late_payment_detected_at=now()-interval '1 minute' where id=late_web.checkout_order_id;
  if not exists(select 1 from public.web_order_chats where order_id=late_web.checkout_order_id) then raise exception 'Late web payment has no chat'; end if;
  select * into strict bot from public.create_bot_cart_with_reservation('990000000000000031','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020','990000000000000001','[{"product_id":"99000000-0000-4000-8000-000000000023","quantity":1}]',0,null,1000);
  update public.orders set status='cancelled',payment_status='paid',paid_at=now(),stock_released_at=now(),stock_release_reason='buyer_cancelled',cancelled_at=now(),late_payment_detected_at=now() where id=bot.checkout_order_id;
  if (select late_order_id from public.list_late_paid_orders_without_ticket(1))<>bot.checkout_order_id then raise exception 'Web backlog starved bot late recovery'; end if;
end $$;

do $$
declare email_order record; google_order record; retried record; v_message uuid; v_order public.orders%rowtype;
  v_items jsonb:='[{"product_id":"99000000-0000-4000-8000-000000000023","quantity":1}]';
begin
  select * into strict email_order from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000033','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020',null,v_items,0,null,1000,'Email_123',true,'99000000-0000-4000-8000-000000000004','Email buyer');
  select * into strict google_order from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000034','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020',null,v_items,0,null,1000,'Google_123',true,'99000000-0000-4000-8000-000000000005','Google buyer');
  select * into strict v_order from public.orders where id=email_order.checkout_order_id;
  if not email_order.was_created or not google_order.was_created or v_order.buyer_discord_id is not null
    or v_order.web_buyer_auth_user_id is distinct from '99000000-0000-4000-8000-000000000004'::uuid
    or v_order.discount_bps<>0 then raise exception 'Email/Google identity persistence failed'; end if;
  select * into strict retried from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000033','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020',null,v_items,0,null,1000,'Email_123',true,'99000000-0000-4000-8000-000000000004','Email buyer');
  if retried.was_created or retried.checkout_order_id<>email_order.checkout_order_id then raise exception 'Email retry duplicated purchase'; end if;
  begin perform * from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000033','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020',null,v_items,0,null,1000,'Email_123',true,'99000000-0000-4000-8000-000000000005','Wrong owner');
    raise exception 'NULL Discord bypassed checkout ownership'; exception when sqlstate '22000' then null; end;
  begin perform * from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000035','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020',null,v_items,0,null,1000,'Pending_123',true,'99000000-0000-4000-8000-000000000006','Unconfirmed');
    raise exception 'Unconfirmed email created checkout'; exception when sqlstate '42501' then null; end;
  begin perform * from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000035','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020','990000000000000001',v_items,0,null,1000,'Google_123',true,'99000000-0000-4000-8000-000000000005','Forged Discord');
    raise exception 'Google buyer impersonated Discord'; exception when sqlstate '42501' then null; end;
  begin perform * from public.create_gwstore_web_purchase('99000000-0000-4000-8000-000000000035','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020',null,v_items,500,'customer_rank',1000,'Google_123',true,'99000000-0000-4000-8000-000000000005','Fake rank');
    raise exception 'Non-Discord buyer claimed Discord discount'; exception when sqlstate '42501' then null; end;
  update public.orders set status='paid',payment_status='paid',paid_at=now() where id=email_order.checkout_order_id;
  perform private.commit_paid_order_stock(email_order.checkout_order_id,now());
  v_message:=public.send_gwstore_web_order_message(email_order.checkout_order_id,'99000000-0000-4000-8000-000000000043',
    '99000000-0000-4000-8000-000000000004',null,'Email buyer','Minha compra');
  if (select author_role from public.web_order_messages where id=v_message)<>'buyer' then raise exception 'Email buyer could not send message'; end if;
  begin perform public.send_gwstore_web_order_message(email_order.checkout_order_id,'99000000-0000-4000-8000-000000000044',
    '99000000-0000-4000-8000-000000000005',null,'Google buyer','Spy');
    raise exception 'NULL Discord bypassed chat ownership'; exception when sqlstate '42501' then null; end;
  begin perform public.complete_gwstore_web_order_delivery(email_order.checkout_order_id,'99000000-0000-4000-8000-000000000004',null);
    raise exception 'Email buyer completed own delivery'; exception when sqlstate '42501' then null; end;
  if not public.complete_gwstore_web_order_delivery(email_order.checkout_order_id,'99000000-0000-4000-8000-000000000003','990000000000000003') then
    raise exception 'Discord staff could not deliver email purchase'; end if;
  begin perform * from public.create_bot_cart_with_reservation('990000000000000035','99000000-0000-4000-8000-000000000025',
    '99000000-0000-4000-8000-000000000020',null,v_items,0,null,1000);
    raise exception 'Bot accepted missing Discord'; exception when sqlstate '22023' then null; end;
  begin update public.orders set payment_reference='discord:990000000000000033' where id=email_order.checkout_order_id;
    raise exception 'NULL Discord became non-web order'; exception when check_violation then null; end;
  begin update public.orders set payment_reference='web:invented' where id=email_order.checkout_order_id;
    raise exception 'NULL Discord accepted malformed web namespace'; exception when check_violation then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000005',true);
do $$ begin if exists(select 1 from public.web_order_messages) then raise exception 'Google buyer read another buyer chat'; end if; end $$;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000004',true);
do $$ begin if not exists(select 1 from public.web_order_messages where author_role='buyer') then raise exception 'Email owner cannot read private chat'; end if; end $$;
reset role;

-- Deleting an Auth account preserves paid history without leaving customer
-- access behind. Staff can still repair/read its chat and delivery snapshot.
delete from auth.users where id='99000000-0000-4000-8000-000000000004';
do $$
declare v_order public.orders%rowtype; v_delegate text;
begin
  select * into strict v_order from public.orders where payment_reference='web:99000000-0000-4000-8000-000000000033';
  if v_order.web_buyer_auth_user_id is not null or v_order.buyer_discord_id is not null
    or v_order.game_nickname<>'Email_123' or jsonb_array_length(v_order.web_items_snapshot)<>1
    or v_order.status<>'delivered' then raise exception 'Account deletion lost purchase history'; end if;
  if not public.ensure_gwstore_web_order_chat(v_order.id)
    or (select count(*) from public.web_order_messages where order_id=v_order.id and system_event='payment_confirmed')<>1 then
    raise exception 'Orphan history chat replay failed'; end if;
  foreach v_delegate in array array['gwstore_web_cart_legacy','gwstore_web_cart_deferred','gwstore_web_cart_ranked'] loop
    begin
      execute format('select * from private.%I($1,$2,$3,$4,$5,$6,$7,$8,$9)',v_delegate)
        using '99000000-0000-4000-8000-000000000036'::text,'99000000-0000-4000-8000-000000000025'::uuid,
          '99000000-0000-4000-8000-000000000020'::uuid,null::text,
          '[{"product_id":"99000000-0000-4000-8000-000000000023","quantity":1}]'::jsonb,0,null::text,1000,null::uuid;
      raise exception 'Web delegate % accepted missing Auth UUID',v_delegate;
    exception when sqlstate '22023' then null; end;
  end loop;
  begin perform public.send_gwstore_web_order_message(v_order.id,'99000000-0000-4000-8000-000000000045',
    '99000000-0000-4000-8000-000000000005',null,'Google buyer','Spy');
    raise exception 'Another customer claimed orphan chat'; exception when sqlstate '42501' then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000005',true);
do $$ begin if exists(select 1 from public.web_order_messages) or exists(select 1 from public.web_order_chats) then raise exception 'Google buyer read orphan history'; end if; end $$;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000004',true);
do $$ begin if exists(select 1 from public.web_order_messages) or exists(select 1 from public.web_order_chats) then raise exception 'Deleted buyer still read private history'; end if; end $$;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000003',true);
do $$ begin if not exists(select 1 from public.web_order_messages where id='99000000-0000-4000-8000-000000000043')
  or not exists(select 1 from public.orders where payment_reference='web:99000000-0000-4000-8000-000000000033'
    and web_buyer_auth_user_id is null and status='delivered') then raise exception 'Staff lost deleted-account history'; end if; end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
do $$ begin if exists(select 1 from public.web_order_messages) or exists(select 1 from public.web_order_chats) then raise exception 'Other buyer read private chat'; end if; end $$;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
do $$ begin if not exists(select 1 from public.web_order_messages where author_role='buyer') then raise exception 'Owner cannot read chat'; end if;
  begin insert into public.web_order_messages(order_id,author_role,author_name,body) select order_id,'staff','Fake','Forged' from public.web_order_chats limit 1; raise exception 'Client inserted staff message';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'GW customer auth checks passed: Google/email, NULL ownership, confirmed identity, account-deletion history, preserved Discord; existing GW web checks: buyer identity, namespace, prices, stock, payment gate, chat, RLS, idempotency, delivery and bot isolation.' as result;
