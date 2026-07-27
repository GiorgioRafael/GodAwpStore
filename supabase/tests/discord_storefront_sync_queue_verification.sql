-- Durable, idempotent and coalesced Discord storefront synchronization.

begin;

set local client_min_messages = warning;

insert into public.whitelist_entries (id, discord_id, label, is_active)
values (
  '91000000-0000-4000-8000-000000000001',
  '911000000000000001',
  'Storefront queue seller',
  true
);

insert into public.guilds (
  id,
  discord_guild_id,
  owner_discord_id,
  whitelist_entry_id,
  name,
  status
)
values (
  '91100000-0000-4000-8000-000000000001',
  '911000000000000002',
  '911000000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Storefront queue guild',
  'active'
);

insert into public.games (id, name, slug, status)
values (
  '91200000-0000-4000-8000-000000000001',
  'Storefront queue game',
  'storefront-queue-game',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '91300000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001',
  'Storefront queue store',
  'storefront-queue-store',
  'Storefront queue store',
  'active'
);

insert into public.products (
  id,
  substore_id,
  name,
  slug,
  minimum_price_cents,
  stock_quantity,
  status
)
values (
  '91400000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  'Storefront queue product',
  'storefront-queue-product',
  100,
  9,
  'active'
);

insert into public.orders (
  id,
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
  commission_bps,
  payment_reference,
  payment_provider,
  payment_status,
  paid_at,
  stock_committed_at
)
values (
  '91500000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '91400000-0000-4000-8000-000000000001',
  '915000000000000001',
  1,
  'paid',
  'BRL',
  100,
  100,
  100,
  1000,
  'discord:915000000000000002',
  'livepix',
  'paid',
  now(),
  now()
);

do $$
declare
  v_claimed integer;
begin
  if not public.request_discord_storefront_sync(
    '91500000-0000-4000-8000-000000000001'
  ) then
    raise exception 'paid stock-committed order was not queued';
  end if;

  if not public.request_discord_storefront_sync(
    '91500000-0000-4000-8000-000000000001'
  ) then
    raise exception 'pending queue request was not idempotently reusable';
  end if;

  v_claimed := public.claim_discord_storefront_sync(
    '91600000-0000-4000-8000-000000000001',
    100
  );
  if v_claimed <> 1 then
    raise exception 'queue did not claim exactly one idempotent order request';
  end if;

  if public.claim_discord_storefront_sync(
    '91600000-0000-4000-8000-000000000002',
    100
  ) <> 0 then
    raise exception 'a concurrent worker bypassed the singleton lease';
  end if;

  if not public.complete_discord_storefront_sync(
    '91600000-0000-4000-8000-000000000001',
    true,
    null
  ) then
    raise exception 'queue lease was not completed';
  end if;

  if public.request_discord_storefront_sync(
    '91500000-0000-4000-8000-000000000001'
  ) then
    raise exception 'completed order replay requested another global fanout';
  end if;
end
$$;

do $$
begin
  if has_function_privilege(
      'anon',
      'public.request_discord_storefront_sync(uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.claim_discord_storefront_sync(uuid,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.complete_discord_storefront_sync(uuid,boolean,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.request_discord_storefront_sync(uuid)',
      'EXECUTE'
    ) then
    raise exception 'storefront sync queue RPC privileges are unsafe';
  end if;

  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.discord_storefront_sync_requests'::regclass
  ) then
    raise exception 'storefront sync requests are not protected by forced RLS';
  end if;
end
$$;

rollback;
