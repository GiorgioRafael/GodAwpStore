-- GWStore web commerce reuses the current cart/payment/stock ledger. No Discord
-- interaction IDs are synthesized: web requests own the web:<UUID> namespace.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

alter table public.orders
  add column web_buyer_auth_user_id uuid references auth.users(id) on delete set null,
  add column web_buyer_name text,
  add column web_items_snapshot jsonb;
alter table public.orders add constraint orders_web_snapshot_valid check (
  web_items_snapshot is null or (jsonb_typeof(web_items_snapshot) = 'array' and jsonb_array_length(web_items_snapshot) between 1 and 5)
);
create index orders_web_buyer_created_idx on public.orders(web_buyer_auth_user_id, created_at desc)
  where payment_reference like 'web:%';

-- Snapshot the CURRENT reviewed implementations, including unlimited stock and
-- deferred inventory. Change only function destinations and request namespace;
-- abort instead of silently omitting an unexpected validation/pricing layer.
do $clone$
declare v_source text; v_target text; v_definition text; v_row record;
begin
  for v_row in select * from (values
    ('public.create_bot_cart_with_legacy_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'create_bot_cart_with_legacy_reservation', 'gwstore_web_cart_legacy', true),
    ('public.create_bot_cart_with_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'create_bot_cart_with_reservation', 'gwstore_web_cart_deferred', false),
    ('public.create_ranked_bot_cart_with_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)', 'create_ranked_bot_cart_with_reservation', 'gwstore_web_cart_ranked', true)
  ) as sources(signature, source_name, target_name, has_namespace) loop
    select pg_get_functiondef(v_row.signature::regprocedure) into strict v_definition;
    v_source := 'public.' || v_row.source_name || '(';
    v_target := 'private.' || v_row.target_name || '(';
    if position(v_source in v_definition) = 0 then raise exception 'Unexpected web checkout source: %', v_row.source_name; end if;
    v_definition := replace(v_definition, v_source, v_target);
    if v_row.has_namespace then
      if position('p_interaction_id !~ ''^[0-9]{15,22}$''' in v_definition) = 0
        or position('v_payment_reference := ''discord:'' || p_interaction_id;' in v_definition) = 0 then
        raise exception 'Unexpected web checkout namespace validation: %', v_row.source_name;
      end if;
      v_definition := replace(v_definition, 'p_interaction_id !~ ''^[0-9]{15,22}$''',
        'p_interaction_id !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$''');
      v_definition := replace(v_definition, 'v_payment_reference := ''discord:'' || p_interaction_id;',
        'v_payment_reference := ''web:'' || lower(p_interaction_id);');
    end if;
    if v_row.source_name = 'create_bot_cart_with_reservation' then
      if position('public.create_bot_cart_with_legacy_reservation(' in v_definition) = 0
        or position('not product.unlimited_stock' in v_definition) = 0 then raise exception 'Unexpected deferred/unlimited cart source'; end if;
      v_definition := replace(v_definition, 'public.create_bot_cart_with_legacy_reservation(', 'private.gwstore_web_cart_legacy(');
    elsif v_row.source_name = 'create_ranked_bot_cart_with_reservation' then
      if position('public.create_bot_cart_with_reservation(' in v_definition) = 0 then raise exception 'Unexpected ranked cart delegate'; end if;
      v_definition := replace(v_definition, 'public.create_bot_cart_with_reservation(', 'private.gwstore_web_cart_deferred(');
    elsif position('v_product.unlimited_stock' in v_definition) = 0 then raise exception 'Unlimited stock migration must precede web checkout';
    end if;
    execute v_definition;
    execute format('revoke all on function private.%I(text,uuid,uuid,text,jsonb,integer,text,integer) from public, anon, authenticated, service_role', v_row.target_name);
  end loop;
end $clone$;

create function public.create_gwstore_web_purchase(
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
  if not exists (select 1 from auth.identities identity where identity.user_id=p_buyer_auth_user_id
    and identity.provider='discord' and coalesce(identity.identity_data->>'provider_id', identity.identity_data->>'sub', identity.identity_data->>'id')=p_buyer_discord_id) then
    raise exception 'Discord account does not match buyer' using errcode='42501';
  end if;
  if not exists (select 1 from public.guilds guild where guild.id=p_guild_id
    and guild.discord_guild_id='1401264061101899820' and guild.status='active' and guild.archived_at is null) then
    raise exception 'Web shop only serves GWStore' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gwstore:web:buyer:' || p_buyer_auth_user_id::text, 0));
  select * into v_existing from public.orders where payment_reference=v_reference;
  if found then
    if v_existing.web_buyer_auth_user_id is distinct from p_buyer_auth_user_id
      or v_existing.game_nickname is distinct from btrim(p_game_nickname) then raise exception 'Web request conflict' using errcode='22000'; end if;
  else
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
    p_whitelist_entry_id, p_buyer_discord_id, p_items, p_discount_bps, p_discount_reason, p_commission_bps);
  if v_result.was_created and v_result.checkout_order_id is not null then
    update public.orders set web_buyer_auth_user_id=p_buyer_auth_user_id, web_buyer_name=left(btrim(p_buyer_name),80),
      game_nickname=btrim(p_game_nickname), game_nickname_submitted_at=statement_timestamp(),
      web_items_snapshot=(select jsonb_agg(jsonb_build_object('productName',product.name,'quantity',item.quantity,
        'unitPriceCents',item.unit_price_cents,'totalPriceCents',item.sale_price_cents) order by item.position)
        from public.order_items item join public.products product on product.id=item.product_id where item.order_id=v_result.checkout_order_id)
      where id=v_result.checkout_order_id;
    insert into public.audit_events(actor_discord_user_id,action,entity_type,entity_id,metadata)
      values(p_buyer_discord_id,'web.order.created','order',v_result.checkout_order_id,jsonb_build_object('source','web','request_id',p_request_id));
  end if;
  return query select v_result.checkout_order_id::uuid,v_result.was_created::boolean,v_result.out_of_stock::boolean;
end $$;
revoke all on function public.create_gwstore_web_purchase(uuid,uuid,uuid,text,jsonb,integer,text,integer,text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.create_gwstore_web_purchase(uuid,uuid,uuid,text,jsonb,integer,text,integer,text,boolean,uuid,text) to service_role;

create table public.web_order_chats (
  order_id uuid primary key references public.orders(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.web_order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_order_chats(order_id) on delete restrict,
  author_auth_user_id uuid references auth.users(id) on delete set null,
  author_role text not null check(author_role in ('buyer','staff','system')),
  author_name text not null check(char_length(author_name) between 1 and 80),
  body text not null check(char_length(btrim(body)) between 1 and 2000),
  system_event text check(system_event in ('payment_confirmed','delivered')),
  created_at timestamptz not null default now(),
  constraint web_order_messages_system_unique unique(order_id,system_event),
  constraint web_order_messages_author_valid check((author_role='system' and author_auth_user_id is null and system_event is not null)
    or (author_role in ('buyer','staff') and system_event is null))
);
create index web_order_messages_order_time_idx on public.web_order_messages(order_id,created_at desc,id);
create index web_order_messages_author_time_idx on public.web_order_messages(author_auth_user_id,created_at desc);
alter table public.web_order_chats enable row level security;
alter table public.web_order_chats force row level security;
alter table public.web_order_messages enable row level security;
alter table public.web_order_messages force row level security;

create function private.can_read_web_order_chat(p_order_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.orders order_row join public.guilds guild on guild.id=order_row.guild_id
    where order_row.id=p_order_id and order_row.payment_reference like 'web:%'
      and guild.discord_guild_id='1401264061101899820'
      and (order_row.web_buyer_auth_user_id=auth.uid() or private.is_admin()));
$$;
revoke all on function private.can_read_web_order_chat(uuid) from public,anon;
grant execute on function private.can_read_web_order_chat(uuid) to authenticated;
create policy web_order_chats_participant_select on public.web_order_chats for select to authenticated
  using(private.can_read_web_order_chat(order_id));
create policy web_order_messages_participant_select on public.web_order_messages for select to authenticated
  using(private.can_read_web_order_chat(order_id));
revoke all on public.web_order_chats,public.web_order_messages from public,anon,authenticated;
grant select on public.web_order_chats,public.web_order_messages to authenticated;
grant all on public.web_order_chats,public.web_order_messages to service_role;

create function public.ensure_gwstore_web_order_chat(p_order_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare v_order public.orders%rowtype;
begin
  select order_row.* into v_order from public.orders order_row join public.guilds guild on guild.id=order_row.guild_id
    where order_row.id=p_order_id and order_row.payment_reference like 'web:%' and guild.discord_guild_id='1401264061101899820';
  if not found then return false; end if;
  if v_order.paid_at is null or v_order.payment_status not in ('paid','refunded') then return true; end if;
  if v_order.web_buyer_auth_user_id is null then raise exception 'Paid web order is missing buyer identity' using errcode='42501'; end if;
  insert into public.web_order_chats(order_id) values(v_order.id) on conflict(order_id) do nothing;
  insert into public.web_order_messages(order_id,author_role,author_name,body,system_event)
    values(v_order.id,'system','GWStore','Pagamento confirmado. Seu atendimento e sua entrega acontecem neste chat privado. Nick do Roblox: '||coalesce(v_order.game_nickname,'não informado')||'.','payment_confirmed')
    on conflict(order_id,system_event) do nothing;
  return true;
end $$;
revoke all on function public.ensure_gwstore_web_order_chat(uuid) from public,anon,authenticated;
grant execute on function public.ensure_gwstore_web_order_chat(uuid) to service_role;

create function private.create_paid_web_order_chat() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.payment_reference like 'web:%' and new.payment_status='paid' and new.paid_at is not null then
    perform public.ensure_gwstore_web_order_chat(new.id);
  end if;
  return new;
end $$;
revoke all on function private.create_paid_web_order_chat() from public,anon,authenticated,service_role;
create trigger orders_create_paid_web_chat after update of payment_status,paid_at on public.orders
  for each row execute function private.create_paid_web_order_chat();

create function public.send_gwstore_web_order_message(p_order_id uuid,p_request_id uuid,p_actor_auth_user_id uuid,
  p_actor_discord_id text,p_author_name text,p_body text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare v_order public.orders%rowtype; v_existing public.web_order_messages%rowtype; v_staff boolean;
begin
  if p_request_id is null or p_actor_auth_user_id is null or p_body is null
    or char_length(btrim(p_body)) not between 1 and 2000
    or regexp_replace(p_body,E'[\\n\\r\\t]','','g') ~ '[[:cntrl:]]' then
    raise exception 'Invalid chat message' using errcode='22023'; end if;
  select order_row.* into v_order from public.orders order_row join public.guilds guild on guild.id=order_row.guild_id
    join public.web_order_chats chat on chat.order_id=order_row.id
    where order_row.id=p_order_id and order_row.payment_reference like 'web:%' and guild.discord_guild_id='1401264061101899820';
  if not found then raise exception 'Chat not found' using errcode='P0002'; end if;
  select exists(select 1 from public.admin_profiles profile where profile.auth_user_id=p_actor_auth_user_id
    and profile.discord_user_id=p_actor_discord_id and profile.is_active and profile.authorization_expires_at>statement_timestamp()) into v_staff;
  if not v_staff and (v_order.web_buyer_auth_user_id is distinct from p_actor_auth_user_id or v_order.buyer_discord_id<>p_actor_discord_id) then
    raise exception 'Not a chat participant' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gwstore:web:message:'||p_actor_auth_user_id::text,0));
  select * into v_existing from public.web_order_messages where id=p_request_id;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.author_auth_user_id is distinct from p_actor_auth_user_id
      or v_existing.body<>btrim(p_body) then raise exception 'Message request conflict' using errcode='22000'; end if;
    return v_existing.id;
  end if;
  if (select count(*) from public.web_order_messages where author_auth_user_id=p_actor_auth_user_id
    and created_at>statement_timestamp()-interval '1 minute')>=20 then raise exception 'Message rate limited' using errcode='P0008'; end if;
  insert into public.web_order_messages(id,order_id,author_auth_user_id,author_role,author_name,body)
    values(p_request_id,p_order_id,p_actor_auth_user_id,case when v_staff then 'staff' else 'buyer' end,
      coalesce(nullif(left(btrim(p_author_name),80),''),'Cliente'),btrim(p_body));
  return p_request_id;
end $$;
revoke all on function public.send_gwstore_web_order_message(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.send_gwstore_web_order_message(uuid,uuid,uuid,text,text,text) to service_role;

create function public.complete_gwstore_web_order_delivery(p_order_id uuid,p_actor_auth_user_id uuid,p_actor_discord_id text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare v_order public.orders%rowtype;
begin
  if not exists(select 1 from public.admin_profiles profile where profile.auth_user_id=p_actor_auth_user_id
    and profile.discord_user_id=p_actor_discord_id and profile.is_active and profile.authorization_expires_at>statement_timestamp()) then
    raise exception 'Staff authorization required' using errcode='42501'; end if;
  select order_row.* into v_order from public.orders order_row join public.guilds guild on guild.id=order_row.guild_id
    where order_row.id=p_order_id and order_row.payment_reference like 'web:%' and guild.discord_guild_id='1401264061101899820' for update of order_row;
  if not found then raise exception 'Web order not found' using errcode='P0002'; end if;
  if v_order.payment_status<>'paid' or v_order.paid_at is null or v_order.status not in ('paid','processing','delivered')
    or v_order.stock_committed_at is null or v_order.stock_released_at is not null then raise exception 'Order cannot be delivered' using errcode='P0009'; end if;
  if v_order.status='delivered' then return false; end if;
  perform public.ensure_gwstore_web_order_chat(p_order_id);
  update public.orders set status='delivered',delivered_at=coalesce(delivered_at,statement_timestamp()) where id=p_order_id;
  insert into public.web_order_messages(order_id,author_role,author_name,body,system_event)
    values(p_order_id,'system','GWStore','Pedido marcado como entregue. Obrigado pela compra! Conte neste chat como foi sua experiência com a GWStore.','delivered')
    on conflict(order_id,system_event) do nothing;
  insert into public.audit_events(actor_auth_user_id,actor_discord_user_id,action,entity_type,entity_id,metadata)
    values(p_actor_auth_user_id,p_actor_discord_id,'web.order.delivered','order',p_order_id,jsonb_build_object('source','web'));
  return true;
end $$;
revoke all on function public.complete_gwstore_web_order_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_gwstore_web_order_delivery(uuid,uuid,text) to service_role;

-- Defense in depth: web orders cannot enter Discord ticket claims, including
-- stale/late payments. Preserve all return columns and bot behavior otherwise.
do $guard$
declare v_definition text; v_position integer; v_signature text;
begin
  v_signature:='public.claim_discord_ticket(uuid)';
  select pg_get_functiondef(v_signature::regprocedure) into strict v_definition;
  v_position:=position(E'\nbegin\n' in v_definition);
  if v_position=0 then raise exception 'Unexpected Discord ticket claim source'; end if;
  v_definition:=substring(v_definition from 1 for v_position+6)||E'  if exists(select 1 from public.orders where id=p_order_id and payment_reference like ''web:%'') then\n    raise exception ''Web orders use private website chat'' using errcode=''42501'';\n  end if;\n'||substring(v_definition from v_position+7);
  execute v_definition;
  v_signature:='public.list_late_paid_orders_without_ticket(integer)';
  select pg_get_functiondef(v_signature::regprocedure) into strict v_definition;
  if position('where orders.discord_ticket_channel_id is null' in v_definition)>0 then
    v_definition:=replace(v_definition,'where orders.discord_ticket_channel_id is null',
      'where coalesce(orders.payment_reference,'''') not like ''web:%'' and orders.discord_ticket_channel_id is null');
  elsif position('where orders.late_payment_detected_at is not null' in v_definition)>0 then
    -- Production may retain the original seven-column late-only function.
    -- Preserve its return shape and every existing condition/deadline/order.
    v_definition:=replace(v_definition,'where orders.late_payment_detected_at is not null',
      'where coalesce(orders.payment_reference,'''') not like ''web:%'' and orders.late_payment_detected_at is not null');
  else raise exception 'Unexpected late payment list source'; end if;
  execute v_definition;
end $guard$;

notify pgrst,'reload schema';
commit;
