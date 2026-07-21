begin;

set local client_min_messages = warning;

update public.products
set status = 'inactive', archived_at = null
where status = 'active';

insert into public.games (id, name, slug, status)
values (
  '81000000-0000-4000-8000-000000000001',
  'Discord Emoji Verification',
  'discord-emoji-verification',
  'active'
);

insert into public.substores (id, game_id, name, slug, title, status)
values (
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'Discord Emoji Verification',
  'discord-emoji-verification',
  'Discord Emoji Verification',
  'active'
);

insert into public.products (
  substore_id,
  name,
  slug,
  minimum_price_cents,
  status
)
select
  '82000000-0000-4000-8000-000000000001',
  'Produto ' || item,
  'discord-emoji-product-' || item,
  100,
  'active'
from generate_series(1, 25) item;

do $$
begin
  begin
    insert into public.products (
      substore_id,
      name,
      slug,
      minimum_price_cents,
      status
    ) values (
      '82000000-0000-4000-8000-000000000001',
      'Produto 26',
      'discord-emoji-product-26',
      100,
      'active'
    );
    raise exception '26th active product was unexpectedly accepted';
  exception
    when check_violation then
      if sqlerrm <> 'products_active_limit' then
        raise;
      end if;
  end;
end
$$;

do $$
declare
  target_product_id uuid;
begin
  select id into target_product_id
  from public.products
  where slug = 'discord-emoji-product-1';

  begin
    update public.products
    set discord_application_emoji_id = '423456789012345678'
    where id = target_product_id;
    raise exception 'Incomplete emoji metadata pair was unexpectedly accepted';
  exception
    when check_violation then
      if sqlerrm not like '%products_discord_application_emoji_pair%' then
        raise;
      end if;
  end;

  update public.products
  set
    discord_application_emoji_id = '423456789012345678',
    discord_application_emoji_source_sha256 = repeat('a', 64)
  where id = target_product_id;

  if not exists (
    select 1
    from public.products
    where id = target_product_id
      and discord_application_emoji_id = '423456789012345678'
      and discord_application_emoji_source_sha256 = repeat('a', 64)
  ) then
    raise exception 'Valid Discord product emoji metadata was not stored';
  end if;
end
$$;

rollback;

select 'Discord product emoji verification passed' as result;
