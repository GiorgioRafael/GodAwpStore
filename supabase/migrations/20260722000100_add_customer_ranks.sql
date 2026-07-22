-- Customer ranks are calculated from confirmed, non-refunded LivePix sales in
-- each Discord guild. Checkout RPC wrappers verify rank discounts against the
-- database before delegating to the existing stock-reservation primitives.

begin;

set local lock_timeout = '5s';

create table public.customer_rank_levels (
  code text primary key,
  name text not null unique,
  role_name text not null unique,
  minimum_spend_cents bigint not null unique,
  discount_bps integer not null,
  color integer not null,
  sort_order integer not null unique,
  created_at timestamptz not null default now(),
  constraint customer_rank_levels_code_format
    check (code ~ '^[a-z][a-z0-9_]{2,31}$'),
  constraint customer_rank_levels_name_not_blank
    check (btrim(name) <> '' and char_length(name) <= 64),
  constraint customer_rank_levels_role_name_not_blank
    check (btrim(role_name) <> '' and char_length(role_name) <= 100),
  constraint customer_rank_levels_minimum_spend_positive
    check (minimum_spend_cents > 0),
  constraint customer_rank_levels_discount_range
    check (discount_bps between 1 and 9000),
  constraint customer_rank_levels_color_range
    check (color between 0 and 16777215),
  constraint customer_rank_levels_sort_order_positive
    check (sort_order > 0)
);

insert into public.customer_rank_levels (
  code,
  name,
  role_name,
  minimum_spend_cents,
  discount_bps,
  color,
  sort_order
)
values
  ('bronze_i', 'Bronze I', '🥉 Cliente Bronze I', 500, 100, 9194031, 1),
  ('bronze_ii', 'Bronze II', '🥉 Cliente Bronze II', 1500, 100, 10903093, 2),
  ('bronze_iii', 'Bronze III', '🥉 Cliente Bronze III', 3000, 100, 13467442, 3),
  ('prata_i', 'Prata I', '🥈 Cliente Prata I', 5000, 200, 9016222, 4),
  ('prata_ii', 'Prata II', '🥈 Cliente Prata II', 8000, 200, 11186877, 5),
  ('prata_iii', 'Prata III', '🥈 Cliente Prata III', 12000, 200, 14080735, 6),
  ('ouro_i', 'Ouro I', '🥇 Cliente Ouro I', 25000, 500, 12024095, 7),
  ('ouro_ii', 'Ouro II', '🥇 Cliente Ouro II', 40000, 500, 14065198, 8),
  ('ouro_iii', 'Ouro III', '🥇 Cliente Ouro III', 60000, 500, 15381256, 9),
  ('ouro_iv', 'Ouro IV', '🥇 Cliente Ouro IV', 80000, 500, 16436245, 10),
  ('ouro_v', 'Ouro V', '🥇 Cliente Ouro V', 100000, 500, 16769126, 11),
  ('diamond_i', 'Diamond I', '💎 Cliente Diamond I', 150000, 1000, 1936632, 12),
  ('diamond_ii', 'Diamond II', '💎 Cliente Diamond II', 200000, 1000, 3057919, 13),
  ('diamond_iii', 'Diamond III', '💎 Cliente Diamond III', 300000, 1000, 3718648, 14),
  ('diamond_iv', 'Diamond IV', '💎 Cliente Diamond IV', 400000, 1000, 6809849, 15),
  ('diamond_v', 'Diamond V', '💎 Cliente Diamond V', 500000, 1000, 10875900, 16);

create table public.guild_customer_rank_roles (
  guild_id uuid not null references public.guilds (id) on delete cascade,
  rank_code text not null references public.customer_rank_levels (code) on delete restrict,
  discord_role_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, rank_code),
  constraint guild_customer_rank_roles_discord_role_id_format
    check (discord_role_id ~ '^[0-9]{15,22}$'),
  constraint guild_customer_rank_roles_discord_role_unique
    unique (guild_id, discord_role_id)
);

create table public.guild_customer_rank_role_syncs (
  guild_id uuid primary key references public.guilds (id) on delete cascade,
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint guild_customer_rank_role_syncs_claim_state check (
    (claim_token is null and claimed_at is null)
    or (claim_token is not null and claimed_at is not null)
  ),
  constraint guild_customer_rank_role_syncs_error_length check (
    last_error is null or char_length(last_error) <= 500
  )
);

