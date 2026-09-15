-- Synthetic catalog/order, all fixtures MUST be rolled back by the caller.
do $test$
declare
  g uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
  w uuid:=gen_random_uuid(); guild uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid(); claim uuid:=gen_random_uuid();
  o record; checkout record; confirmed record; replay record; qty bigint;
begin
  insert into public.games(id,name,slug,status) values(g,'Eclipse test','eclipse-test-'||g,'active');
  insert into public.substores(id,game_id,name,slug,title,status) values(s,g,'Eclipse test','eclipse-test-'||s,'Eclipse test','active');
  insert into public.products(id,substore_id,name,slug,minimum_price_cents,stock_quantity,status) values(p,s,'Eclipse synthetic item','eclipse-test-'||p,1000,10,'active');
  insert into public.whitelist_entries(id,discord_id,label,is_active) values(w,'999999999999999981','Eclipse synthetic seller',true);
  insert into public.guilds(id,discord_guild_id,owner_discord_id,whitelist_entry_id,name,status)
    values(guild,'999999999999999982','999999999999999981',w,'Eclipse synthetic guild','active');
  select * into strict o from public.create_bot_order_with_reservation('999999999999999983',guild,w,p,'999999999999999984',1,1000,0);
  perform public.claim_livepix_checkout(o.created_order_id,claim);
  select * into strict checkout from public.prepare_eclipsepay_checkout(o.created_order_id,1000);
  perform public.register_eclipsepay_operation(o.created_order_id,operation,'synthetic-code',now()+interval '30 minutes');
  perform public.register_claimed_livepix_checkout(o.created_order_id,claim,'ep:'||operation::text,'https://gwstore.vercel.app/pagamento/pix/'||checkout.checkout_token,null);
  select stock_quantity into qty from public.products where id=p;
  if qty<>10 then raise exception 'Stock changed before payment'; end if;
  begin
    perform public.confirm_livepix_payment(operation::text,'eclipsepay:'||operation::text,'ep:'||operation::text,900,'BRL',now(),repeat('b',64));
    raise exception 'Mismatched amount unexpectedly accepted';
  exception when data_exception then null;
  end;
  select * into strict confirmed from public.confirm_livepix_payment(operation::text,'eclipsepay:'||operation::text,'ep:'||operation::text,1000,'BRL',now(),repeat('b',64));
  select * into strict replay from public.confirm_livepix_payment(operation::text,'eclipsepay:'||operation::text,'ep:'||operation::text,1000,'BRL',now(),repeat('b',64));
  if confirmed.processed_order_id<>replay.processed_order_id then raise exception 'Duplicate order'; end if;
  select stock_quantity into qty from public.products where id=p;
  if qty<>9 then raise exception 'Stock was not committed exactly once: %',qty; end if;
  if (select count(*) from public.payment_webhook_events where provider='eclipsepay' and provider_checkout_id=operation::text)<>1 then raise exception 'EclipsePay ledger provider or idempotency incorrect'; end if;
  if exists(select 1 from public.payment_webhook_events where provider='livepix' and provider_checkout_id=operation::text) then raise exception 'EclipsePay incorrectly recorded as LivePix'; end if;
end $test$;
