alter table public.products
  add column if not exists discord_application_emoji_id text,
  add column if not exists discord_application_emoji_source_sha256 text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_discord_application_emoji_id_format'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_discord_application_emoji_id_format
      check (
        discord_application_emoji_id is null
        or discord_application_emoji_id ~ '^[0-9]{15,22}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_discord_application_emoji_source_sha256_format'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_discord_application_emoji_source_sha256_format
      check (
        discord_application_emoji_source_sha256 is null
        or discord_application_emoji_source_sha256 ~ '^[0-9a-f]{64}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_discord_application_emoji_pair'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_discord_application_emoji_pair
      check (
        (discord_application_emoji_id is null)
        = (discord_application_emoji_source_sha256 is null)
      );
  end if;
end
$$;

create or replace function public.enforce_active_product_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and new.archived_at is null then
    perform pg_advisory_xact_lock(hashtextextended('gwstore:active-products', 0));

    if (
      select count(*)
      from public.products product
      where product.status = 'active'
        and product.archived_at is null
        and product.id <> new.id
    ) >= 25 then
      raise exception using
        errcode = '23514',
        constraint = 'products_active_limit',
        message = 'products_active_limit';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_active_product_limit() from public;

drop trigger if exists products_enforce_active_limit on public.products;
create trigger products_enforce_active_limit
before insert or update of status, archived_at
on public.products
for each row
execute function public.enforce_active_product_limit();
