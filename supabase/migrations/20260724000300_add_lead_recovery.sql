-- Recover abandoned LivePix checkouts through a private Discord offer.
-- The discount composes after every discount already present on the source
-- order and the recovered order receives a brand-new LivePix checkout.

begin;

set local lock_timeout = '5s';

alter table public.platform_settings
  add column lead_recovery_enabled boolean not null default true,
  add column lead_recovery_discount_bps integer not null default 500,
  add column lead_recovery_delay_minutes integer not null default 15,
  add constraint platform_settings_lead_recovery_discount_range
    check (lead_recovery_discount_bps between 1 and 500),
  add constraint platform_settings_lead_recovery_delay_range
    check (lead_recovery_delay_minutes between 0 and 1440);

comment on column public.platform_settings.lead_recovery_discount_bps is
  'Discount composed over the source order final price, hard-capped at 500 bps (5%).';
comment on column public.platform_settings.lead_recovery_delay_minutes is
  'Delay after the original LivePix checkout expires before a recovery DM can be sent.';

create table public.lead_recovery_offers (
  id uuid primary key default gen_random_uuid(),
  source_order_id uuid not null unique
    references public.orders (id) on delete restrict,
  guild_id uuid not null references public.guilds (id) on delete restrict,
  seller_whitelist_entry_id uuid not null
    references public.whitelist_entries (id) on delete restrict,
  buyer_discord_id text not null,
  items jsonb not null,
  original_subtotal_price_cents bigint not null,
  original_sale_price_cents bigint not null,
  original_discount_bps integer not null,
  original_discount_reason text,
  original_upsell_product_id uuid references public.products (id) on delete restrict,
  original_upsell_quantity integer not null default 0,
  original_upsell_subtotal_price_cents bigint not null default 0,
  original_upsell_discount_bps integer not null default 0,
  original_upsell_discount_amount_cents bigint not null default 0,
  commission_bps integer not null,
  discount_bps integer not null,
  discount_amount_cents bigint not null,
  recovered_sale_price_cents bigint not null,
  status text not null default 'pending',
  delivery_claim_token uuid,
  delivery_claimed_at timestamptz,
  delivery_attempts integer not null default 0,
  next_delivery_attempt_at timestamptz not null default now(),
  dm_channel_id text,
  dm_message_id text,
  sent_at timestamptz,
  decision_interaction_id text unique,
  recovered_order_id uuid unique references public.orders (id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  resolved_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_recovery_offers_buyer_discord_id_format
    check (buyer_discord_id ~ '^[0-9]{15,22}$'),
  constraint lead_recovery_offers_items_valid
    check (
      jsonb_typeof(items) = 'array'
      and jsonb_array_length(items) between 1 and 3
    ),
  constraint lead_recovery_offers_original_price_valid
    check (
      original_subtotal_price_cents >= original_sale_price_cents
      and original_sale_price_cents > 500
      and original_discount_bps between 0 and 9000
      and original_upsell_quantity between 0 and 1
      and original_upsell_subtotal_price_cents >= 0
      and original_upsell_discount_bps between 0 and 500
      and original_upsell_discount_amount_cents >= 0
    ),
  constraint lead_recovery_offers_commission_range
    check (commission_bps between 0 and 10000),
  constraint lead_recovery_offers_discount_valid
    check (
      discount_bps between 1 and 500
      and discount_amount_cents = trunc(
        original_sale_price_cents::numeric * discount_bps::numeric / 10000
      )::bigint
      and discount_amount_cents > 0
      and recovered_sale_price_cents =
        original_sale_price_cents - discount_amount_cents
      and recovered_sale_price_cents >= 100
    ),
  constraint lead_recovery_offers_status_valid
    check (
      status in (
        'pending',
        'sending',
        'sent',
        'accepted',
        'declined',
        'expired',
        'invalidated',
        'failed'
      )
    ),
  constraint lead_recovery_offers_delivery_attempts_range
    check (delivery_attempts between 0 and 5),
  constraint lead_recovery_offers_discord_message_format
    check (
      (dm_channel_id is null or dm_channel_id ~ '^[0-9]{15,22}$')
      and (dm_message_id is null or dm_message_id ~ '^[0-9]{15,22}$')
      and (
        decision_interaction_id is null
        or decision_interaction_id ~ '^[0-9]{15,22}$'
      )
    ),
  constraint lead_recovery_offers_resolution_state check (
    (
      status in ('pending', 'sending', 'sent')
      and decision_interaction_id is null
      and recovered_order_id is null
      and resolved_at is null
    )
    or (
      status = 'accepted'
      and decision_interaction_id is not null
      and recovered_order_id is not null
      and resolved_at is not null
    )
    or (
      status = 'declined'
      and decision_interaction_id is not null
      and recovered_order_id is null
      and resolved_at is not null
    )
    or (
      status in ('expired', 'invalidated', 'failed')
      and recovered_order_id is null
      and resolved_at is not null
    )
  )
);

create index lead_recovery_offers_delivery_queue_idx
  on public.lead_recovery_offers (next_delivery_attempt_at, created_at, id)
  where status in ('pending', 'sending');
create index lead_recovery_offers_open_expiry_idx
  on public.lead_recovery_offers (expires_at, id)
  where status in ('pending', 'sending', 'sent');

create trigger lead_recovery_offers_set_updated_at
before update on public.lead_recovery_offers
for each row execute function private.set_updated_at();

alter table public.lead_recovery_offers enable row level security;
alter table public.lead_recovery_offers force row level security;

revoke all on table public.lead_recovery_offers
  from public, anon, authenticated, service_role;

alter table public.orders
  add column lead_recovery_source_order_id uuid
    references public.orders (id) on delete restrict,
  add column lead_recovery_discount_bps integer not null default 0,
  add column lead_recovery_discount_amount_cents bigint not null default 0,
  add column lead_recovery_offer_id uuid unique
    references public.lead_recovery_offers (id) on delete restrict;

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
    and lead_recovery_discount_bps between 0 and 500
    and lead_recovery_discount_amount_cents >= 0
    and discount_amount_cents =
      trunc(
        (subtotal_price_cents - upsell_subtotal_price_cents)::numeric
        * discount_bps::numeric
        / 10000
      )::bigint
      + upsell_discount_amount_cents
      + lead_recovery_discount_amount_cents
    and (
      (
        upsell_quantity = 0
        and upsell_product_id is null
        and upsell_offer_id is null
        and upsell_subtotal_price_cents = 0
        and upsell_discount_bps = 0
        and upsell_discount_amount_cents = 0
      )
      or (
        upsell_quantity = 1
        and upsell_product_id is not null
        and (upsell_offer_id is not null or lead_recovery_offer_id is not null)
        and upsell_subtotal_price_cents > 0
        and upsell_discount_bps between 1 and 500
        and upsell_discount_amount_cents = trunc(
          upsell_subtotal_price_cents::numeric
          * upsell_discount_bps::numeric
          / 10000
        )::bigint
        and upsell_discount_amount_cents > 0
      )
    )
    and (
      (
        lead_recovery_offer_id is null
        and lead_recovery_source_order_id is null
        and lead_recovery_discount_bps = 0
        and lead_recovery_discount_amount_cents = 0
      )
      or (
        lead_recovery_offer_id is not null
        and lead_recovery_source_order_id is not null
        and lead_recovery_discount_bps between 1 and 500
        and lead_recovery_discount_amount_cents = trunc(
          (
            subtotal_price_cents
            - trunc(
                (subtotal_price_cents - upsell_subtotal_price_cents)::numeric
                * discount_bps::numeric
                / 10000
              )::bigint
            - upsell_discount_amount_cents
          )::numeric
          * lead_recovery_discount_bps::numeric
          / 10000
        )::bigint
        and lead_recovery_discount_amount_cents > 0
      )
    )
    and (
      (
        discount_bps > 0
        and discount_reason in ('server_booster', 'customer_rank')
      )
      or (
        discount_bps = 0
        and upsell_quantity = 1
        and discount_reason = 'upsell'
      )
      or (
        discount_bps = 0
        and upsell_quantity = 0
        and lead_recovery_offer_id is not null
        and discount_reason = 'lead_recovery'
      )
      or (
        discount_bps = 0
        and upsell_quantity = 0
        and lead_recovery_offer_id is null
        and discount_amount_cents = 0
        and discount_reason is null
      )
    )
  );

