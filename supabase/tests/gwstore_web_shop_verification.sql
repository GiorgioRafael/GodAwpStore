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
select 'GW web checks passed: buyer identity, namespace, prices, stock, payment gate, chat, RLS, idempotency, delivery and bot isolation.' as result;
