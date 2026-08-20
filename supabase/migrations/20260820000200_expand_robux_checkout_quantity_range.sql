-- Keep historical orders valid while enforcing the new checkout range in the
-- only order-creation RPC. The table constraint keeps the upper-bound guard
-- for every write without invalidating older paid orders below 100 Robux.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '15s';

alter table public.robux_orders
  drop constraint if exists robux_orders_quantity_range;

alter table public.robux_orders
  add constraint robux_orders_quantity_range
  check (robux_quantity between 29 and 500000);

create or replace function public.create_robux_livepix_order(
  p_discord_guild_id text,
  p_buyer_discord_id text,
  p_discord_interaction_id text,
  p_robux_quantity integer
)
returns table (
  order_id uuid,
  amount_cents bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_guild_id uuid;
  v_order public.robux_orders%rowtype;
  v_amount_cents bigint;
begin
  if p_discord_guild_id !~ '^[0-9]{15,22}$'
    or p_buyer_discord_id !~ '^[0-9]{15,22}$'
    or p_discord_interaction_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord identifiers are invalid.';
  end if;
  if p_robux_quantity not between 100 and 500000 then
    raise exception using errcode = '22023', message = 'Robux quantity is outside the allowed range.';
  end if;

  select guild.id
  into v_guild_id
  from public.guilds as guild
  where guild.discord_guild_id = p_discord_guild_id
    and guild.status = 'active'
    and guild.archived_at is null;
  if v_guild_id is null then
    raise exception using errcode = 'P0002', message = 'Active Discord guild was not found.';
  end if;

  v_amount_cents := ((p_robux_quantity::bigint * 3500 + 999) / 1000);

  insert into public.robux_orders (
    guild_id,
    buyer_discord_id,
    discord_interaction_id,
    robux_quantity,
    amount_cents
  )
  values (
    v_guild_id,
    p_buyer_discord_id,
    p_discord_interaction_id,
    p_robux_quantity,
    v_amount_cents
  )
  on conflict (discord_interaction_id) do nothing
  returning * into v_order;

  if not found then
    select order_row.*
    into v_order
    from public.robux_orders as order_row
    where order_row.discord_interaction_id = p_discord_interaction_id;

    if v_order.guild_id <> v_guild_id
      or v_order.buyer_discord_id <> p_buyer_discord_id
      or v_order.robux_quantity <> p_robux_quantity then
      raise exception using errcode = '22000', message = 'Discord interaction does not match its original Robux order.';
    end if;
  end if;

  return query select v_order.id, v_order.amount_cents;
end
$$;

commit;
