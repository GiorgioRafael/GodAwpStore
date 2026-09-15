-- EclipsePay is opt-in per deployment. Legacy RPC names remain for compatibility.
-- Extend only provider predicates, preserving stock/ledger/ticket/cancellation logic.
begin;
set local lock_timeout = '5s';

alter table public.robux_orders drop constraint robux_orders_payment_provider_valid;
alter table public.robux_orders add constraint robux_orders_payment_provider_valid check (payment_provider in ('livepix','eclipsepay'));
alter table public.roulette_coin_purchases drop constraint roulette_coin_purchases_provider;
alter table public.roulette_coin_purchases add constraint roulette_coin_purchases_provider check (payment_provider in ('livepix','eclipsepay'));

do $migration$
declare r record; original text; patched text;
begin
  for r in select p.oid, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname || '.' || p.proname) = any(array[
      'private.customer_rank_total_spent',
      'public.find_robux_livepix_checkout_by_reference',
      'public.confirm_robux_livepix_payment',
      'public.register_livepix_checkout',
      'public.expire_unpaid_orders',
      'public.claim_livepix_checkout',
      'public.register_claimed_livepix_checkout',
      'public.confirm_livepix_payment_without_stock_commit',
      'public.get_admin_order_metrics',
      'public.get_admin_order_daily_series',
      'public.create_bot_upsell_offer',
      'public.complete_lead_recovery_delivery',
      'public.claim_lead_recovery_offers',
      'public.finalize_lead_recovery_offer_with_legacy_reservation',
      'private.enforce_order_payment_deadline',
      'private.expire_unpaid_order',
      'public.confirm_roulette_coin_purchase',
      'public.cancel_discord_unpaid_order',
      'public.fail_lead_recovery_delivery'
    ]) and p.prokind='f'
  loop
    original := pg_get_functiondef(r.oid);
    patched := replace(original, 'payment_provider = ''livepix''', 'payment_provider in (''livepix'',''eclipsepay'')');
    patched := replace(patched, 'payment_provider <> ''livepix''', 'payment_provider not in (''livepix'',''eclipsepay'')');
    -- Ledger provider must be the actual gateway, not merely the legacy RPC name.
    if r.proname = 'confirm_livepix_payment_without_stock_commit' then
      patched := replace(patched, E'    ''livepix'',\n', E'    (case when p_provider_reference like ''ep:%'' then ''eclipsepay'' else ''livepix'' end),\n');
      patched := replace(patched, 'event.provider = ''livepix''', 'event.provider = (case when p_provider_reference like ''ep:%'' then ''eclipsepay'' else ''livepix'' end)');
    end if;
    if original = patched then raise exception 'Expected provider predicate absent in %', r.proname; end if;
    execute patched;
  end loop;
  -- Atomically tag a checkout at registration. Existing references cannot change.
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('register_livepix_checkout','register_claimed_livepix_checkout','register_claimed_robux_livepix_checkout','register_roulette_coin_checkout')
  loop
    original := pg_get_functiondef(r.oid);
    patched := replace(original,
      'payment_provider_reference = btrim(p_provider_reference),',
      'payment_provider = case when p_provider_reference like ''ep:%'' then ''eclipsepay'' else ''livepix'' end, payment_provider_reference = btrim(p_provider_reference),');
    if original = patched then raise exception 'Checkout registration predicate absent'; end if;
    execute patched;
  end loop;
end $migration$;

do $views$
declare r record;
begin
  for r in select viewname, definition from pg_views where schemaname='public'
    and viewname in ('admin_paid_pix_metrics','discord_bots_admin_monthly_revenue','discord_bots_admin_companies')
  loop
    execute format('create or replace view public.%I as %s', r.viewname,
      replace(r.definition, 'payment_provider = ''livepix''::text', 'payment_provider = any(array[''livepix''::text,''eclipsepay''::text])'));
  end loop;
end $views$;