create trigger guild_customer_rank_roles_set_updated_at
before update on public.guild_customer_rank_roles
for each row execute function private.set_updated_at();

create trigger guild_customer_rank_role_syncs_set_updated_at
before update on public.guild_customer_rank_role_syncs
for each row execute function private.set_updated_at();

alter table public.customer_rank_levels enable row level security;
alter table public.customer_rank_levels force row level security;
alter table public.guild_customer_rank_roles enable row level security;
alter table public.guild_customer_rank_roles force row level security;
alter table public.guild_customer_rank_role_syncs enable row level security;
alter table public.guild_customer_rank_role_syncs force row level security;

revoke all on table public.customer_rank_levels
  from public, anon, authenticated, service_role;
grant select on table public.customer_rank_levels to service_role;

revoke all on table public.guild_customer_rank_roles
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.guild_customer_rank_roles
  to service_role;

revoke all on table public.guild_customer_rank_role_syncs
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.guild_customer_rank_role_syncs
  to service_role;

alter table public.orders
  drop constraint if exists orders_discount_consistency;
alter table public.orders
  add constraint orders_discount_consistency check (
    subtotal_price_cents >= sale_price_cents
    and discount_amount_cents = subtotal_price_cents - sale_price_cents
    and discount_amount_cents = trunc(
      subtotal_price_cents::numeric * discount_bps::numeric / 10000
    )::bigint
    and (
      (discount_bps = 0 and discount_amount_cents = 0 and discount_reason is null)
      or
      (
        discount_bps > 0
        and discount_amount_cents > 0
        and discount_reason in ('server_booster', 'customer_rank')
      )
    )
  );

comment on column public.orders.discount_reason is
  'Auditable discount origin: server_booster, customer_rank or null.';

create index orders_customer_rank_spend_idx
  on public.orders (guild_id, buyer_discord_id)
  include (sale_price_cents)
  where payment_provider = 'livepix'
    and payment_status = 'paid'
    and status in ('paid', 'processing', 'delivered')
    and paid_at is not null;

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
  select coalesce(sum(order_row.sale_price_cents), 0)::bigint
  from public.orders as order_row
  where order_row.guild_id = p_guild_id
    and order_row.buyer_discord_id = p_buyer_discord_id
    and order_row.payment_provider = 'livepix'
    and order_row.payment_status = 'paid'
    and order_row.status in ('paid', 'processing', 'delivered')
    and order_row.paid_at is not null;
$$;

