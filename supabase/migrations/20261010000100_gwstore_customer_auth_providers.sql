-- Verified Google/email customers own web purchases through their real Auth UUID.
-- Discord checkout/admin functions retain their original snowflake requirements.
begin;
set local lock_timeout='10s';
set local statement_timeout='60s';

alter table public.orders alter column buyer_discord_id drop not null;
-- Auth account deletion keeps the purchase history through ON DELETE SET NULL.
-- Creation still requires a verified Auth UUID in the wrapper and delegates.
alter table public.orders add constraint orders_optional_discord_only_for_web check (
  buyer_discord_id is not null or coalesce(payment_reference ~* '^web:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
);

-- Add Auth UUID to only the private web delegates, so the ownership invariant
-- already holds on INSERT, before the wrapper writes its display snapshot.
do $delegates$
declare v_definition text; v_name text;
begin
  foreach v_name in array array['gwstore_web_cart_legacy','gwstore_web_cart_deferred','gwstore_web_cart_ranked'] loop
    select pg_get_functiondef(format('private.%I(text,uuid,uuid,text,jsonb,integer,text,integer)',v_name)::regprocedure)
      into strict v_definition;
    if position('p_commission_bps integer)' in v_definition)=0 then raise exception 'Unexpected web delegate signature: %',v_name; end if;
    v_definition:=replace(v_definition,'p_commission_bps integer)','p_commission_bps integer, p_buyer_auth_user_id uuid)');
    if position(E'\nbegin\n' in v_definition)=0 then raise exception 'Unexpected web delegate body: %',v_name; end if;
    v_definition:=regexp_replace(v_definition,E'\nbegin\n',E'\nbegin\n  if p_buyer_auth_user_id is null then raise exception \'Web buyer Auth UUID is required\' using errcode=\'22023\'; end if;\n');
    v_definition:=replace(v_definition,'p_buyer_discord_id is null or p_buyer_discord_id !~','p_buyer_discord_id is not null and p_buyer_discord_id !~');
    v_definition:=replace(v_definition,'v_existing.buyer_discord_id <> p_buyer_discord_id','v_existing.buyer_discord_id is distinct from p_buyer_discord_id');
    if v_name='gwstore_web_cart_legacy' then
      if position(E'    buyer_discord_id,\n' in v_definition)=0 or position(E'    p_buyer_discord_id,\n' in v_definition)=0 then
        raise exception 'Unexpected web cart insert'; end if;
      v_definition:=replace(v_definition,E'    buyer_discord_id,\n',E'    buyer_discord_id,\n    web_buyer_auth_user_id,\n');
      v_definition:=replace(v_definition,E'    p_buyer_discord_id,\n',E'    p_buyer_discord_id,\n    p_buyer_auth_user_id,\n');
    else
      if position(E'    p_commission_bps\n  )' in v_definition)=0 then raise exception 'Unexpected web delegate call: %',v_name; end if;
      v_definition:=replace(v_definition,E'    p_commission_bps\n  )',E'    p_commission_bps,\n    p_buyer_auth_user_id\n  )');
    end if;
    execute v_definition;
    execute format('revoke all on function private.%I(text,uuid,uuid,text,jsonb,integer,text,integer,uuid) from public,anon,authenticated,service_role',v_name);
  end loop;
end $delegates$;

create or replace function public.create_gwstore_web_purchase(
  p_request_id uuid, p_guild_id uuid, p_whitelist_entry_id uuid, p_buyer_discord_id text,
  p_items jsonb, p_discount_bps integer, p_discount_reason text, p_commission_bps integer,
  p_game_nickname text, p_service_requirements_confirmed boolean,
  p_buyer_auth_user_id uuid, p_buyer_name text
) returns table(checkout_order_id uuid, was_created boolean, out_of_stock boolean)
language plpgsql security definer set search_path = pg_catalog as $$
declare v_result record; v_existing public.orders%rowtype; v_reference text := 'web:' || p_request_id::text;
begin
  if p_request_id is null or p_buyer_auth_user_id is null or p_game_nickname is null
    or btrim(p_game_nickname) !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'Invalid web checkout identity' using errcode='22023'; end if;
  if not exists (select 1 from auth.users buyer where buyer.id=p_buyer_auth_user_id
    and not coalesce(buyer.is_anonymous,false) and (buyer.banned_until is null or buyer.banned_until<=statement_timestamp())
    and exists(select 1 from auth.identities identity where identity.user_id=buyer.id and (
      (p_buyer_discord_id is not null and identity.provider='discord'
        and coalesce(identity.identity_data->>'provider_id',identity.identity_data->>'sub',identity.identity_data->>'id')=p_buyer_discord_id)
      or (p_buyer_discord_id is null and identity.provider='email' and buyer.email_confirmed_at is not null)
      or (p_buyer_discord_id is null and identity.provider='google'
        and (identity.identity_data->>'email_verified'='true' or identity.identity_data->>'verified_email'='true'))))) then
    raise exception 'Verified account does not match buyer' using errcode='42501';
  end if;
  if p_buyer_discord_id is not null and p_buyer_discord_id !~ '^[0-9]{17,20}$' then
    raise exception 'Discord buyer ID is invalid' using errcode='22023'; end if;
  if not exists (select 1 from public.guilds guild where guild.id=p_guild_id
    and guild.discord_guild_id='1401264061101899820' and guild.status='active' and guild.archived_at is null) then
    raise exception 'Web shop only serves GWStore' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gwstore:web:buyer:' || p_buyer_auth_user_id::text, 0));
  select * into v_existing from public.orders where payment_reference=v_reference;
  if found then
    if v_existing.web_buyer_auth_user_id is distinct from p_buyer_auth_user_id
      or v_existing.game_nickname is distinct from btrim(p_game_nickname) then raise exception 'Web request conflict' using errcode='22000'; end if;
    -- Auth UUID remains the owner when providers are linked/unlinked. A retry
    -- uses the stored optional Discord identity and persisted financial terms.
    p_buyer_discord_id:=v_existing.buyer_discord_id;
    p_discount_bps:=v_existing.discount_bps;
    p_discount_reason:=v_existing.discount_reason;
    p_commission_bps:=v_existing.commission_bps;
  else
    if p_buyer_discord_id is null and (p_discount_bps is distinct from 0 or p_discount_reason is not null) then
      raise exception 'Discord discounts require a Discord identity' using errcode='42501'; end if;
    if (select count(*) from public.orders where web_buyer_auth_user_id=p_buyer_auth_user_id
      and payment_reference like 'web:%' and created_at > statement_timestamp()-interval '1 minute') >= 3
      or (select count(*) from public.orders where web_buyer_auth_user_id=p_buyer_auth_user_id
        and payment_reference like 'web:%' and status='awaiting_payment' and payment_status in ('uninitialized','pending')
        and payment_expires_at > statement_timestamp()) >= 5 then raise exception 'Web checkout rate limited' using errcode='P0008'; end if;
    if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 5 then
      raise exception 'Invalid web cart' using errcode='22023'; end if;
    if exists (select 1 from jsonb_array_elements(p_items) item
      left join public.products product on product.id=(item->>'product_id')::uuid
      left join public.catalog_stores store on store.id=product.catalog_store_id
      left join public.substores substore on substore.id=product.substore_id
      left join public.games game on game.id=substore.game_id
      where product.id is null or product.status<>'active' or product.archived_at is not null
        or store.id is null or store.status<>'active' or store.archived_at is not null
        or substore.id is null or substore.status<>'active' or substore.archived_at is not null
        or game.id is null or game.status<>'active' or game.archived_at is not null) then
      raise exception 'Web product unavailable' using errcode='42501'; end if;
    if not coalesce(p_service_requirements_confirmed,false) and exists(select 1 from jsonb_array_elements(p_items) item
      join public.products product on product.id=(item->>'product_id')::uuid
      where product.catalog_store_id='0b0e91fe-d7ba-5257-845d-7e78a9187d4a') then
      raise exception 'UP requirements must be confirmed' using errcode='22023'; end if;
  end if;
  select * into strict v_result from private.gwstore_web_cart_ranked(p_request_id::text, p_guild_id,
    p_whitelist_entry_id, p_buyer_discord_id, p_items, p_discount_bps, p_discount_reason, p_commission_bps, p_buyer_auth_user_id);
  if v_result.was_created and v_result.checkout_order_id is not null then
    update public.orders set web_buyer_auth_user_id=p_buyer_auth_user_id, web_buyer_name=left(btrim(p_buyer_name),80),
      game_nickname=btrim(p_game_nickname), game_nickname_submitted_at=statement_timestamp(),
      web_items_snapshot=(select jsonb_agg(jsonb_build_object('productName',product.name,'quantity',item.quantity,
        'unitPriceCents',item.unit_price_cents,'totalPriceCents',item.sale_price_cents) order by item.position)
        from public.order_items item join public.products product on product.id=item.product_id where item.order_id=v_result.checkout_order_id)
      where id=v_result.checkout_order_id;
    insert into public.audit_events(actor_discord_user_id,action,entity_type,entity_id,metadata)
      values(p_buyer_discord_id,'web.order.created','order',v_result.checkout_order_id,jsonb_build_object('source','web','request_id',p_request_id,'buyer_auth_user_id',p_buyer_auth_user_id));
  end if;
  return query select v_result.checkout_order_id::uuid,v_result.was_created::boolean,v_result.out_of_stock::boolean;
end $$;
revoke all on function public.create_gwstore_web_purchase(uuid,uuid,uuid,text,jsonb,integer,text,integer,text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.create_gwstore_web_purchase(uuid,uuid,uuid,text,jsonb,integer,text,integer,text,boolean,uuid,text) to service_role;

-- A verified payment may arrive after the account has been deleted. Preserve
-- the staff chat/history; RLS never grants a customer access through NULL.
do $history_chat$
declare v_definition text; v_guard text := '  if v_order.web_buyer_auth_user_id is null then raise exception ''Paid web order is missing buyer identity'' using errcode=''42501''; end if;';
begin
  select pg_get_functiondef('public.ensure_gwstore_web_order_chat(uuid)'::regprocedure) into strict v_definition;
  if position(v_guard in v_definition)=0 then raise exception 'Unexpected web history chat guard'; end if;
  execute replace(v_definition,v_guard,'');
end $history_chat$;

-- Buyer membership is the Auth UUID; staff still requires the existing active
-- Discord admin profile. NULL cannot weaken an ownership comparison.
do $chat$
declare v_definition text;
begin
  select pg_get_functiondef('public.send_gwstore_web_order_message(uuid,uuid,uuid,text,text,text)'::regprocedure)
    into strict v_definition;
  if position(' or v_order.buyer_discord_id<>p_actor_discord_id' in v_definition)=0 then raise exception 'Unexpected web chat participant check'; end if;
  v_definition:=replace(v_definition,' or v_order.buyer_discord_id<>p_actor_discord_id','');
  execute v_definition;
end $chat$;

notify pgrst,'reload schema';
commit;
