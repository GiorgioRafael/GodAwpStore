begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Let the public link use up to eight of the provider's ten hourly charge
-- slots. Keep the combined public-link/storefront guard at nine so a normal
-- checkout can still use the last slot. Provider-side usage may lower the
-- actual available capacity.
create or replace function public.prepare_eclipsepay_payment_link(
  p_intent_id uuid,
  p_token text,
  p_payer_name text,
  p_payer_details text,
  p_amount_cents bigint
)
returns setof public.eclipsepay_payment_links
language plpgsql security definer set search_path = pg_catalog as $fn$
declare v_row public.eclipsepay_payment_links%rowtype;
begin
  if p_intent_id is null or p_token !~ '^[0-9a-f]{64}$'
    or p_payer_name is null or char_length(btrim(p_payer_name)) not between 2 and 80
    or p_payer_details is null or char_length(btrim(p_payer_details)) > 500
    or p_amount_cents not between 80 and 100000 then
    raise exception 'Invalid payment link request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gwstore-eclipsepay-payment-links', 0));
  select * into v_row from public.eclipsepay_payment_links where id = p_intent_id for update;
  if not found then
    if (select count(*) from public.eclipsepay_payment_links
        where prepared_at > now() - interval '1 hour') >= 8
      or (select count(*) from public.eclipsepay_payment_links
          where prepared_at > now() - interval '1 hour')
       + (select count(*) from public.eclipsepay_checkouts
          where created_at > now() - interval '1 hour') >= 9 then
      raise exception 'Payment link hourly limit reached';
    end if;
    insert into public.eclipsepay_payment_links(id, link_token, payer_name, payer_details, amount_cents)
      values(p_intent_id, p_token, btrim(p_payer_name), btrim(p_payer_details), p_amount_cents)
      returning * into v_row;
  elsif v_row.payer_name is distinct from btrim(p_payer_name)
     or v_row.payer_details is distinct from btrim(p_payer_details)
     or v_row.amount_cents is distinct from p_amount_cents then
    raise exception 'Payment link already used';
  end if;
  return next v_row;
end $fn$;

commit;
