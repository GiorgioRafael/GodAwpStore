-- A unified Discord storefront may expose more than one catalog store (world),
-- but an upsell must never mix their delivery scopes in the same order.

begin;

set local lock_timeout = '10s';

do $$
declare
  v_definition text;
  v_updated_definition text;
  v_selection_pattern text := $pattern$(and[[:space:]]+\([[:space:]]+v_settings\.upsell_strategy <> 'same_product'[[:space:]]+or product\.id = any\(v_product_ids\)[[:space:]]+\))$pattern$;
  v_scoped_selection text := $replacement$and not exists (
      select 1
      from public.products as base_product
      where base_product.id = any(v_product_ids)
        and base_product.catalog_store_id <> product.catalog_store_id
    )
    \1$replacement$;
begin
  select pg_get_functiondef(
    'public.create_bot_upsell_offer(text,uuid,uuid,text,jsonb,integer,text,integer)'::regprocedure
  )
  into strict v_definition;

  if position('base_product.catalog_store_id <> product.catalog_store_id' in v_definition) > 0 then
    return;
  end if;

  v_updated_definition := regexp_replace(
    v_definition,
    v_selection_pattern,
    v_scoped_selection
  );

  if v_updated_definition = v_definition then
    raise exception 'Upsell candidate selection no longer matches the expected definition.';
  end if;

  execute v_updated_definition;
end
$$;

comment on function public.create_bot_upsell_offer(
  text, uuid, uuid, text, jsonb, integer, text, integer
) is
  'Creates a five-minute Discord upsell using only products from the base cart catalog store.';

commit;
