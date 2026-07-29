-- Expand native Discord carts from three to five selected products.
-- Five is the platform limit for text inputs in a single Discord modal.

begin;

set local lock_timeout = '10s';

alter table public.order_items
  drop constraint if exists order_items_position_range,
  add constraint order_items_position_range
    check (position between 1 and 5);

alter table public.upsell_offers
  drop constraint if exists upsell_offers_base_items_valid,
  add constraint upsell_offers_base_items_valid
    check (
      jsonb_typeof(base_items) = 'array'
      and jsonb_array_length(base_items) between 1 and 4
    );

alter table public.lead_recovery_offers
  drop constraint if exists lead_recovery_offers_items_valid,
  add constraint lead_recovery_offers_items_valid
    check (
      jsonb_typeof(items) = 'array'
      and jsonb_array_length(items) between 1 and 5
    );

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)'::regprocedure
  )
  into strict v_definition;

  if position(
    'jsonb_array_length(p_items) not between 1 and 3'
    in v_definition
  ) = 0 then
    raise exception 'Legacy cart validation no longer matches the expected three-item definition.';
  end if;

  v_definition := replace(
    v_definition,
    'jsonb_array_length(p_items) not between 1 and 3',
    'jsonb_array_length(p_items) not between 1 and 5'
  );
  v_definition := replace(
    v_definition,
    'between one and three products',
    'between one and five products'
  );
  execute v_definition;

  select pg_get_functiondef(
    'public.create_ranked_bot_cart_with_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)'::regprocedure
  )
  into strict v_definition;

  if position(
    'jsonb_array_length(p_items) not between 1 and 3'
    in v_definition
  ) = 0 then
    raise exception 'Ranked cart validation no longer matches the expected three-item definition.';
  end if;

  v_definition := replace(
    v_definition,
    'jsonb_array_length(p_items) not between 1 and 3',
    'jsonb_array_length(p_items) not between 1 and 5'
  );
  v_definition := replace(
    v_definition,
    'between one and three products',
    'between one and five products'
  );
  execute v_definition;

  select pg_get_functiondef(
    'public.create_bot_upsell_offer(text,uuid,uuid,text,jsonb,integer,text,integer)'::regprocedure
  )
  into strict v_definition;

  if position(
    'jsonb_array_length(p_items) not between 1 and 3'
    in v_definition
  ) = 0 then
    raise exception 'Upsell validation no longer matches the expected three-item definition.';
  end if;

  -- Leave one line available for the optional upsell product.
  v_definition := replace(
    v_definition,
    'jsonb_array_length(p_items) not between 1 and 3',
    'jsonb_array_length(p_items) not between 1 and 4'
  );
  v_definition := replace(
    v_definition,
    'between one and three products',
    'between one and four products'
  );
  execute v_definition;

  select pg_get_functiondef(
    'public.finalize_bot_upsell_offer_with_legacy_reservation(uuid,text,text,boolean,text)'::regprocedure
  )
  into strict v_definition;

  if position('v_next_position > 3' in v_definition) = 0 then
    raise exception 'Upsell finalization no longer matches the expected three-item definition.';
  end if;

  v_definition := replace(
    v_definition,
    'v_next_position > 3',
    'v_next_position > 5'
  );
  execute v_definition;

  select pg_get_functiondef(
    'public.claim_lead_recovery_offers(uuid,integer)'::regprocedure
  )
  into strict v_definition;

  if position('between 1 and 3' in v_definition) = 0 then
    raise exception 'Lead recovery validation no longer matches the expected three-item definition.';
  end if;

  v_definition := replace(
    v_definition,
    'between 1 and 3',
    'between 1 and 5'
  );
  execute v_definition;
end
$$;

comment on function public.create_bot_cart_with_legacy_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) is
  'Idempotently prices and creates a one-to-five-product Discord cart under stable product locks.';

comment on function public.create_bot_cart_with_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) is
  'Idempotently validates and creates a one-to-five-product Discord cart without hiding stock before payment.';

comment on function public.create_ranked_bot_cart_with_reservation(
  text, uuid, uuid, text, jsonb, integer, text, integer
) is
  'Creates a one-to-five-product Discord cart after verifying any customer-rank discount against paid guild spend.';

commit;
