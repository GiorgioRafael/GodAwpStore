begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The public page is reusable; each submission receives its own charge and
-- unguessable receipt token. The UUID is the stable idempotency key on retries.
create table public.eclipsepay_payment_links (
  id uuid primary key,
  link_token text not null unique check (link_token ~ '^[0-9a-f]{64}$'),
  payer_name text not null check (char_length(payer_name) between 2 and 80),
  payer_details text not null check (char_length(payer_details) <= 500),
  amount_cents bigint not null check (amount_cents between 80 and 100000),
  operation_id uuid unique,
  br_code text,
  expires_at timestamptz,
  operation_status text not null default 'pending'
    check (operation_status in ('pending', 'completed', 'failed', 'refunded')),
  fee_cents bigint check (fee_cents is null or fee_cents >= 0),
  net_cents bigint check (net_cents is null or net_cents >= 0),
  provider_updated_at timestamptz,
  confirmed_at timestamptz,
  next_check_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  prepared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_link_confirmed_fields check (
    confirmed_at is null or operation_status in ('completed', 'refunded')
  )
);
alter table public.eclipsepay_payment_links enable row level security;
revoke all on public.eclipsepay_payment_links from public, anon, authenticated;
grant select, insert, update on public.eclipsepay_payment_links to service_role;

create index eclipsepay_payment_links_due_idx
  on public.eclipsepay_payment_links (next_check_at)
  where operation_id is not null and operation_status = 'pending';
create index eclipsepay_payment_links_created_idx
  on public.eclipsepay_payment_links (created_at desc);

create function public.prepare_eclipsepay_payment_link(
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

  -- Preserve half of the provider's 10/hour quota for normal store checkouts.
  perform pg_advisory_xact_lock(hashtextextended('gwstore-eclipsepay-payment-links', 0));
  select * into v_row from public.eclipsepay_payment_links where id = p_intent_id for update;
  if not found then
    if (select count(*) from public.eclipsepay_payment_links
        where prepared_at > now() - interval '1 hour') >= 5
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
revoke all on function public.prepare_eclipsepay_payment_link(uuid,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.prepare_eclipsepay_payment_link(uuid,text,text,text,bigint)
  to service_role;

create function public.claim_eclipsepay_payment_link_reconciliation(p_token uuid)
returns setof public.eclipsepay_payment_links
language plpgsql security definer set search_path = pg_catalog as $fn$
begin
  return query
  update public.eclipsepay_payment_links p
    set lease_token = p_token, lease_until = now() + interval '3 minutes'
    where p.id = (
      select q.id from public.eclipsepay_payment_links q
      where q.operation_id is not null and q.next_check_at <= now()
        and (q.lease_until is null or q.lease_until < now())
        and (
          (q.operation_status = 'pending' and q.prepared_at > now() - interval '7 days')
          or exists (
            select 1 from public.eclipsepay_webhook_inbox e
            where e.operation_id = q.operation_id and e.processed_at is null
          )
        )
      order by q.next_check_at, q.created_at
      limit 1 for update skip locked
    )
  returning p.*;
end $fn$;
revoke all on function public.claim_eclipsepay_payment_link_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_eclipsepay_payment_link_reconciliation(uuid)
  to service_role;

commit;
