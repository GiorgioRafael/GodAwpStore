-- Transactional fixtures: no real payment, customer ticket, or persistent data.
begin;
set local lock_timeout = '10s';
insert into public.whitelist_entries (id,discord_id,label) values ('88000000-0000-4000-8000-000000000001','880000000000000001','UP transactional fixture');
insert into public.games (id,name,slug,status) values ('88000000-0000-4000-8000-000000000002','UP fixture','up-transactional-fixture','active');
insert into public.substores (id,game_id,name,slug,title,description,status) values ('88000000-0000-4000-8000-000000000003','88000000-0000-4000-8000-000000000002','UP fixture','up-fixture','UP fixture','Rolled back','active');
insert into public.products (id,substore_id,name,slug,minimum_price_cents,stock_quantity,unlimited_stock,status) values
 ('88000000-0000-4000-8000-000000000004','88000000-0000-4000-8000-000000000003','Level 100','up-fixture-service',200,0,true,'active'),
 ('88000000-0000-4000-8000-000000000005','88000000-0000-4000-8000-000000000003','Finite item','up-fixture-item',1000,5,false,'active');
insert into public.guilds (id,discord_guild_id,owner_discord_id,whitelist_entry_id,name,status) values ('88000000-0000-4000-8000-000000000006','880000000000000006','880000000000000001','88000000-0000-4000-8000-000000000001','UP fixture','active');
do $$
declare
  created record;
  retried record;
  ticket record;
  single_order record;
  items jsonb := '[{"product_id":"88000000-0000-4000-8000-000000000004","quantity":5},{"product_id":"88000000-0000-4000-8000-000000000005","quantity":3}]';
begin
  select * into strict created from public.create_ranked_bot_cart_with_reservation('880000000000000007','88000000-0000-4000-8000-000000000006','88000000-0000-4000-8000-000000000001','880000000000000008',items,0,null,1000);
  if not created.was_created or created.out_of_stock or created.checkout_order_id is null then raise exception 'Service/mixed checkout failed'; end if;
  if (select sale_price_cents from public.orders where id=created.checkout_order_id) <> 4000 then raise exception 'Package pricing incorrect'; end if;
  if (select stock_quantity from public.products where id='88000000-0000-4000-8000-000000000004') <> 0 or (select stock_quantity from public.products where id='88000000-0000-4000-8000-000000000005') <> 5 then raise exception 'Unpaid checkout changed stock'; end if;
  begin
    perform * from public.claim_discord_ticket(created.checkout_order_id);
    raise exception 'Ticket was claimed before payment';
  exception when sqlstate '22000' then null;
  end;
  select * into strict retried from public.create_ranked_bot_cart_with_reservation('880000000000000007','88000000-0000-4000-8000-000000000006','88000000-0000-4000-8000-000000000001','880000000000000008',items,0,null,1000);
  if retried.was_created or retried.checkout_order_id <> created.checkout_order_id then raise exception 'Service checkout is not idempotent'; end if;
  update public.orders set status='paid',payment_status='paid',paid_at=now() where id=created.checkout_order_id;
  if not private.commit_paid_order_stock(created.checkout_order_id,now()) then raise exception 'Paid service checkout did not commit'; end if;
  if not private.commit_paid_order_stock(created.checkout_order_id,now()) then raise exception 'Paid service retry failed'; end if;
  if (select stock_quantity from public.products where id='88000000-0000-4000-8000-000000000004') <> 0 or (select stock_quantity from public.products where id='88000000-0000-4000-8000-000000000005') <> 2 then raise exception 'Paid service affected inventory, or finite stock consumed twice'; end if;
  if (select sum(amount_cents) from public.ledger_entries where order_id=created.checkout_order_id) <> 4000 then raise exception 'Service financials missing or duplicated'; end if;
  select * into strict ticket from public.claim_discord_ticket(created.checkout_order_id);
  if not ticket.claimed or ticket.order_quantity <> 8 then raise exception 'Paid service ticket claim failed'; end if;
  select * into strict single_order from public.create_bot_order_with_reservation('880000000000000009','88000000-0000-4000-8000-000000000006','88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000004','880000000000000008',1,200,200,0,0,null,1000);
  if not single_order.was_created or single_order.out_of_stock or (select stock_quantity from public.products where id='88000000-0000-4000-8000-000000000004') <> 0 then raise exception 'Single service checkout changed inventory'; end if;
  update public.products set status='inactive' where id='88000000-0000-4000-8000-000000000004';
  begin
    perform * from public.create_bot_cart_with_reservation('880000000000000010','88000000-0000-4000-8000-000000000006','88000000-0000-4000-8000-000000000001','880000000000000008',items,0,null,1000);
    raise exception 'Paused service remained purchasable';
  exception when sqlstate '22000' then null;
  end;
end $$;
rollback;
select 'UP checks passed: packages, zero stock, finite stock, payment gate, retries, financials and pauses. All fixtures rolled back.' as result;
