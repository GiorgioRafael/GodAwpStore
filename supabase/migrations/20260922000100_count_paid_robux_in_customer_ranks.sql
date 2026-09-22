begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Rank spend is the sum of two independent paid ledgers. Joining the tables
-- would multiply purchases when a buyer has both item and Robux orders.
create or replace function private.customer_rank_total_spent(
  p_guild_id uuid,
  p_buyer_discord_id text
)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    (
      select coalesce(sum(o.sale_price_cents), 0)::bigint
      from public.orders as o
      where o.guild_id = p_guild_id
        and o.buyer_discord_id = p_buyer_discord_id
        and o.payment_provider in ('livepix', 'eclipsepay')
        and o.payment_status = 'paid'
        and o.status in ('paid', 'processing', 'delivered')
        and o.paid_at is not null
    ) + (
      select coalesce(sum(r.amount_cents), 0)::bigint
      from public.robux_orders as r
      where r.guild_id = p_guild_id
        and r.buyer_discord_id = p_buyer_discord_id
        and r.payment_provider in ('livepix', 'eclipsepay')
        and r.payment_status = 'paid'
        and r.status = 'paid'
        and r.paid_at is not null
    );
$$;

revoke all on function private.customer_rank_total_spent(uuid, text)
  from public, anon, authenticated, service_role;

-- These timestamps make Discord role backfill durable and retryable. A
-- successful sync marks all paid purchases of that buyer up to its start time.
alter table public.robux_orders
  add column if not exists customer_rank_role_sync_attempted_at timestamptz,
  add column if not exists customer_rank_role_synced_at timestamptz;

create index if not exists robux_orders_customer_rank_spend_idx
  on public.robux_orders (guild_id, buyer_discord_id)
  include (amount_cents)
  where payment_status = 'paid' and status = 'paid' and paid_at is not null;

create index if not exists robux_orders_customer_rank_sync_pending_idx
  on public.robux_orders (customer_rank_role_sync_attempted_at, paid_at)
  where payment_status = 'paid' and status = 'paid'
    and customer_rank_role_synced_at is null;

commit;
