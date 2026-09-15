-- Run in a transaction with the migration; rollback fixtures, never call a gateway.
do $test$
declare v_order record; v_checkout record; v_claim uuid := gen_random_uuid(); v_operation uuid := gen_random_uuid(); v_first record; v_second record;
begin
  select * into strict v_order from public.create_robux_livepix_order(
    '1401264061101899820', '999999999999999991', '999999999999999992', 100
  );
  perform public.claim_robux_livepix_checkout(v_order.order_id,v_claim);
  select * into strict v_checkout from public.prepare_eclipsepay_checkout(v_order.order_id,v_order.amount_cents);
  if char_length(v_checkout.checkout_token)<>64 then raise exception 'Private checkout token missing'; end if;
  perform public.register_eclipsepay_operation(v_order.order_id,v_operation,'test-pix-code',now()+interval '30 minutes');
  perform public.register_claimed_robux_livepix_checkout(v_order.order_id,v_claim,'ep:'||v_operation::text,'https://gwstore.vercel.app/pagamento/pix/'||v_checkout.checkout_token);
  if not exists(select 1 from public.robux_orders where id=v_order.order_id and payment_provider='eclipsepay') then raise exception 'Provider not persisted'; end if;
  select * into strict v_first from public.confirm_robux_livepix_payment(v_operation::text,'eclipsepay:'||v_operation::text,'ep:'||v_operation::text,v_order.amount_cents,'BRL',now(),repeat('a',64));
  select * into strict v_second from public.confirm_robux_livepix_payment(v_operation::text,'eclipsepay:'||v_operation::text,'ep:'||v_operation::text,v_order.amount_cents,'BRL',now(),repeat('a',64));
  if v_first.processed_order_id<>v_second.processed_order_id then raise exception 'Duplicate payment created another order'; end if;
  if has_table_privilege('anon','public.eclipsepay_checkouts','select') or has_table_privilege('authenticated','public.eclipsepay_webhook_inbox','insert') then raise exception 'Payment storage exposed'; end if;
  if has_function_privilege('anon','public.prepare_eclipsepay_checkout(uuid,bigint)','execute') then raise exception 'Payment RPC exposed'; end if;
end $test$;
