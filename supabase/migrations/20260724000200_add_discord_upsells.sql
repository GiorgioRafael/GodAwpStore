-- Transactional Discord upsells. Offers are short-lived, bound to the signed
-- Discord interaction that created them and finalized before LivePix checkout.

begin;

set local lock_timeout = '5s';

alter table public.platform_settings
  add column upsell_enabled boolean not null default true,
  add column upsell_discount_bps integer not null default 500,
  add column upsell_strategy text not null default 'automatic',
  add constraint platform_settings_upsell_discount_range
    check (upsell_discount_bps between 1 and 500),
  add constraint platform_settings_upsell_strategy_valid
    check (upsell_strategy in ('automatic', 'best_seller', 'same_product'));

comment on column public.platform_settings.upsell_discount_bps is
  'Discount applied only to the extra upsell unit. Hard-capped at 500 bps (5%).';

alter table public.orders
  add column upsell_product_id uuid references public.products (id) on delete restrict,
  add column upsell_quantity integer not null default 0,
  add column upsell_subtotal_price_cents bigint not null default 0,
  add column upsell_discount_bps integer not null default 0,
  add column upsell_discount_amount_cents bigint not null default 0;

create table public.upsell_offers (
  id uuid primary key default gen_random_uuid(),
  source_interaction_id text not null unique,
  guild_id uuid not null references public.guilds (id) on delete restrict,
  seller_whitelist_entry_id uuid not null
    references public.whitelist_entries (id) on delete restrict,
  buyer_discord_id text not null,
  base_items jsonb not null,
  base_discount_bps integer not null,
  base_discount_reason text,
  commission_bps integer not null,
  offered_product_id uuid not null references public.products (id) on delete restrict,
  offered_product_name text not null,
  offered_unit_price_cents bigint not null,
  discount_bps integer not null,
  discount_amount_cents bigint not null,
  discounted_unit_price_cents bigint not null,
  strategy text not null,
  status text not null default 'offered',
  decision_interaction_id text unique,
  order_id uuid unique references public.orders (id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upsell_offers_source_interaction_id_format
    check (source_interaction_id ~ '^[0-9]{15,22}$'),
  constraint upsell_offers_buyer_discord_id_format
    check (buyer_discord_id ~ '^[0-9]{15,22}$'),
  constraint upsell_offers_decision_interaction_id_format
    check (
      decision_interaction_id is null
      or decision_interaction_id ~ '^[0-9]{15,22}$'
    ),
  constraint upsell_offers_base_items_valid
    check (
      jsonb_typeof(base_items) = 'array'
      and jsonb_array_length(base_items) between 1 and 3
    ),
  constraint upsell_offers_base_discount_range
    check (base_discount_bps between 0 and 9000),
  constraint upsell_offers_base_discount_reason_valid
    check (
      (base_discount_bps = 0 and base_discount_reason is null)
      or (
        base_discount_bps > 0
        and base_discount_reason in ('server_booster', 'customer_rank')
      )
    ),
  constraint upsell_offers_commission_range
    check (commission_bps between 0 and 10000),
  constraint upsell_offers_price_valid
    check (
      offered_unit_price_cents > 0
      and discount_bps between 1 and 500
      and discount_amount_cents = trunc(
        offered_unit_price_cents::numeric * discount_bps::numeric / 10000
      )::bigint
      and discount_amount_cents > 0
      and discounted_unit_price_cents =
        offered_unit_price_cents - discount_amount_cents
      and discounted_unit_price_cents > 0
    ),
  constraint upsell_offers_strategy_valid
    check (strategy in ('automatic', 'best_seller', 'same_product')),
  constraint upsell_offers_status_valid
    check (status in ('offered', 'accepted', 'declined', 'expired', 'invalidated')),
  constraint upsell_offers_resolution_state check (
    (
      status = 'offered'
      and decision_interaction_id is null
      and order_id is null
      and resolved_at is null
    )
    or (
      status in ('accepted', 'declined')
      and decision_interaction_id is not null
      and order_id is not null
      and resolved_at is not null
    )
    or (
      status in ('expired', 'invalidated')
      and order_id is null
      and resolved_at is not null
    )
  )
);

alter table public.orders
  add column upsell_offer_id uuid unique
    references public.upsell_offers (id) on delete restrict;

create index upsell_offers_open_expiry_idx
  on public.upsell_offers (expires_at)
  where status = 'offered';

create trigger upsell_offers_set_updated_at
before update on public.upsell_offers
for each row execute function private.set_updated_at();

alter table public.upsell_offers enable row level security;
alter table public.upsell_offers force row level security;

revoke all on table public.upsell_offers
  from public, anon, authenticated, service_role;

alter table public.orders
  drop constraint if exists orders_discount_consistency;
alter table public.orders
  add constraint orders_discount_consistency check (
    subtotal_price_cents >= sale_price_cents
    and discount_amount_cents = subtotal_price_cents - sale_price_cents
    and upsell_quantity between 0 and 1
    and upsell_subtotal_price_cents >= 0
    and upsell_discount_bps between 0 and 500
    and upsell_discount_amount_cents >= 0
    and discount_amount_cents =
      trunc(
        (subtotal_price_cents - upsell_subtotal_price_cents)::numeric
        * discount_bps::numeric
        / 10000
      )::bigint
      + upsell_discount_amount_cents
    and (
      (
        upsell_quantity = 0
        and upsell_product_id is null
        and upsell_offer_id is null
        and upsell_subtotal_price_cents = 0
        and upsell_discount_bps = 0
        and upsell_discount_amount_cents = 0
        and (
          (discount_bps = 0 and discount_amount_cents = 0 and discount_reason is null)
          or (
            discount_bps > 0
            and discount_amount_cents > 0
            and discount_reason in ('server_booster', 'customer_rank')
          )
        )
      )
      or (
        upsell_quantity = 1
        and upsell_product_id is not null
        and upsell_offer_id is not null
        and upsell_subtotal_price_cents > 0
        and upsell_discount_bps between 1 and 500
        and upsell_discount_amount_cents = trunc(
          upsell_subtotal_price_cents::numeric
          * upsell_discount_bps::numeric
          / 10000
        )::bigint
        and upsell_discount_amount_cents > 0
        and (
          (
            discount_bps = 0
            and discount_reason = 'upsell'
          )
          or (
            discount_bps > 0
            and discount_reason in ('server_booster', 'customer_rank')
          )
        )
      )
    )
  );

comment on column public.orders.upsell_offer_id is
  'Auditable link to the server-validated Discord offer accepted for this order.';
comment on column public.orders.discount_reason is
  'Base discount origin (server_booster/customer_rank), upsell-only, or null.';

create function public.create_bot_upsell_offer(
  p_interaction_id text,
  p_guild_id uuid,
  p_whitelist_entry_id uuid,
  p_buyer_discord_id text,
  p_items jsonb,
  p_base_discount_bps integer,
  p_base_discount_reason text,
  p_commission_bps integer
)
returns table (
  offer_id uuid,
  was_created boolean,
  offered boolean,
  offered_product_id uuid,
  offered_product_name text,
  offered_unit_price_cents bigint,
  discounted_unit_price_cents bigint,
  discount_bps integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_existing public.upsell_offers%rowtype;
  v_settings public.platform_settings%rowtype;
  v_product_ids uuid[];
  v_quantities integer[];
  v_normalized_items jsonb;
  v_item_count integer;
  v_total_quantity integer;
  v_base_subtotal bigint;
  v_base_total bigint;
  v_candidate record;
  v_offer public.upsell_offers%rowtype;
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
      when coalesce(entry.item ->> 'product_id', '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then true
      when jsonb_typeof(entry.item -> 'quantity') is distinct from 'number' then true
      when coalesce(entry.item ->> 'quantity', '') !~ '^[0-9]{1,5}$' then true
      else (entry.item ->> 'quantity')::integer not between 1 and 10000
    end
  ) then
    raise exception using errcode = '22023', message = 'Cart item is invalid.';
  end if;
  if p_base_discount_bps is null or p_base_discount_bps not between 0 and 9000 then
    raise exception using errcode = '22023', message = 'Base discount is invalid.';
  end if;
  if (p_base_discount_bps = 0 and p_base_discount_reason is not null)
    or (
      p_base_discount_bps > 0
      and p_base_discount_reason not in ('server_booster', 'customer_rank')
    ) then
    raise exception using errcode = '22023', message = 'Base discount reason is invalid.';
  end if;
  if p_commission_bps is null or p_commission_bps not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'Order commission is invalid.';
  end if;

  select
    array_agg((entry.item ->> 'product_id')::uuid order by entry.position),
    array_agg((entry.item ->> 'quantity')::integer order by entry.position)
  into v_product_ids, v_quantities
  from jsonb_array_elements(p_items) with ordinality as entry(item, position);

  v_item_count := cardinality(v_product_ids);
  if (
    select count(distinct product_id)
    from unnest(v_product_ids) as product_id
  ) <> v_item_count then
    raise exception using errcode = '22023', message = 'Cart products must be unique.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('upsell:' || p_interaction_id, 0));

  select offer.*
  into v_existing
  from public.upsell_offers as offer
  where offer.source_interaction_id = p_interaction_id;

  if found then
    if v_existing.guild_id <> p_guild_id
      or v_existing.seller_whitelist_entry_id <> p_whitelist_entry_id
      or v_existing.buyer_discord_id <> p_buyer_discord_id
      or v_existing.base_discount_bps <> p_base_discount_bps
      or v_existing.base_discount_reason is distinct from p_base_discount_reason
      or v_existing.commission_bps <> p_commission_bps then
      raise exception using errcode = '22000', message = 'Discord interaction is already bound to another upsell.';
    end if;

    return query
    select
      v_existing.id,
      false,
      v_existing.status = 'offered' and v_existing.expires_at > now(),
      v_existing.offered_product_id,
      v_existing.offered_product_name,
      v_existing.offered_unit_price_cents,
      v_existing.discounted_unit_price_cents,
      v_existing.discount_bps,
      v_existing.expires_at;
    return;
  end if;

  if not exists (
    select 1
    from public.guilds as guild
    join public.whitelist_entries as whitelist
      on whitelist.id = guild.whitelist_entry_id
    where guild.id = p_guild_id
      and guild.whitelist_entry_id = p_whitelist_entry_id
      and whitelist.id = p_whitelist_entry_id
      and guild.status = 'active'
      and guild.archived_at is null
      and whitelist.is_active
      and whitelist.archived_at is null
  ) then
    raise exception using errcode = '42501', message = 'Guild owner is not authorized to sell.';
  end if;

  select settings.*
  into strict v_settings
  from public.platform_settings as settings
  where settings.id = 1;

  if not v_settings.upsell_enabled
    or v_settings.upsell_discount_bps not between 1 and 500
    or p_base_discount_bps >= v_settings.upsell_discount_bps then
    return query
    select
      null::uuid, false, false, null::uuid, null::text,
      null::bigint, null::bigint, null::integer, null::timestamptz;
    return;
  end if;

  select
    jsonb_agg(
      jsonb_build_object(
        'product_id', product.id::text,
        'quantity', v_quantities[position],
        'unit_price_cents', product.minimum_price_cents
      )
      order by position
    ),
    sum(v_quantities[position])::integer,
    sum(product.minimum_price_cents * v_quantities[position])::bigint
  into v_normalized_items, v_total_quantity, v_base_subtotal
  from generate_subscripts(v_product_ids, 1) as positions(position)
  join public.products as product on product.id = v_product_ids[position]
  join public.substores as substore on substore.id = product.substore_id
  join public.games as game on game.id = substore.game_id
  where product.status = 'active'
    and product.archived_at is null
    and product.minimum_price_cents > 0
    and substore.status = 'active'
    and substore.archived_at is null
    and game.status = 'active'
    and game.archived_at is null;

  if jsonb_array_length(coalesce(v_normalized_items, '[]'::jsonb)) <> v_item_count
    or v_total_quantity >= 10000 then
    return query
    select
      null::uuid, false, false, null::uuid, null::text,
      null::bigint, null::bigint, null::integer, null::timestamptz;
    return;
  end if;

  v_base_total := v_base_subtotal - trunc(
    v_base_subtotal::numeric * p_base_discount_bps::numeric / 10000
  )::bigint;
  if v_base_total < 100 then
    return query
    select
      null::uuid, false, false, null::uuid, null::text,
      null::bigint, null::bigint, null::integer, null::timestamptz;
    return;
  end if;

  select
    product.id,
    product.name,
    product.minimum_price_cents,
    trunc(
      product.minimum_price_cents::numeric
      * v_settings.upsell_discount_bps::numeric
      / 10000
    )::bigint as discount_amount_cents
  into v_candidate
  from public.products as product
  join public.substores as substore on substore.id = product.substore_id
  join public.games as game on game.id = substore.game_id
  left join lateral (
    select coalesce(sum(item.quantity), 0)::bigint as paid_units
    from public.order_items as item
    join public.orders as paid_order on paid_order.id = item.order_id
    where item.product_id = product.id
      and paid_order.payment_provider = 'livepix'
      and paid_order.payment_status = 'paid'
      and paid_order.status in ('paid', 'processing', 'delivered')
      and paid_order.paid_at is not null
  ) as sales on true
  where product.status = 'active'
    and product.archived_at is null
    and product.minimum_price_cents > 0
    and substore.status = 'active'
    and substore.archived_at is null
    and game.status = 'active'
    and game.archived_at is null
    and (
      v_settings.upsell_strategy <> 'same_product'
      or product.id = any(v_product_ids)
    )
    and (
      product.id = any(v_product_ids)
      or v_item_count < 3
    )
    and product.stock_quantity > coalesce(
      (
        select v_quantities[position]
        from generate_subscripts(v_product_ids, 1) as positions(position)
        where v_product_ids[position] = product.id
      ),
      0
    )
    and trunc(
      product.minimum_price_cents::numeric
      * v_settings.upsell_discount_bps::numeric
      / 10000
    )::bigint > 0
  order by
    case
      when v_settings.upsell_strategy = 'same_product'
        and product.id = any(v_product_ids) then 0
      else 1
    end,
    sales.paid_units desc,
    product.sort_order,
    product.id
  limit 1;

  if not found then
    return query
    select
      null::uuid, false, false, null::uuid, null::text,
      null::bigint, null::bigint, null::integer, null::timestamptz;
    return;
  end if;

  insert into public.upsell_offers (
    source_interaction_id,
    guild_id,
    seller_whitelist_entry_id,
    buyer_discord_id,
    base_items,
    base_discount_bps,
    base_discount_reason,
    commission_bps,
    offered_product_id,
    offered_product_name,
    offered_unit_price_cents,
    discount_bps,
    discount_amount_cents,
    discounted_unit_price_cents,
    strategy
  )
  values (
    p_interaction_id,
    p_guild_id,
    p_whitelist_entry_id,
    p_buyer_discord_id,
    v_normalized_items,
    p_base_discount_bps,
    p_base_discount_reason,
    p_commission_bps,
    v_candidate.id,
    v_candidate.name,
    v_candidate.minimum_price_cents,
    v_settings.upsell_discount_bps,
    v_candidate.discount_amount_cents,
    v_candidate.minimum_price_cents - v_candidate.discount_amount_cents,
    v_settings.upsell_strategy
  )
  returning * into v_offer;

  insert into public.audit_events (action, entity_type, entity_id, metadata)
  values (
    'bot.upsell.offer.create',
    'upsell_offer',
    v_offer.id,
    jsonb_build_object(
      'buyer_discord_id', p_buyer_discord_id,
      'guild_id', p_guild_id,
      'product_id', v_offer.offered_product_id,
      'discount_bps', v_offer.discount_bps,
      'expires_at', v_offer.expires_at
    )
  );

  return query
  select
    v_offer.id,
    true,
    true,
    v_offer.offered_product_id,
    v_offer.offered_product_name,
    v_offer.offered_unit_price_cents,
    v_offer.discounted_unit_price_cents,
    v_offer.discount_bps,
    v_offer.expires_at;
end;
$$;

comment on function public.create_bot_upsell_offer(text, uuid, uuid, text, jsonb, integer, text, integer) is
  'Creates a five-minute Discord upsell using server prices and a platform discount capped at 5%.';

revoke all on function public.create_bot_upsell_offer(text, uuid, uuid, text, jsonb, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_bot_upsell_offer(text, uuid, uuid, text, jsonb, integer, text, integer)
  to service_role;

create function public.finalize_bot_upsell_offer(
  p_offer_id uuid,
  p_discord_guild_id text,
  p_buyer_discord_id text,
  p_accept boolean,
  p_decision_interaction_id text
)
returns table (
  checkout_order_id uuid,
  source_interaction_id text,
  was_created boolean,
  out_of_stock boolean,
  offer_expired boolean,
  decision_conflict boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_offer public.upsell_offers%rowtype;
  v_result record;
  v_product public.products%rowtype;
  v_product_ids uuid[];
  v_existing_position integer;
  v_next_position integer;
  v_final_status text;
  v_order_reason text;
begin
  if p_offer_id is null then
    raise exception using errcode = '22023', message = 'Upsell offer ID is invalid.';
  end if;
  if p_discord_guild_id is null or p_discord_guild_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord guild ID is invalid.';
  end if;
  if p_buyer_discord_id is null or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord buyer ID is invalid.';
  end if;
  if p_decision_interaction_id is null
    or p_decision_interaction_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord decision interaction ID is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('upsell:' || p_offer_id::text, 0));

  select offer.*
  into v_offer
  from public.upsell_offers as offer
  join public.guilds as guild on guild.id = offer.guild_id
  where offer.id = p_offer_id
    and guild.discord_guild_id = p_discord_guild_id
    and offer.buyer_discord_id = p_buyer_discord_id
  for update of offer;

  if not found then
    raise exception using errcode = '42501', message = 'Upsell offer does not belong to this Discord user.';
  end if;

  if v_offer.status in ('accepted', 'declined') then
    if (v_offer.status = 'accepted') is distinct from p_accept then
      return query
      select
        v_offer.order_id,
        v_offer.source_interaction_id,
        false,
        false,
        false,
        true;
      return;
    end if;
    return query
    select
      v_offer.order_id,
      v_offer.source_interaction_id,
      false,
      false,
      false,
      false;
    return;
  end if;

  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then
    if v_offer.status = 'offered' then
      update public.upsell_offers
      set status = 'expired', resolved_at = now()
      where id = v_offer.id;
    end if;
    return query
    select
      null::uuid,
      v_offer.source_interaction_id,
      false,
      false,
      true,
      false;
    return;
  end if;

  if p_accept then
    select array_agg(distinct product_id order by product_id)
    into v_product_ids
    from (
      select (item ->> 'product_id')::uuid as product_id
      from jsonb_array_elements(v_offer.base_items) as entries(item)
      union all
      select v_offer.offered_product_id
    ) as products;

    perform product.id
    from public.products as product
    where product.id = any(v_product_ids)
    order by product.id
    for update;

    if exists (
      select 1
      from jsonb_array_elements(v_offer.base_items) as entries(item)
      left join public.products as product
        on product.id = (entries.item ->> 'product_id')::uuid
      left join public.substores as substore on substore.id = product.substore_id
      left join public.games as game on game.id = substore.game_id
      where product.id is null
        or product.status <> 'active'
        or product.archived_at is not null
        or product.minimum_price_cents <> (entries.item ->> 'unit_price_cents')::bigint
        or substore.status <> 'active'
        or substore.archived_at is not null
        or game.status <> 'active'
        or game.archived_at is not null
    ) then
      update public.upsell_offers
      set status = 'invalidated', resolved_at = now()
      where id = v_offer.id;
      return query
      select
        null::uuid,
        v_offer.source_interaction_id,
        false,
        false,
        true,
        false;
      return;
    end if;

    select product.*
    into v_product
    from public.products as product
    join public.substores as substore on substore.id = product.substore_id
    join public.games as game on game.id = substore.game_id
    where product.id = v_offer.offered_product_id
      and product.status = 'active'
      and product.archived_at is null
      and product.minimum_price_cents = v_offer.offered_unit_price_cents
      and substore.status = 'active'
      and substore.archived_at is null
      and game.status = 'active'
      and game.archived_at is null;

    if not found then
      update public.upsell_offers
      set status = 'invalidated', resolved_at = now()
      where id = v_offer.id;
      return query
      select
        null::uuid,
        v_offer.source_interaction_id,
        false,
        false,
        true,
        false;
      return;
    end if;

    if exists (
      select 1
      from (
        select
          (item ->> 'product_id')::uuid as product_id,
          sum((item ->> 'quantity')::integer)
            + max(
                case
                  when (item ->> 'product_id')::uuid = v_offer.offered_product_id
                    then 1
                  else 0
                end
              ) as required_quantity
        from jsonb_array_elements(v_offer.base_items) as entries(item)
        group by (item ->> 'product_id')::uuid
        union all
        select v_offer.offered_product_id, 1
        where not exists (
          select 1
          from jsonb_array_elements(v_offer.base_items) as base(item)
          where (base.item ->> 'product_id')::uuid = v_offer.offered_product_id
        )
      ) as required
      join public.products as product on product.id = required.product_id
      where product.stock_quantity < required.required_quantity
    ) then
      return query
      select
        null::uuid,
        v_offer.source_interaction_id,
        false,
        true,
        false,
        false;
      return;
    end if;
  end if;

  select *
  into strict v_result
  from public.create_ranked_bot_cart_with_reservation(
    v_offer.source_interaction_id,
    v_offer.guild_id,
    v_offer.seller_whitelist_entry_id,
    v_offer.buyer_discord_id,
    (
      select jsonb_agg(
        jsonb_build_object(
          'product_id', item ->> 'product_id',
          'quantity', (item ->> 'quantity')::integer
        )
        order by position
      )
      from jsonb_array_elements(v_offer.base_items)
        with ordinality as entries(item, position)
    ),
    v_offer.base_discount_bps,
    v_offer.base_discount_reason,
    v_offer.commission_bps
  );

  if v_result.out_of_stock or v_result.checkout_order_id is null then
    return query
    select
      null::uuid,
      v_offer.source_interaction_id,
      false,
      true,
      false,
      false;
    return;
  end if;

  if p_accept then
    if exists (
      select 1
      from public.orders as order_row
      where order_row.id = v_result.checkout_order_id
        and (
          order_row.status <> 'awaiting_payment'
          or order_row.payment_status <> 'uninitialized'
          or order_row.payment_provider_checkout_id is not null
          or order_row.payment_checkout_url is not null
        )
    ) then
      return query
      select
        v_result.checkout_order_id::uuid,
        v_offer.source_interaction_id,
        false,
        false,
        false,
        true;
      return;
    end if;

    select item.position
    into v_existing_position
    from public.order_items as item
    where item.order_id = v_result.checkout_order_id
      and item.product_id = v_offer.offered_product_id;

    if found then
      update public.order_items
      set
        quantity = quantity + 1,
        subtotal_price_cents =
          subtotal_price_cents + v_offer.offered_unit_price_cents,
        sale_price_cents =
          sale_price_cents + v_offer.discounted_unit_price_cents,
        discount_amount_cents =
          discount_amount_cents + v_offer.discount_amount_cents
      where order_id = v_result.checkout_order_id
        and position = v_existing_position;
    else
      select coalesce(max(item.position), 0) + 1
      into v_next_position
      from public.order_items as item
      where item.order_id = v_result.checkout_order_id;

      if v_next_position > 3 then
        raise exception using errcode = '23514', message = 'Upsell would exceed the cart product limit.';
      end if;

      insert into public.order_items (
        order_id,
        position,
        product_id,
        quantity,
        unit_price_cents,
        subtotal_price_cents,
        sale_price_cents,
        discount_amount_cents
      )
      values (
        v_result.checkout_order_id,
        v_next_position,
        v_offer.offered_product_id,
        1,
        v_offer.offered_unit_price_cents,
        v_offer.offered_unit_price_cents,
        v_offer.discounted_unit_price_cents,
        v_offer.discount_amount_cents
      );
    end if;

    update public.products
    set stock_quantity = stock_quantity - 1
    where id = v_offer.offered_product_id
      and stock_quantity >= 1;
    if not found then
      raise exception using errcode = '40001', message = 'Concurrent upsell stock reservation must be retried.';
    end if;

    v_order_reason := case
      when v_offer.base_discount_bps = 0 then 'upsell'
      else v_offer.base_discount_reason
    end;

    update public.orders
    set
      quantity = quantity + 1,
      subtotal_price_cents =
        subtotal_price_cents + v_offer.offered_unit_price_cents,
      sale_price_cents =
        sale_price_cents + v_offer.discounted_unit_price_cents,
      discount_amount_cents =
        discount_amount_cents + v_offer.discount_amount_cents,
      discount_reason = v_order_reason,
      upsell_product_id = v_offer.offered_product_id,
      upsell_quantity = 1,
      upsell_subtotal_price_cents = v_offer.offered_unit_price_cents,
      upsell_discount_bps = v_offer.discount_bps,
      upsell_discount_amount_cents = v_offer.discount_amount_cents,
      upsell_offer_id = v_offer.id
    where id = v_result.checkout_order_id;
  end if;

  v_final_status := case when p_accept then 'accepted' else 'declined' end;
  update public.upsell_offers
  set
    status = v_final_status,
    decision_interaction_id = p_decision_interaction_id,
    order_id = v_result.checkout_order_id,
    resolved_at = now()
  where id = v_offer.id;

  insert into public.audit_events (action, entity_type, entity_id, metadata)
  values (
    case
      when p_accept then 'bot.upsell.offer.accept'
      else 'bot.upsell.offer.decline'
    end,
    'upsell_offer',
    v_offer.id,
    jsonb_build_object(
      'buyer_discord_id', v_offer.buyer_discord_id,
      'guild_id', v_offer.guild_id,
      'order_id', v_result.checkout_order_id,
      'product_id', v_offer.offered_product_id,
      'discount_bps', v_offer.discount_bps,
      'decision_interaction_id', p_decision_interaction_id
    )
  );

  return query
  select
    v_result.checkout_order_id::uuid,
    v_offer.source_interaction_id,
    v_result.was_created::boolean,
    false,
    false,
    false;
end;
$$;

comment on function public.finalize_bot_upsell_offer(uuid, text, text, boolean, text) is
  'Atomically validates a Discord upsell decision, reserves stock and creates the order before checkout.';

revoke all on function public.finalize_bot_upsell_offer(uuid, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.finalize_bot_upsell_offer(uuid, text, text, boolean, text)
  to service_role;

commit;