create table public.eclipsepay_checkouts (
  order_id uuid primary key,
  order_kind text not null check (order_kind in ('items','robux','coins')),
  amount_cents bigint not null check (amount_cents between 80 and 100000),
  checkout_token text not null unique default replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  operation_id uuid unique,
  br_code text,
  expires_at timestamptz,
  operation_status text not null default 'pending' check (operation_status in ('pending','completed','failed','refunded')),
  provider_updated_at timestamptz,
  confirmed_at timestamptz,
  processed_at timestamptz,
  next_check_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  review_required boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.eclipsepay_checkouts enable row level security;
revoke all on public.eclipsepay_checkouts from public, anon, authenticated;
grant select, insert, update on public.eclipsepay_checkouts to service_role;
create index eclipsepay_checkouts_due on public.eclipsepay_checkouts(next_check_at) where processed_at is null;

create table public.eclipsepay_webhook_inbox (
  event_id uuid primary key,
  operation_id uuid not null,
  event_type text not null check (event_type in ('charge.created','charge.paid','charge.failed','charge.refunded')),
  resource_version bigint not null check (resource_version >= 0),
  amount_cents bigint not null check (amount_cents > 0),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.eclipsepay_webhook_inbox enable row level security;
revoke all on public.eclipsepay_webhook_inbox from public, anon, authenticated;
grant select, insert, update on public.eclipsepay_webhook_inbox to service_role;
create index eclipsepay_webhook_inbox_pending on public.eclipsepay_webhook_inbox(operation_id,resource_version) where processed_at is null;

create function public.prepare_eclipsepay_checkout(p_order_id uuid, p_amount_cents bigint)
returns setof public.eclipsepay_checkouts
language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_id uuid; v_kind text; v_amount bigint; v_count int; v_reference text; v_row public.eclipsepay_checkouts%rowtype;
begin
  -- UUID is the durable idempotency key; no secrets or API calls inside this lock.
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,0));
  select count(*) into v_count from (
    select id from public.orders where id=p_order_id
    union all select id from public.robux_orders where id=p_order_id
    union all select id from public.roulette_coin_purchases where id=p_order_id
  ) s;
  if v_count <> 1 then raise exception 'Payment order missing or ambiguous'; end if;
  select id, 'items', sale_price_cents, payment_provider_reference into v_id,v_kind,v_amount,v_reference
    from public.orders where id=p_order_id and status='awaiting_payment' and payment_status in ('uninitialized','pending') and payment_expires_at>now() for update;
  if v_id is null then
    select id, 'robux', amount_cents, payment_provider_reference into v_id,v_kind,v_amount,v_reference
      from public.robux_orders where id=p_order_id and status='awaiting_payment' and payment_status in ('uninitialized','pending') for update;
  end if;
  if v_id is null then
    select id, 'coins', amount_cents, payment_provider_reference into v_id,v_kind,v_amount,v_reference
      from public.roulette_coin_purchases where id=p_order_id and status='awaiting_payment' for update;
  end if;
  if v_id is null or v_amount is distinct from p_amount_cents or v_amount not between 80 and 100000 then
    raise exception 'Invalid EclipsePay order or amount';
  end if;
  if v_reference is not null and v_reference not like 'ep:%' then raise exception 'Order already belongs to LivePix'; end if;
  insert into public.eclipsepay_checkouts(order_id,order_kind,amount_cents) values(v_id,v_kind,v_amount) on conflict(order_id) do nothing;
  select * into strict v_row from public.eclipsepay_checkouts where order_id=v_id;
  if v_row.amount_cents<>v_amount or v_row.order_kind<>v_kind then raise exception 'EclipsePay idempotency conflict'; end if;
  return next v_row;
end $fn$;
revoke all on function public.prepare_eclipsepay_checkout(uuid,bigint) from public, anon, authenticated;
grant execute on function public.prepare_eclipsepay_checkout(uuid,bigint) to service_role;

create function public.register_eclipsepay_operation(p_order_id uuid, p_operation_id uuid, p_br_code text default null, p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_row public.eclipsepay_checkouts%rowtype; v_table text; v_reference text;
begin
  select * into strict v_row from public.eclipsepay_checkouts where order_id=p_order_id for update;
  if p_operation_id is null then raise exception 'EclipsePay operation required'; end if;
  if v_row.operation_id is not null and v_row.operation_id<>p_operation_id then raise exception 'EclipsePay operation conflict'; end if;
  v_table := case v_row.order_kind when 'items' then 'orders' when 'robux' then 'robux_orders' when 'coins' then 'roulette_coin_purchases' end;
  execute format('select payment_provider_reference from public.%I where id=$1 for update',v_table) into v_reference using p_order_id;
  if v_reference is not null and v_reference<>('ep:'||p_operation_id::text) then raise exception 'Checkout provider conflict'; end if;
  -- Persist the mapping and order reference together, so webhook reconciliation
  -- does not depend on a browser retry after an interrupted checkout response.
  execute format('update public.%I set payment_provider=''eclipsepay'', payment_provider_reference=$2, payment_checkout_url=$3 where id=$1',v_table)
    using p_order_id, 'ep:'||p_operation_id::text, 'https://gwstore.vercel.app/pagamento/pix/'||v_row.checkout_token;
  if v_row.order_kind='items' then
    update public.orders set payment_status='pending' where id=p_order_id and payment_status='uninitialized';
  elsif v_row.order_kind='robux' then
    update public.robux_orders set payment_status='pending' where id=p_order_id and payment_status='uninitialized';
  end if;
  update public.eclipsepay_checkouts set operation_id=p_operation_id, br_code=p_br_code, expires_at=p_expires_at where order_id=p_order_id;
end $fn$;
revoke all on function public.register_eclipsepay_operation(uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.register_eclipsepay_operation(uuid,uuid,text,timestamptz) to service_role;

create function public.claim_eclipsepay_reconciliation(p_token uuid)
returns setof public.eclipsepay_checkouts
language plpgsql security definer set search_path=pg_catalog as $fn$
begin
  return query
  update public.eclipsepay_checkouts c
    set lease_token=p_token, lease_until=now()+interval '3 minutes'
    where c.order_id = (
      select q.order_id from public.eclipsepay_checkouts q
      where q.operation_id is not null and (q.lease_until is null or q.lease_until<now())
        and q.next_check_at<=now()
        and (
          (q.processed_at is null and q.created_at>now()-interval '7 days')
          or exists(select 1 from public.eclipsepay_webhook_inbox e where e.operation_id=q.operation_id and e.processed_at is null)
        )
      order by exists(select 1 from public.eclipsepay_webhook_inbox e where e.operation_id=q.operation_id and e.processed_at is null) desc,
        q.next_check_at limit 1 for update skip locked
    )
  returning c.*;
end $fn$;
revoke all on function public.claim_eclipsepay_reconciliation(uuid) from public, anon, authenticated;
grant execute on function public.claim_eclipsepay_reconciliation(uuid) to service_role;
commit;