revoke all on function private.customer_rank_total_spent(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.customer_rank_discount_is_eligible(
  p_guild_id uuid,
  p_buyer_discord_id text,
  p_subtotal_price_cents bigint,
  p_discount_bps integer,
  p_discount_amount_cents bigint
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    p_subtotal_price_cents > 0
    and p_discount_bps > 0
    and p_discount_amount_cents > 0
    and p_discount_amount_cents = trunc(
      p_subtotal_price_cents::numeric * p_discount_bps::numeric / 10000
    )::bigint
    and exists (
      select 1
      from public.customer_rank_levels as level
      where level.discount_bps = p_discount_bps
        and level.minimum_spend_cents <= private.customer_rank_total_spent(
          p_guild_id,
          p_buyer_discord_id
        )
    );
$$;

revoke all on function private.customer_rank_discount_is_eligible(uuid, text, bigint, integer, bigint)
  from public, anon, authenticated, service_role;

create function public.get_customer_rank_progress(
  p_guild_id uuid,
  p_buyer_discord_id text
)
returns table (
  guild_id uuid,
  buyer_discord_id text,
  total_spent_cents bigint,
  current_rank_code text,
  current_rank_name text,
  current_rank_role_name text,
  current_rank_minimum_spend_cents bigint,
  current_rank_discount_bps integer,
  current_rank_color integer,
  current_rank_sort_order integer,
  next_rank_code text,
  next_rank_name text,
  next_rank_role_name text,
  next_rank_minimum_spend_cents bigint,
  next_rank_discount_bps integer,
  next_rank_color integer,
  next_rank_sort_order integer,
  amount_to_next_rank_cents bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_total bigint;
  v_current public.customer_rank_levels%rowtype;
  v_next public.customer_rank_levels%rowtype;
begin
  if p_guild_id is null or not exists (
    select 1
    from public.guilds as guild
    where guild.id = p_guild_id
      and guild.status = 'active'
      and guild.archived_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'Active Discord guild was not found.';
  end if;
  if p_buyer_discord_id is null or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord buyer ID is invalid.';
  end if;

  v_total := private.customer_rank_total_spent(p_guild_id, p_buyer_discord_id);

  select level.*
  into v_current
  from public.customer_rank_levels as level
  where level.minimum_spend_cents <= v_total
  order by level.minimum_spend_cents desc
  limit 1;

  select level.*
  into v_next
  from public.customer_rank_levels as level
  where level.minimum_spend_cents > v_total
  order by level.minimum_spend_cents
  limit 1;

  return query
  select
    p_guild_id,
    p_buyer_discord_id,
    v_total,
    v_current.code,
    v_current.name,
    v_current.role_name,
    v_current.minimum_spend_cents,
    v_current.discount_bps,
    v_current.color,
    v_current.sort_order,
    v_next.code,
    v_next.name,
    v_next.role_name,
    v_next.minimum_spend_cents,
    v_next.discount_bps,
    v_next.color,
    v_next.sort_order,
    case
      when v_next.code is null then 0::bigint
      else greatest(v_next.minimum_spend_cents - v_total, 0::bigint)
    end;
end;
$$;

comment on function public.get_customer_rank_progress(uuid, text) is
  'Returns paid spend, current rank and progress to the next rank for one Discord customer in one guild.';

revoke all on function public.get_customer_rank_progress(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_customer_rank_progress(uuid, text)
  to service_role;

create function public.claim_customer_rank_role_sync(
  p_guild_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_guild_id is null or p_claim_token is null then
    raise exception using errcode = '22023', message = 'Customer rank role claim is invalid.';
  end if;

  insert into public.guild_customer_rank_role_syncs (
    guild_id,
    claim_token,
    claimed_at,
    last_error
  )
  values (p_guild_id, p_claim_token, now(), null)
  on conflict (guild_id) do nothing;

  if found then return true; end if;

  update public.guild_customer_rank_role_syncs
  set
    claim_token = p_claim_token,
    claimed_at = now(),
    last_error = null
  where guild_id = p_guild_id
    and (
      claim_token is null
      or claimed_at < now() - interval '2 minutes'
    );

  return found;
end;
$$;

create function public.release_customer_rank_role_sync(
  p_guild_id uuid,
  p_claim_token uuid,
  p_succeeded boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_guild_id is null or p_claim_token is null or p_succeeded is null then
    raise exception using errcode = '22023', message = 'Customer rank role release is invalid.';
  end if;

  update public.guild_customer_rank_role_syncs
  set
    claim_token = null,
    claimed_at = null,
    completed_at = case when p_succeeded then now() else completed_at end,
    last_error = case
      when p_succeeded then null
      else left(coalesce(nullif(btrim(p_error), ''), 'Unknown Discord role sync error.'), 500)
    end
  where guild_id = p_guild_id
    and claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on function public.claim_customer_rank_role_sync(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_customer_rank_role_sync(uuid, uuid)
  to service_role;

revoke all on function public.release_customer_rank_role_sync(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.release_customer_rank_role_sync(uuid, uuid, boolean, text)
  to service_role;

create function public.create_ranked_bot_order_with_reservation(
  p_interaction_id text,
  p_guild_id uuid,
  p_whitelist_entry_id uuid,
  p_product_id uuid,
  p_buyer_discord_id text,
  p_quantity integer,
  p_subtotal_price_cents bigint,
  p_sale_price_cents bigint,
  p_discount_bps integer,
  p_discount_amount_cents bigint,
  p_discount_reason text,
  p_commission_bps integer
)
returns table (
  created_order_id uuid,
  resulting_status public.order_status,
  was_created boolean,
  out_of_stock boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payment_reference text;
  v_existing public.orders%rowtype;
  v_result record;
  v_delegate_reason text;
begin
  if p_interaction_id is null or p_interaction_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord interaction ID is invalid.';
  end if;
  if p_buyer_discord_id is null or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord buyer ID is invalid.';
  end if;
  if p_discount_reason is not null
    and p_discount_reason not in ('server_booster', 'customer_rank') then
    raise exception using errcode = '22023', message = 'Order discount reason is invalid.';
  end if;

  v_payment_reference := 'discord:' || p_interaction_id;
  perform pg_advisory_xact_lock(hashtextextended(v_payment_reference, 0));

  select order_row.*
  into v_existing
  from public.orders as order_row
  where order_row.payment_reference = v_payment_reference;

  if found then
    if v_existing.guild_id <> p_guild_id
      or v_existing.seller_whitelist_entry_id <> p_whitelist_entry_id
      or v_existing.product_id <> p_product_id
      or v_existing.buyer_discord_id <> p_buyer_discord_id
      or v_existing.quantity <> p_quantity
      or v_existing.subtotal_price_cents <> p_subtotal_price_cents
      or v_existing.sale_price_cents <> p_sale_price_cents
      or v_existing.discount_bps <> p_discount_bps
      or v_existing.discount_amount_cents <> p_discount_amount_cents
      or v_existing.discount_reason is distinct from p_discount_reason
      or v_existing.commission_bps <> p_commission_bps then
      raise exception using errcode = '22000', message = 'Discord interaction is already bound to another order.';
    end if;
    return query select v_existing.id, v_existing.status, false, false;
    return;
  end if;

  if p_discount_reason = 'customer_rank' and not private.customer_rank_discount_is_eligible(
    p_guild_id,
    p_buyer_discord_id,
    p_subtotal_price_cents,
    p_discount_bps,
    p_discount_amount_cents
  ) then
    raise exception using errcode = '42501', message = 'Customer rank discount is not eligible.';
  end if;

  v_delegate_reason := case
    when p_discount_reason = 'customer_rank' then 'server_booster'
    else p_discount_reason
  end;

  select *
  into strict v_result
  from public.create_bot_order_with_reservation(
    p_interaction_id,
    p_guild_id,
    p_whitelist_entry_id,
    p_product_id,
    p_buyer_discord_id,
    p_quantity,
    p_subtotal_price_cents,
    p_sale_price_cents,
    p_discount_bps,
    p_discount_amount_cents,
    v_delegate_reason,
    p_commission_bps
  );

  if p_discount_reason = 'customer_rank' and v_result.created_order_id is not null then
    update public.orders
    set discount_reason = 'customer_rank'
    where id = v_result.created_order_id
      and discount_reason = 'server_booster';

    if v_result.was_created then
      insert into public.audit_events (action, entity_type, entity_id, metadata)
      values (
        'bot.order.customer_rank_discount',
        'order',
        v_result.created_order_id,
        jsonb_build_object(
          'buyer_discord_id', p_buyer_discord_id,
          'guild_id', p_guild_id,
          'discount_bps', p_discount_bps,
          'discount_amount_cents', p_discount_amount_cents,
          'discount_reason', 'customer_rank'
        )
      );
    end if;
  end if;

  return query
  select
    v_result.created_order_id::uuid,
    v_result.resulting_status::public.order_status,
    v_result.was_created::boolean,
    v_result.out_of_stock::boolean;
end;
$$;

comment on function public.create_ranked_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer) is
  'Creates a single-product Discord order after verifying any customer-rank discount against paid guild spend.';

revoke all on function public.create_ranked_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_ranked_bot_order_with_reservation(text, uuid, uuid, uuid, text, integer, bigint, bigint, integer, bigint, text, integer)
  to service_role;

create function public.create_ranked_bot_cart_with_reservation(
  p_interaction_id text,
  p_guild_id uuid,
  p_whitelist_entry_id uuid,
  p_buyer_discord_id text,
  p_items jsonb,
  p_discount_bps integer,
  p_discount_reason text,
  p_commission_bps integer
)
returns table (
  checkout_order_id uuid,
  was_created boolean,
  out_of_stock boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payment_reference text;
  v_existing public.orders%rowtype;
  v_normalized_items jsonb;
  v_existing_items jsonb;
  v_total_subtotal bigint;
  v_discount_amount bigint;
  v_result record;
  v_delegate_reason text;
begin
  if p_interaction_id is null or p_interaction_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord interaction ID is invalid.';
  end if;
  if p_buyer_discord_id is null or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord buyer ID is invalid.';
  end if;
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 3 then
    raise exception using errcode = '22023', message = 'Cart must contain between one and three products.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(item)
    where case
      when jsonb_typeof(entry.item) <> 'object' then true
      when jsonb_typeof(entry.item -> 'product_id') is distinct from 'string' then true
      when coalesce(entry.item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then true
      when jsonb_typeof(entry.item -> 'quantity') is distinct from 'number' then true
      when coalesce(entry.item ->> 'quantity', '') !~ '^[0-9]{1,5}$' then true
      else (entry.item ->> 'quantity')::integer not between 1 and 10000
    end
  ) then
    raise exception using errcode = '22023', message = 'Cart item is invalid.';
  end if;
  if p_discount_reason is not null
    and p_discount_reason not in ('server_booster', 'customer_rank') then
    raise exception using errcode = '22023', message = 'Cart discount reason is invalid.';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'product_id', lower(entry.item ->> 'product_id'),
      'quantity', (entry.item ->> 'quantity')::integer
    )
    order by entry.position
  )
  into v_normalized_items
  from jsonb_array_elements(p_items) with ordinality as entry(item, position);

  if (
    select count(distinct item ->> 'product_id')
    from jsonb_array_elements(v_normalized_items) as normalized(item)
  ) <> jsonb_array_length(v_normalized_items) then
    raise exception using errcode = '22023', message = 'Cart products must be unique.';
  end if;

  v_payment_reference := 'discord:' || p_interaction_id;
  perform pg_advisory_xact_lock(hashtextextended(v_payment_reference, 0));

  select order_row.*
  into v_existing
  from public.orders as order_row
  where order_row.payment_reference = v_payment_reference;

  if found then
    select jsonb_agg(
      jsonb_build_object(
        'product_id', item.product_id::text,
        'quantity', item.quantity
      )
      order by item.position
    )
    into v_existing_items
    from public.order_items as item
    where item.order_id = v_existing.id;

    if v_existing.guild_id <> p_guild_id
      or v_existing.seller_whitelist_entry_id <> p_whitelist_entry_id
      or v_existing.buyer_discord_id <> p_buyer_discord_id
      or v_existing.discount_bps <> p_discount_bps
      or v_existing.discount_reason is distinct from p_discount_reason
      or v_existing.commission_bps <> p_commission_bps
      or v_existing_items is distinct from v_normalized_items then
      raise exception using errcode = '22000', message = 'Discord interaction is already bound to another purchase.';
    end if;
    return query select v_existing.id, false, false;
    return;
  end if;

  if p_discount_reason = 'customer_rank' then
    select
      coalesce(sum(product.minimum_price_cents * (entry.item ->> 'quantity')::integer), 0)::bigint
    into v_total_subtotal
    from jsonb_array_elements(v_normalized_items) as entry(item)
    join public.products as product
      on product.id = (entry.item ->> 'product_id')::uuid;

    v_discount_amount := trunc(
      v_total_subtotal::numeric * p_discount_bps::numeric / 10000
    )::bigint;

    if not private.customer_rank_discount_is_eligible(
      p_guild_id,
      p_buyer_discord_id,
      v_total_subtotal,
      p_discount_bps,
      v_discount_amount
    ) then
      raise exception using errcode = '42501', message = 'Customer rank discount is not eligible.';
    end if;
  end if;

  v_delegate_reason := case
    when p_discount_reason = 'customer_rank' then 'server_booster'
    else p_discount_reason
  end;

  select *
  into strict v_result
  from public.create_bot_cart_with_reservation(
    p_interaction_id,
    p_guild_id,
    p_whitelist_entry_id,
    p_buyer_discord_id,
    p_items,
    p_discount_bps,
    v_delegate_reason,
    p_commission_bps
  );

  if p_discount_reason = 'customer_rank' and v_result.checkout_order_id is not null then
    update public.orders
    set discount_reason = 'customer_rank'
    where id = v_result.checkout_order_id
      and discount_reason = 'server_booster';

    if v_result.was_created then
      insert into public.audit_events (action, entity_type, entity_id, metadata)
      values (
        'bot.order.customer_rank_discount',
        'order',
        v_result.checkout_order_id,
        jsonb_build_object(
          'buyer_discord_id', p_buyer_discord_id,
          'guild_id', p_guild_id,
          'discount_bps', p_discount_bps,
          'discount_amount_cents', v_discount_amount,
          'discount_reason', 'customer_rank'
        )
      );
    end if;
  end if;

  return query
  select
    v_result.checkout_order_id::uuid,
    v_result.was_created::boolean,
    v_result.out_of_stock::boolean;
end;
$$;

comment on function public.create_ranked_bot_cart_with_reservation(text, uuid, uuid, text, jsonb, integer, text, integer) is
  'Creates a one-to-three product Discord cart after verifying any customer-rank discount against paid guild spend.';

revoke all on function public.create_ranked_bot_cart_with_reservation(text, uuid, uuid, text, jsonb, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_ranked_bot_cart_with_reservation(text, uuid, uuid, text, jsonb, integer, text, integer)
  to service_role;

commit;
