-- Synthetic user and purchase, rolled back by the caller.
do $test$
declare u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid(); claim uuid:=gen_random_uuid(); checkout record; credited record; replay record;
begin
  insert into auth.users(id,email) values(u,'eclipse-'||u||'@example.invalid');
  insert into public.roulette_coin_purchases(id,auth_user_id,discord_user_id,amount_cents) values(p,u,'999999999999999973',1000);
  perform public.claim_roulette_coin_checkout(p,claim);
  select * into strict checkout from public.prepare_eclipsepay_checkout(p,1000);
  perform public.register_eclipsepay_operation(p,operation,'synthetic-coins',now()+interval '30 minutes');
  perform public.register_roulette_coin_checkout(p,claim,'ep:'||operation::text,'https://gwstore.vercel.app/pagamento/pix/'||checkout.checkout_token);
  select * into strict credited from public.confirm_roulette_coin_purchase(operation::text,'eclipsepay:'||operation::text,'ep:'||operation::text,1000,'BRL',now(),repeat('c',64));
  select * into strict replay from public.confirm_roulette_coin_purchase(operation::text,'eclipsepay:'||operation::text,'ep:'||operation::text,1000,'BRL',now(),repeat('c',64));
  if credited.coin_balance_cents<>1000 or replay.coin_balance_cents<>1000 or replay.first_confirmation then raise exception 'Coins duplicated or not credited'; end if;
  if not exists(select 1 from public.roulette_coin_purchases where id=p and payment_provider='eclipsepay') then raise exception 'Coins provider incorrect'; end if;
end $test$;
