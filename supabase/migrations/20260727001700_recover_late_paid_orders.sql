-- Money that arrives after the payment window must never end in silence.
--
-- private.enforce_order_payment_deadline() already stamps late_payment_detected_at
-- when a Pix lands on an order the deadline had cancelled. Nothing reacted to it:
-- the LivePix webhook answered `{ ticket: "not_applicable" }` and returned 200, so
-- the buyer was charged, got no item, and had no channel to ask in. Two orders from
-- one buyer hit this on 2026-07-27 (R$ 10,30).
--
-- This adds the two things the reaction needs: a way to find those orders, and a
-- way to record the ticket opened for them without touching the order's own state
-- machine.

begin;

set local lock_timeout = '5s';

-- The reconciliation runs every five minutes and asks the same narrow question.
create index if not exists orders_late_payment_without_ticket_idx
  on public.orders (late_payment_detected_at)
  where late_payment_detected_at is not null
    and discord_ticket_channel_id is null;

comment on column public.orders.late_payment_detected_at is
  'When a payment landed on an order the deadline had already cancelled. Every row with this set owes the buyer an answer.';

/**
 * Lists the buyers who paid after their order closed and have nowhere to ask
 * about it. Service-role only: the reconciliation and the webhook are the
 * callers, neither of which carries a JWT.
 */
create or replace function public.list_late_paid_orders_without_ticket(p_limit integer default 50)
returns table (
  late_order_id uuid,
  late_guild_discord_id text,
  late_buyer_discord_id text,
  late_product_name text,
  late_quantity integer,
  late_amount_cents bigint,
  late_detected_at timestamptz
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
    orders.late_payment_detected_at
  from public.orders as orders
  join public.guilds as guild on guild.id = orders.guild_id
  left join public.products as product on product.id = orders.product_id
  where orders.late_payment_detected_at is not null
    and orders.discord_ticket_channel_id is null
  order by orders.late_payment_detected_at
  limit greatest(coalesce(p_limit, 50), 1);
$$;

revoke all on function public.list_late_paid_orders_without_ticket(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_late_paid_orders_without_ticket(integer) to service_role;

/**
 * Records the channel opened for a late payment. It deliberately does not touch
 * status, payment_status or stock: whether the buyer gets the item or the money
 * back is a decision for the team, taken in that channel.
 */
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
    raise exception using
      errcode = 'P0002',
      message = 'Order was not found.';
  end if;

  if v_order.late_payment_detected_at is null then
    raise exception using
      errcode = 'P0018',
      message = 'This order did not receive a late payment.';
  end if;

  update public.orders as orders
  set
    discord_ticket_channel_id = p_channel_id,
    discord_ticket_status = 'open',
    discord_ticket_claimed_at = coalesce(orders.discord_ticket_claimed_at, clock_timestamp())
  where orders.id = v_order.id
  returning * into v_order;

  return query select v_order.id, v_order.discord_ticket_channel_id;
end;
$$;

revoke all on function public.record_late_payment_ticket(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_late_payment_ticket(uuid, text) to service_role;

comment on function public.list_late_paid_orders_without_ticket(integer) is
  'Buyers who paid after their order was cancelled and still have no channel to ask about it.';
comment on function public.record_late_payment_ticket(uuid, text) is
  'Stores the recovery channel for a late payment without deciding the order outcome.';

commit;
