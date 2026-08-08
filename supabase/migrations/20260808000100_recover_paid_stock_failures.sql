-- A verified Pix can lose the last-stock race to another verified Pix. The
-- order is correctly cancelled for manual review, but it must enter the same
-- Discord safety net used by payments that arrived after expiry.

begin;

set local lock_timeout = '5s';

drop index if exists public.orders_late_payment_without_ticket_idx;

create index orders_paid_review_without_ticket_idx
  on public.orders (
    coalesce(late_payment_detected_at, stock_commit_failed_at),
    id
  )
  where discord_ticket_channel_id is null
    and (
      late_payment_detected_at is not null
      or stock_commit_failure_reason = 'insufficient_stock_after_payment'
    );

drop function if exists public.list_late_paid_orders_without_ticket(integer);

create function public.list_late_paid_orders_without_ticket(p_limit integer default 50)
returns table (
  late_order_id uuid,
  late_guild_discord_id text,
  late_buyer_discord_id text,
  late_product_name text,
  late_quantity integer,
  late_amount_cents bigint,
  late_detected_at timestamptz,
  late_reason text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    orders.id,
    guild.discord_guild_id,
    orders.buyer_discord_id,
    coalesce(product.name, 'Pedido da loja'),
    orders.quantity,
    (
      orders.sale_price_cents
      + coalesce(orders.upsell_subtotal_price_cents, 0)
      - coalesce(orders.discount_amount_cents, 0)
      - coalesce(orders.upsell_discount_amount_cents, 0)
      - coalesce(orders.lead_recovery_discount_amount_cents, 0)
    )::bigint,
    coalesce(orders.late_payment_detected_at, orders.stock_commit_failed_at),
    case
      when orders.stock_commit_failure_reason = 'insufficient_stock_after_payment'
        then 'stock_unavailable_after_payment'
      else 'late_payment'
    end
  from public.orders as orders
  join public.guilds as guild on guild.id = orders.guild_id
  left join public.products as product on product.id = orders.product_id
  where orders.discord_ticket_channel_id is null
    and (
      orders.late_payment_detected_at is not null
      or orders.stock_commit_failure_reason = 'insufficient_stock_after_payment'
    )
  order by coalesce(orders.late_payment_detected_at, orders.stock_commit_failed_at)
  limit greatest(coalesce(p_limit, 50), 1);
$$;

revoke all on function public.list_late_paid_orders_without_ticket(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_late_paid_orders_without_ticket(integer)
  to service_role;

create or replace function public.record_late_payment_ticket(
  p_order_id uuid,
  p_channel_id text
)
returns table (recorded_order_id uuid, recorded_channel_id text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_order_id is null or p_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using
      errcode = '22023',
      message = 'The order and a Discord channel are both required.';
  end if;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Order was not found.';
  end if;

  if v_order.late_payment_detected_at is null
    and v_order.stock_commit_failure_reason is distinct from 'insufficient_stock_after_payment' then
    raise exception using
      errcode = 'P0018',
      message = 'This paid order does not require a recovery ticket.';
  end if;

  update public.orders as orders
  set
    discord_ticket_channel_id = p_channel_id,
    discord_ticket_status = 'open',
    discord_ticket_claimed_at = coalesce(
      orders.discord_ticket_claimed_at,
      clock_timestamp()
    )
  where orders.id = v_order.id
  returning * into v_order;

  return query select v_order.id, v_order.discord_ticket_channel_id;
end;
$$;

revoke all on function public.record_late_payment_ticket(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_late_payment_ticket(uuid, text)
  to service_role;

comment on function public.list_late_paid_orders_without_ticket(integer) is
  'Paid orders that require manual review and still have no Discord support channel.';
comment on function public.record_late_payment_ticket(uuid, text) is
  'Stores the recovery channel for a late or stock-conflicted paid order without deciding its outcome.';

commit;
