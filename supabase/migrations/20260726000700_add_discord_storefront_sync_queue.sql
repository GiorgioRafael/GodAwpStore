-- Keep payment acknowledgement and ticket creation independent from the
-- potentially expensive Discord storefront fanout. One idempotent request is
-- stored per stock-committed order and a singleton lease coalesces concurrent
-- payments into a single global refresh.

begin;

set local lock_timeout = '10s';

create table public.discord_storefront_sync_requests (
  order_id uuid primary key
    references public.orders (id) on delete restrict,
  status text not null default 'pending',
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_storefront_sync_requests_status_valid check (
    status in ('pending', 'claimed', 'completed')
  ),
  constraint discord_storefront_sync_requests_attempts_valid check (
    attempts between 0 and 10000
  ),
  constraint discord_storefront_sync_requests_claim_valid check (
    (
      status = 'claimed'
      and claim_token is not null
      and claimed_at is not null
      and completed_at is null
    )
    or (
      status = 'pending'
      and claim_token is null
      and claimed_at is null
      and completed_at is null
    )
    or (
      status = 'completed'
      and claim_token is null
      and claimed_at is null
      and completed_at is not null
    )
  )
);

create index discord_storefront_sync_requests_pending_idx
  on public.discord_storefront_sync_requests (
    next_attempt_at,
    created_at,
    order_id
  )
  where status = 'pending';

create trigger discord_storefront_sync_requests_set_updated_at
before update on public.discord_storefront_sync_requests
for each row execute function private.set_updated_at();

create table public.discord_storefront_sync_worker (
  id smallint primary key default 1 check (id = 1),
  claim_token uuid,
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint discord_storefront_sync_worker_claim_valid check (
    (claim_token is null and claimed_at is null)
    or (claim_token is not null and claimed_at is not null)
  )
);

insert into public.discord_storefront_sync_worker (id) values (1);

create trigger discord_storefront_sync_worker_set_updated_at
before update on public.discord_storefront_sync_worker
for each row execute function private.set_updated_at();

alter table public.discord_storefront_sync_requests enable row level security;
alter table public.discord_storefront_sync_requests force row level security;
alter table public.discord_storefront_sync_worker enable row level security;
alter table public.discord_storefront_sync_worker force row level security;

revoke all on table public.discord_storefront_sync_requests
  from public, anon, authenticated, service_role;
revoke all on table public.discord_storefront_sync_worker
  from public, anon, authenticated, service_role;

create function public.request_discord_storefront_sync(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_order_id is null then
    raise exception using
      errcode = '22023',
      message = 'Storefront sync order ID is required.';
  end if;

  select order_row.*
  into v_order
  from public.orders as order_row
  where order_row.id = p_order_id
  for update;

  if not found
    or v_order.paid_at is null
    or v_order.payment_status <> 'paid'
    or v_order.stock_committed_at is null
    or v_order.stock_commit_failed_at is not null
    or v_order.late_payment_detected_at is not null then
    return false;
  end if;

  insert into public.discord_storefront_sync_requests (order_id)
  values (v_order.id)
  on conflict (order_id) do nothing;

  return coalesce((
    select request.status <> 'completed'
      and request.next_attempt_at <= now()
    from public.discord_storefront_sync_requests as request
    where request.order_id = v_order.id
  ), false);
end;
$$;

revoke all on function public.request_discord_storefront_sync(uuid)
  from public, anon, authenticated;
grant execute on function public.request_discord_storefront_sync(uuid)
  to service_role;

create function public.claim_discord_storefront_sync(
  p_claim_token uuid,
  p_batch_size integer default 500
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_worker public.discord_storefront_sync_worker%rowtype;
  v_claimed integer := 0;
begin
  if p_claim_token is null then
    raise exception using
      errcode = '22023',
      message = 'Storefront sync claim token is required.';
  end if;
  if p_batch_size is null or p_batch_size not between 1 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'Storefront sync batch size must be between 1 and 1000.';
  end if;

  select worker.*
  into strict v_worker
  from public.discord_storefront_sync_worker as worker
  where worker.id = 1
  for update;

  if v_worker.claim_token is not null
    and v_worker.claimed_at >= now() - interval '5 minutes' then
    return 0;
  end if;

  if v_worker.claim_token is not null then
    update public.discord_storefront_sync_requests
    set
      status = 'pending',
      claim_token = null,
      claimed_at = null,
      last_error = coalesce(last_error, 'Storefront sync worker lease expired.')
    where status = 'claimed'
      and claim_token = v_worker.claim_token;
  end if;

  update public.discord_storefront_sync_worker
  set claim_token = p_claim_token, claimed_at = now()
  where id = 1;

  with candidates as (
    select request.order_id
    from public.discord_storefront_sync_requests as request
    where request.status = 'pending'
      and request.next_attempt_at <= now()
    order by request.next_attempt_at, request.created_at, request.order_id
    limit p_batch_size
    for update skip locked
  )
  update public.discord_storefront_sync_requests as request
  set
    status = 'claimed',
    claim_token = p_claim_token,
    claimed_at = now(),
    attempts = request.attempts + 1,
    last_error = null
  from candidates
  where request.order_id = candidates.order_id;

  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    update public.discord_storefront_sync_worker
    set claim_token = null, claimed_at = null
    where id = 1
      and claim_token = p_claim_token;
  end if;

  return v_claimed;
end;
$$;

revoke all on function public.claim_discord_storefront_sync(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_discord_storefront_sync(uuid, integer)
  to service_role;

create function public.complete_discord_storefront_sync(
  p_claim_token uuid,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_worker_claim_token uuid;
begin
  if p_claim_token is null or p_success is null then
    raise exception using
      errcode = '22023',
      message = 'Storefront sync completion is invalid.';
  end if;

  select worker.claim_token
  into v_worker_claim_token
  from public.discord_storefront_sync_worker as worker
  where worker.id = 1
  for update;

  if v_worker_claim_token is distinct from p_claim_token then
    return false;
  end if;

  if p_success then
    update public.discord_storefront_sync_requests
    set
      status = 'completed',
      claim_token = null,
      claimed_at = null,
      completed_at = now(),
      last_error = null
    where status = 'claimed'
      and claim_token = p_claim_token;
  else
    update public.discord_storefront_sync_requests
    set
      status = 'pending',
      claim_token = null,
      claimed_at = null,
      next_attempt_at = now() + make_interval(
        secs => least(30 * greatest(attempts, 1), 900)
      ),
      last_error = left(
        coalesce(nullif(btrim(p_error), ''), 'storefront_sync_failed'),
        500
      )
    where status = 'claimed'
      and claim_token = p_claim_token;
  end if;

  update public.discord_storefront_sync_worker
  set claim_token = null, claimed_at = null
  where id = 1
    and claim_token = p_claim_token;

  return true;
end;
$$;

revoke all on function public.complete_discord_storefront_sync(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_discord_storefront_sync(uuid, boolean, text)
  to service_role;

commit;