comment on column public.orders.lead_recovery_offer_id is
  'Unique recovery offer that produced this order and its new LivePix checkout.';
comment on column public.orders.lead_recovery_discount_amount_cents is
  'Recovery discount applied after base and upsell discounts.';

create function public.claim_lead_recovery_offers(
  p_claim_token uuid,
  p_batch_size integer default 25
)
returns table (
  offer_id uuid,
  source_order_id uuid,
  buyer_discord_id text,
  items jsonb,
  original_sale_price_cents bigint,
  recovered_sale_price_cents bigint,
  discount_bps integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_settings public.platform_settings%rowtype;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Recovery delivery claim token is required.';
  end if;
  if p_batch_size is null or p_batch_size not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Recovery batch size must be between 1 and 100.';
  end if;

  select settings.*
  into strict v_settings
  from public.platform_settings as settings
  where settings.id = 1;

  update public.lead_recovery_offers as offer
  set
    status = 'expired',
    delivery_claim_token = null,
    delivery_claimed_at = null,
    resolved_at = now()
  where offer.status in ('pending', 'sending', 'sent')
    and offer.expires_at <= now();

  update public.lead_recovery_offers as offer
  set
    status = 'invalidated',
    delivery_claim_token = null,
    delivery_claimed_at = null,
    resolved_at = now()
  from public.orders as source
  where source.id = offer.source_order_id
    and offer.status in ('pending', 'sending', 'sent')
    and (
      source.status <> 'cancelled'
      or source.payment_status <> 'cancelled'
      or source.paid_at is not null
      or source.late_payment_detected_at is not null
    );

  if not v_settings.lead_recovery_enabled then
    update public.lead_recovery_offers as offer
    set
      status = 'invalidated',
      delivery_claim_token = null,
      delivery_claimed_at = null,
      resolved_at = now()
    where offer.status in ('pending', 'sending', 'sent');
    return;
  end if;

  insert into public.lead_recovery_offers (
    source_order_id,
    guild_id,
    seller_whitelist_entry_id,
    buyer_discord_id,
    items,
    original_subtotal_price_cents,
    original_sale_price_cents,
    original_discount_bps,
    original_discount_reason,
    original_upsell_product_id,
    original_upsell_quantity,
    original_upsell_subtotal_price_cents,
    original_upsell_discount_bps,
    original_upsell_discount_amount_cents,
    commission_bps,
    discount_bps,
    discount_amount_cents,
    recovered_sale_price_cents
  )
  select
    source.id,
    source.guild_id,
    source.seller_whitelist_entry_id,
    source.buyer_discord_id,
    (
      select jsonb_agg(
        jsonb_build_object(
          'position', item.position,
          'product_id', item.product_id::text,
          'product_name', product.name,
          'quantity', item.quantity,
          'unit_price_cents', item.unit_price_cents,
          'subtotal_price_cents', item.subtotal_price_cents,
          'sale_price_cents', item.sale_price_cents,
          'discount_amount_cents', item.discount_amount_cents
        )
        order by item.position
      )
      from public.order_items as item
      join public.products as product on product.id = item.product_id
      where item.order_id = source.id
    ),
    source.subtotal_price_cents,
    source.sale_price_cents,
    source.discount_bps,
    source.discount_reason,
    source.upsell_product_id,
    source.upsell_quantity,
    source.upsell_subtotal_price_cents,
    source.upsell_discount_bps,
    source.upsell_discount_amount_cents,
    source.commission_bps,
    v_settings.lead_recovery_discount_bps,
    trunc(
      source.sale_price_cents::numeric
      * v_settings.lead_recovery_discount_bps::numeric
      / 10000
    )::bigint,
    source.sale_price_cents - trunc(
      source.sale_price_cents::numeric
      * v_settings.lead_recovery_discount_bps::numeric
      / 10000
    )::bigint
  from public.orders as source
  join public.guilds as guild on guild.id = source.guild_id
  join public.whitelist_entries as whitelist
    on whitelist.id = source.seller_whitelist_entry_id
  where source.status = 'cancelled'
    and source.payment_provider = 'livepix'
    and source.payment_status = 'cancelled'
    and source.payment_provider_reference is not null
    and source.payment_checkout_url is not null
    and source.payment_expires_at is not null
    and source.payment_expires_at
      + make_interval(mins => v_settings.lead_recovery_delay_minutes) <= now()
    and source.stock_release_reason = 'payment_timeout'
    and source.stock_released_at is not null
    and source.paid_at is null
    and source.late_payment_detected_at is null
    and source.sale_price_cents > 500
    and source.lead_recovery_offer_id is null
    and source.lead_recovery_source_order_id is null
    and source.seller_whitelist_entry_id is not null
    and guild.status = 'active'
    and guild.archived_at is null
    and whitelist.is_active
    and whitelist.archived_at is null
    and (
      select count(*)
      from public.order_items as item
      where item.order_id = source.id
    ) between 1 and 3
  order by source.payment_expires_at, source.id
  limit p_batch_size
  on conflict on constraint lead_recovery_offers_source_order_id_key do nothing;

  return query
  with candidates as (
    select offer.id
    from public.lead_recovery_offers as offer
    where (
        offer.status = 'pending'
        or (
          offer.status = 'sending'
          and offer.delivery_claimed_at < now() - interval '5 minutes'
        )
      )
      and offer.next_delivery_attempt_at <= now()
      and offer.delivery_attempts < 5
      and offer.expires_at > now()
    order by offer.next_delivery_attempt_at, offer.created_at, offer.id
    limit p_batch_size
    for update skip locked
  ),
  claimed as (
    update public.lead_recovery_offers as offer
    set
      status = 'sending',
      delivery_claim_token = p_claim_token,
      delivery_claimed_at = now(),
      delivery_attempts = delivery_attempts + 1,
      last_error = null
    from candidates
    where offer.id = candidates.id
    returning offer.*
  )
  select
    claimed.id,
    claimed.source_order_id,
    claimed.buyer_discord_id,
    claimed.items,
    claimed.original_sale_price_cents,
    claimed.recovered_sale_price_cents,
    claimed.discount_bps,
    claimed.expires_at
  from claimed
  order by claimed.created_at, claimed.id;
end;
$$;

revoke all on function public.claim_lead_recovery_offers(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_lead_recovery_offers(uuid, integer)
  to service_role;

create function public.complete_lead_recovery_delivery(
  p_offer_id uuid,
  p_claim_token uuid,
  p_dm_channel_id text,
  p_dm_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_updated boolean;
begin
  if p_offer_id is null
    or p_claim_token is null
    or p_dm_channel_id is null
    or p_dm_channel_id !~ '^[0-9]{15,22}$'
    or p_dm_message_id is null
    or p_dm_message_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Recovery delivery confirmation is invalid.';
  end if;

  update public.lead_recovery_offers
  set
    status = 'sent',
    delivery_claim_token = null,
    delivery_claimed_at = null,
    dm_channel_id = p_dm_channel_id,
    dm_message_id = p_dm_message_id,
    sent_at = coalesce(sent_at, now()),
    last_error = null
  where id = p_offer_id
    and status = 'sending'
    and delivery_claim_token = p_claim_token
    and expires_at > now();

  v_updated := found;
  return v_updated;
end;
$$;

revoke all on function public.complete_lead_recovery_delivery(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_lead_recovery_delivery(uuid, uuid, text, text)
  to service_role;

create function public.fail_lead_recovery_delivery(
  p_offer_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_updated boolean;
begin
  update public.lead_recovery_offers
  set
    status = case when delivery_attempts >= 5 then 'failed' else 'pending' end,
    delivery_claim_token = null,
    delivery_claimed_at = null,
    next_delivery_attempt_at =
      now() + make_interval(mins => greatest(delivery_attempts, 1) * 5),
    resolved_at = case when delivery_attempts >= 5 then now() else null end,
    last_error = left(coalesce(nullif(btrim(p_error), ''), 'delivery_failed'), 500)
  where id = p_offer_id
    and status = 'sending'
    and delivery_claim_token = p_claim_token;

  v_updated := found;
  return v_updated;
end;
$$;

revoke all on function public.fail_lead_recovery_delivery(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_lead_recovery_delivery(uuid, uuid, text)
  to service_role;

create function public.finalize_lead_recovery_offer(
  p_offer_id uuid,
  p_buyer_discord_id text,
  p_accept boolean,
  p_decision_interaction_id text
)
returns table (
  checkout_order_id uuid,
  was_created boolean,
  declined boolean,
  out_of_stock boolean,
  offer_expired boolean,
  offer_invalidated boolean,
  decision_conflict boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_offer public.lead_recovery_offers%rowtype;
  v_source public.orders%rowtype;
  v_order public.orders%rowtype;
  v_product_ids uuid[];
  v_item_count integer;
  v_total_quantity integer;
  v_line record;
  v_line_recovery_discount bigint;
  v_remainder_position integer;
  v_reason text;
begin
  if p_offer_id is null then
    raise exception using errcode = '22023', message = 'Recovery offer ID is invalid.';
  end if;
  if p_accept is null then
    raise exception using errcode = '22023', message = 'Recovery decision is required.';
  end if;
  if p_buyer_discord_id is null or p_buyer_discord_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord buyer ID is invalid.';
  end if;
  if p_decision_interaction_id is null
    or p_decision_interaction_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord decision interaction ID is invalid.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('lead-recovery:' || p_offer_id::text, 0)
  );

  select offer.*
  into v_offer
  from public.lead_recovery_offers as offer
  where offer.id = p_offer_id
    and offer.buyer_discord_id = p_buyer_discord_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Recovery offer does not belong to this Discord user.';
  end if;

  if v_offer.status in ('accepted', 'declined') then
    if (v_offer.status = 'accepted') is distinct from p_accept then
      return query
      select v_offer.recovered_order_id, false, false, false, false, false, true;
      return;
    end if;
    return query
    select
      v_offer.recovered_order_id,
      false,
      v_offer.status = 'declined',
      false,
      false,
      false,
      false;
    return;
  end if;

  if v_offer.status <> 'sent' or v_offer.expires_at <= now() then
    if v_offer.status in ('pending', 'sending', 'sent') then
      update public.lead_recovery_offers
      set
        status = 'expired',
        delivery_claim_token = null,
        delivery_claimed_at = null,
        resolved_at = now()
      where id = v_offer.id;
    end if;
    return query select null::uuid, false, false, false, true, false, false;
    return;
  end if;

  if not coalesce((
    select settings.lead_recovery_enabled
    from public.platform_settings as settings
    where settings.id = 1
  ), false) then
    update public.lead_recovery_offers
    set status = 'invalidated', resolved_at = now()
    where id = v_offer.id;
    return query select null::uuid, false, false, false, false, true, false;
    return;
  end if;

  select source.*
  into v_source
  from public.orders as source
  where source.id = v_offer.source_order_id
  for update;

  if not found
    or v_source.status <> 'cancelled'
    or v_source.payment_provider <> 'livepix'
    or v_source.payment_status <> 'cancelled'
    or v_source.stock_release_reason <> 'payment_timeout'
    or v_source.paid_at is not null
    or v_source.late_payment_detected_at is not null
    or v_source.sale_price_cents <> v_offer.original_sale_price_cents then
    update public.lead_recovery_offers
    set status = 'invalidated', resolved_at = now()
    where id = v_offer.id;
    return query select null::uuid, false, false, false, false, true, false;
    return;
  end if;

  if not p_accept then
    update public.lead_recovery_offers
    set
      status = 'declined',
      decision_interaction_id = p_decision_interaction_id,
      resolved_at = now()
    where id = v_offer.id;

    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values (
      'bot.lead_recovery.offer.decline',
      'lead_recovery_offer',
      v_offer.id,
      jsonb_build_object(
        'source_order_id', v_offer.source_order_id,
        'buyer_discord_id', v_offer.buyer_discord_id,
        'decision_interaction_id', p_decision_interaction_id
      )
    );

    return query select null::uuid, false, true, false, false, false, false;
    return;
  end if;

  select
    array_agg((item ->> 'product_id')::uuid order by (item ->> 'product_id')::uuid),
    count(*)::integer,
    sum((item ->> 'quantity')::integer)::integer
  into v_product_ids, v_item_count, v_total_quantity
  from jsonb_array_elements(v_offer.items) as entries(item);

  perform product.id
  from public.products as product
  where product.id = any(v_product_ids)
  order by product.id
  for update;

  if (
    select count(*)
    from public.products as product
    join public.substores as substore on substore.id = product.substore_id
    join public.games as game on game.id = substore.game_id
    where product.id = any(v_product_ids)
      and product.status = 'active'
      and product.archived_at is null
      and substore.status = 'active'
      and substore.archived_at is null
      and game.status = 'active'
      and game.archived_at is null
  ) <> v_item_count
    or not exists (
      select 1
      from public.guilds as guild
      join public.whitelist_entries as whitelist
        on whitelist.id = guild.whitelist_entry_id
      where guild.id = v_offer.guild_id
        and guild.whitelist_entry_id = v_offer.seller_whitelist_entry_id
        and guild.status = 'active'
        and guild.archived_at is null
        and whitelist.is_active
        and whitelist.archived_at is null
    ) then
    update public.lead_recovery_offers
    set status = 'invalidated', resolved_at = now()
    where id = v_offer.id;
    return query select null::uuid, false, false, false, false, true, false;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_offer.items) as entries(item)
    join public.products as product
      on product.id = (entries.item ->> 'product_id')::uuid
    where product.stock_quantity < (entries.item ->> 'quantity')::integer
  ) then
    return query select null::uuid, false, false, true, false, false, false;
    return;
  end if;

  select (item ->> 'position')::integer
  into v_remainder_position
  from jsonb_array_elements(v_offer.items) as entries(item)
  order by (item ->> 'sale_price_cents')::bigint desc, (item ->> 'position')::integer
  limit 1;

  v_reason := case
    when v_offer.original_discount_bps > 0 then v_offer.original_discount_reason
    when v_offer.original_upsell_quantity = 1 then 'upsell'
    else 'lead_recovery'
  end;

  insert into public.orders (
    guild_id,
    seller_whitelist_entry_id,
    product_id,
    buyer_discord_id,
    quantity,
    status,
    currency_code,
    subtotal_price_cents,
    sale_price_cents,
    minimum_price_cents,
    discount_bps,
    discount_amount_cents,
    discount_reason,
    upsell_product_id,
    upsell_quantity,
    upsell_subtotal_price_cents,
    upsell_discount_bps,
    upsell_discount_amount_cents,
    upsell_offer_id,
    lead_recovery_source_order_id,
    lead_recovery_discount_bps,
    lead_recovery_discount_amount_cents,
    lead_recovery_offer_id,
    commission_bps,
    payment_reference,
    payment_provider,
    payment_status
  )
  values (
    v_offer.guild_id,
    v_offer.seller_whitelist_entry_id,
    (v_offer.items -> 0 ->> 'product_id')::uuid,
    v_offer.buyer_discord_id,
    v_total_quantity,
    'awaiting_payment',
    'BRL',
    v_offer.original_subtotal_price_cents,
    v_offer.recovered_sale_price_cents,
    (v_offer.items -> 0 ->> 'unit_price_cents')::bigint,
    v_offer.original_discount_bps,
    v_offer.original_subtotal_price_cents
      - v_offer.original_sale_price_cents
      + v_offer.discount_amount_cents,
    v_reason,
    v_offer.original_upsell_product_id,
    v_offer.original_upsell_quantity,
    v_offer.original_upsell_subtotal_price_cents,
    v_offer.original_upsell_discount_bps,
    v_offer.original_upsell_discount_amount_cents,
    null,
    v_offer.source_order_id,
    v_offer.discount_bps,
    v_offer.discount_amount_cents,
    v_offer.id,
    v_offer.commission_bps,
    'lead-recovery:' || v_offer.id::text,
    'livepix',
    'uninitialized'
  )
  returning * into v_order;

  delete from public.order_items where order_id = v_order.id;

  for v_line in
    select item
    from jsonb_array_elements(v_offer.items) as entries(item)
    order by (item ->> 'position')::integer
  loop
    v_line_recovery_discount := trunc(
      (v_line.item ->> 'sale_price_cents')::numeric
      * v_offer.discount_bps::numeric
      / 10000
    )::bigint;
    if (v_line.item ->> 'position')::integer = v_remainder_position then
      v_line_recovery_discount := v_line_recovery_discount
        + v_offer.discount_amount_cents
        - (
          select coalesce(sum(trunc(
            (entry.item ->> 'sale_price_cents')::numeric
            * v_offer.discount_bps::numeric
            / 10000
          )::bigint), 0)
          from jsonb_array_elements(v_offer.items) as entry(item)
        );
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
      v_order.id,
      (v_line.item ->> 'position')::integer,
      (v_line.item ->> 'product_id')::uuid,
      (v_line.item ->> 'quantity')::integer,
      (v_line.item ->> 'unit_price_cents')::bigint,
      (v_line.item ->> 'subtotal_price_cents')::bigint,
      (v_line.item ->> 'sale_price_cents')::bigint - v_line_recovery_discount,
      (v_line.item ->> 'discount_amount_cents')::bigint
        + v_line_recovery_discount
    );

    update public.products
    set stock_quantity = stock_quantity - (v_line.item ->> 'quantity')::integer
    where id = (v_line.item ->> 'product_id')::uuid
      and stock_quantity >= (v_line.item ->> 'quantity')::integer;
    if not found then
      raise exception using
        errcode = '40001',
        message = 'Concurrent recovery stock reservation must be retried.';
    end if;
  end loop;

  update public.lead_recovery_offers
  set
    status = 'accepted',
    decision_interaction_id = p_decision_interaction_id,
    recovered_order_id = v_order.id,
    resolved_at = now()
  where id = v_offer.id;

  insert into public.audit_events (action, entity_type, entity_id, metadata)
  values (
    'bot.lead_recovery.offer.accept',
    'lead_recovery_offer',
    v_offer.id,
    jsonb_build_object(
      'source_order_id', v_offer.source_order_id,
      'recovered_order_id', v_order.id,
      'buyer_discord_id', v_offer.buyer_discord_id,
      'discount_bps', v_offer.discount_bps,
      'discount_amount_cents', v_offer.discount_amount_cents,
      'decision_interaction_id', p_decision_interaction_id
    )
  );

  return query select v_order.id, true, false, false, false, false, false;
end;
$$;

revoke all on function public.finalize_lead_recovery_offer(uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.finalize_lead_recovery_offer(uuid, text, boolean, text)
  to service_role;

commit;
