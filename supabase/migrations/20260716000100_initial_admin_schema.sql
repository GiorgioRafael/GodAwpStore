-- GodAwpStore administrative schema.
-- All timestamptz values represent absolute instants; Supabase/Postgres stores them in UTC.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

do $$
begin
  create type public.catalog_status as enum ('active', 'inactive', 'archived');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.inventory_unit_status as enum (
    'available',
    'reserved',
    'delivered',
    'quarantined',
    'revoked'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.guild_status as enum ('active', 'suspended', 'left', 'archived');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.order_status as enum (
    'pending',
    'awaiting_payment',
    'paid',
    'processing',
    'delivered',
    'cancelled',
    'expired',
    'refunded',
    'failed'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.payout_status as enum (
    'requested',
    'approved',
    'processing',
    'paid',
    'rejected',
    'cancelled',
    'failed'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.ledger_entry_kind as enum (
    'sale_profit',
    'commission',
    'payout',
    'payout_reversal',
    'refund',
    'adjustment'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.ledger_entry_status as enum (
    'pending',
    'available',
    'settled',
    'reversed'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.admin_profiles (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  discord_user_id text not null unique,
  display_name text not null,
  avatar_url text,
  is_active boolean not null default true,
  authorization_expires_at timestamptz not null default now(),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_profiles_discord_user_id_format check (discord_user_id ~ '^[0-9]{15,22}$'),
  constraint admin_profiles_display_name_not_blank check (btrim(display_name) <> '')
);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.admin_profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.is_active
      and profile.authorization_expires_at > now()
  );
$$;

comment on function private.is_admin() is
  'Checks the current JWT user against the active administrative profile allowlist.';

revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid references public.admin_profiles (auth_user_id) on delete set null,
  actor_discord_user_id text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_discord_user_id_format check (
    actor_discord_user_id is null or actor_discord_user_id ~ '^[0-9]{15,22}$'
  ),
  constraint audit_events_action_not_blank check (btrim(action) <> ''),
  constraint audit_events_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint audit_events_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  constraint audit_events_metadata_has_no_secret_fields check (
    not (metadata ?| array[
      'secret',
      'plaintext',
      'ciphertext',
      'encrypted_payload',
      'iv',
      'auth_tag',
      'fingerprint'
    ])
  )
);

create table if not exists public.platform_settings (
  id smallint primary key default 1,
  currency_code text not null default 'BRL',
  global_commission_bps integer not null default 3000,
  display_timezone text not null default 'America/Sao_Paulo',
  updated_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_settings_singleton check (id = 1),
  constraint platform_settings_currency_brl check (currency_code = 'BRL'),
  constraint platform_settings_commission_range check (
    global_commission_bps between 0 and 10000
  )
);

insert into public.platform_settings (id, currency_code, global_commission_bps)
values (1, 'BRL', 3000)
on conflict (id) do nothing;

create table if not exists public.whitelist_entries (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null unique,
  label text,
  notes text,
  is_active boolean not null default true,
  commission_override_bps integer,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whitelist_entries_discord_id_format check (discord_id ~ '^[0-9]{15,22}$'),
  constraint whitelist_entries_commission_range check (
    commission_override_bps is null
    or commission_override_bps between 0 and 10000
  ),
  constraint whitelist_entries_archive_state check (
    archived_at is null or not is_active
  )
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  image_url text,
  status public.catalog_status not null default 'inactive',
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_name_not_blank check (btrim(name) <> ''),
  constraint games_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint games_image_url_format check (
    image_url is null or image_url ~ '^https?://'
  ),
  constraint games_archive_state check (
    (archived_at is null and status <> 'archived')
    or (archived_at is not null and status = 'archived')
  )
);

create table if not exists public.substores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete restrict,
  name text not null,
  slug text not null,
  title text not null,
  description text not null default '',
  color_hex text not null default '#D4AF37',
  image_url text,
  thumbnail_url text,
  author_name text,
  author_icon_url text,
  footer_text text,
  footer_icon_url text,
  status public.catalog_status not null default 'inactive',
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint substores_name_not_blank check (btrim(name) <> ''),
  constraint substores_title_not_blank check (btrim(title) <> ''),
  constraint substores_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint substores_color_format check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint substores_archive_state check (
    (archived_at is null and status <> 'archived')
    or (archived_at is not null and status = 'archived')
  )
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  substore_id uuid not null references public.substores (id) on delete restrict,
  name text not null,
  slug text not null,
  description text,
  minimum_price_cents bigint not null,
  image_url text,
  status public.catalog_status not null default 'inactive',
  sort_order integer not null default 0,
  low_stock_threshold integer not null default 5,
  archived_at timestamptz,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint products_minimum_price_nonnegative check (minimum_price_cents >= 0),
  constraint products_low_stock_threshold_nonnegative check (low_stock_threshold >= 0),
  constraint products_archive_state check (
    (archived_at is null and status <> 'archived')
    or (archived_at is not null and status = 'archived')
  )
);

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  request_id uuid,
  source text not null,
  import_method text not null default 'manual',
  unit_count integer not null,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_batches_source_not_blank check (btrim(source) <> ''),
  constraint inventory_batches_source_length check (char_length(source) <= 255),
  constraint inventory_batches_method check (import_method in ('manual', 'txt', 'csv')),
  constraint inventory_batches_unit_count_positive check (unit_count > 0)
);

create table if not exists public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  batch_id uuid not null references public.inventory_batches (id) on delete restrict,
  encrypted_payload bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  fingerprint bytea not null,
  status public.inventory_unit_status not null default 'available',
  reservation_expires_at timestamptz,
  delivered_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_units_payload_not_empty check (octet_length(encrypted_payload) > 0),
  constraint inventory_units_iv_length check (octet_length(iv) = 12),
  constraint inventory_units_auth_tag_length check (octet_length(auth_tag) = 16),
  constraint inventory_units_fingerprint_length check (octet_length(fingerprint) = 32),
  constraint inventory_units_delivery_state check (
    (status = 'delivered' and delivered_at is not null)
    or (status <> 'delivered' and delivered_at is null)
  ),
  constraint inventory_units_revocation_state check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  )
);

comment on table public.inventory_units is
  'Encrypted inventory only. Plaintext secret material must never be written to this table.';
comment on column public.inventory_units.encrypted_payload is
  'AES-256-GCM ciphertext. Decryption keys remain outside PostgreSQL.';
comment on column public.inventory_units.fingerprint is
  'HMAC-SHA-256 used solely for exact duplicate detection.';

create table if not exists public.guilds (
  id uuid primary key default gen_random_uuid(),
  discord_guild_id text not null unique,
  owner_discord_id text not null,
  whitelist_entry_id uuid references public.whitelist_entries (id) on delete restrict,
  name text not null,
  status public.guild_status not null default 'active',
  configuration jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guilds_discord_id_format check (discord_guild_id ~ '^[0-9]{15,22}$'),
  constraint guilds_owner_discord_id_format check (owner_discord_id ~ '^[0-9]{15,22}$'),
  constraint guilds_name_not_blank check (btrim(name) <> ''),
  constraint guilds_configuration_is_object check (jsonb_typeof(configuration) = 'object'),
  constraint guilds_archive_state check (
    (archived_at is null and status <> 'archived')
    or (archived_at is not null and status = 'archived')
  )
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds (id) on delete restrict,
  seller_whitelist_entry_id uuid references public.whitelist_entries (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  inventory_unit_id uuid references public.inventory_units (id) on delete restrict,
  buyer_discord_id text not null,
  status public.order_status not null default 'pending',
  currency_code text not null default 'BRL',
  sale_price_cents bigint not null,
  minimum_price_cents bigint not null,
  commission_bps integer not null,
  payment_reference text,
  paid_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_buyer_discord_id_format check (buyer_discord_id ~ '^[0-9]{15,22}$'),
  constraint orders_currency_brl check (currency_code = 'BRL'),
  constraint orders_sale_price_nonnegative check (sale_price_cents >= 0),
  constraint orders_minimum_price_nonnegative check (minimum_price_cents >= 0),
  constraint orders_price_floor check (sale_price_cents >= minimum_price_cents),
  constraint orders_commission_range check (commission_bps between 0 and 10000),
  constraint orders_delivery_state check (
    (status = 'delivered' and delivered_at is not null)
    or status <> 'delivered'
  )
);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  whitelist_entry_id uuid not null references public.whitelist_entries (id) on delete restrict,
  amount_cents bigint not null,
  currency_code text not null default 'BRL',
  status public.payout_status not null default 'requested',
  destination_reference text,
  notes text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payouts_amount_positive check (amount_cents > 0),
  constraint payouts_currency_brl check (currency_code = 'BRL')
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  whitelist_entry_id uuid not null references public.whitelist_entries (id) on delete restrict,
  guild_id uuid references public.guilds (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  payout_id uuid references public.payouts (id) on delete restrict,
  kind public.ledger_entry_kind not null,
  status public.ledger_entry_status not null default 'pending',
  amount_cents bigint not null,
  currency_code text not null default 'BRL',
  description text,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  available_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ledger_entries_amount_nonzero check (amount_cents <> 0),
  constraint ledger_entries_currency_brl check (currency_code = 'BRL')
);

-- Case-insensitive, reusable-after-archive catalog identifiers.
create unique index if not exists games_active_slug_unique
  on public.games (lower(slug))
  where archived_at is null;
create unique index if not exists substores_active_slug_unique
  on public.substores (game_id, lower(slug))
  where archived_at is null;
create unique index if not exists products_active_slug_unique
  on public.products (substore_id, lower(slug))
  where archived_at is null;

create index if not exists audit_events_created_at_idx
  on public.audit_events (created_at desc);
create index if not exists audit_events_actor_idx
  on public.audit_events (actor_auth_user_id, created_at desc);
create index if not exists audit_events_entity_idx
  on public.audit_events (entity_type, entity_id, created_at desc);
create unique index if not exists audit_events_actor_action_request_unique
  on public.audit_events (actor_auth_user_id, action, request_id)
  where request_id is not null;
create index if not exists whitelist_entries_active_idx
  on public.whitelist_entries (is_active, created_at desc)
  where archived_at is null;
create index if not exists games_status_sort_idx
  on public.games (status, sort_order, name)
  where archived_at is null;
create index if not exists substores_game_status_sort_idx
  on public.substores (game_id, status, sort_order, name)
  where archived_at is null;
create index if not exists products_substore_status_sort_idx
  on public.products (substore_id, status, sort_order, name)
  where archived_at is null;
create index if not exists inventory_batches_product_created_idx
  on public.inventory_batches (product_id, created_at desc);
create unique index if not exists inventory_batches_actor_request_unique
  on public.inventory_batches (created_by, request_id)
  where request_id is not null;
create unique index if not exists inventory_units_fingerprint_unique
  on public.inventory_units (fingerprint);
create index if not exists inventory_units_product_status_idx
  on public.inventory_units (product_id, status, created_at);
create index if not exists inventory_units_batch_idx
  on public.inventory_units (batch_id, created_at);
create index if not exists inventory_units_expiring_reservations_idx
  on public.inventory_units (reservation_expires_at)
  where status = 'reserved';
create index if not exists guilds_whitelist_status_idx
  on public.guilds (whitelist_entry_id, status, created_at desc);
create index if not exists orders_guild_status_created_idx
  on public.orders (guild_id, status, created_at desc);
create index if not exists orders_buyer_created_idx
  on public.orders (buyer_discord_id, created_at desc);
create index if not exists orders_product_created_idx
  on public.orders (product_id, created_at desc);
create unique index if not exists orders_inventory_unit_unique
  on public.orders (inventory_unit_id)
  where inventory_unit_id is not null;
create unique index if not exists orders_payment_reference_unique
  on public.orders (payment_reference)
  where payment_reference is not null;
create index if not exists payouts_whitelist_status_created_idx
  on public.payouts (whitelist_entry_id, status, created_at desc);
create index if not exists ledger_entries_whitelist_created_idx
  on public.ledger_entries (whitelist_entry_id, created_at desc);
create index if not exists ledger_entries_status_available_idx
  on public.ledger_entries (status, available_at, created_at)
  where status in ('pending', 'available');
create index if not exists ledger_entries_guild_created_idx
  on public.ledger_entries (guild_id, created_at desc)
  where guild_id is not null;
create index if not exists ledger_entries_order_idx
  on public.ledger_entries (order_id)
  where order_id is not null;
create index if not exists ledger_entries_payout_idx
  on public.ledger_entries (payout_id)
  where payout_id is not null;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create or replace function private.audit_admin_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_discord_id text;
  v_entity_id uuid;
  v_entity_type text;
  v_action_prefix text;
  v_action_suffix text;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  -- Service-role bootstrap/maintenance has no end-user JWT and is intentionally skipped.
  if v_actor is null then
    return new;
  end if;

  select profile.discord_user_id
  into v_actor_discord_id
  from public.admin_profiles as profile
  where profile.auth_user_id = v_actor
    and profile.is_active;

  if not found then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  v_entity_type := case tg_table_name
    when 'games' then 'game'
    when 'substores' then 'substore'
    when 'products' then 'product'
    when 'whitelist_entries' then 'whitelist_entry'
    when 'platform_settings' then 'platform_settings'
    else tg_table_name
  end;

  v_action_prefix := case tg_table_name
    when 'games' then 'game'
    when 'substores' then 'substore'
    when 'products' then 'product'
    when 'whitelist_entries' then 'whitelist'
    when 'platform_settings' then 'settings'
    else tg_table_name
  end;

  if tg_table_name <> 'platform_settings' then
    v_entity_id := nullif(to_jsonb(new) ->> 'id', '')::uuid;
  end if;

  if tg_op = 'INSERT' then
    v_action_suffix := 'create';

    select coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
    into v_changed_fields
    from jsonb_object_keys(
      to_jsonb(new) - array[
        'description',
        'notes',
        'created_at',
        'updated_at'
      ]
    ) as field_name;
  else
    v_action_suffix := case
      when tg_table_name in ('games', 'substores', 'products')
        and to_jsonb(new) ->> 'status' = 'archived'
        and to_jsonb(old) ->> 'status' is distinct from 'archived'
        then 'archive'
      when tg_table_name = 'whitelist_entries'
        and (
          (to_jsonb(new) ->> 'archived_at') is not null
          and (to_jsonb(old) ->> 'archived_at') is null
        )
        then 'archive'
      else 'update'
    end;

    select coalesce(jsonb_agg(new_field.key order by new_field.key), '[]'::jsonb)
    into v_changed_fields
    from jsonb_each(to_jsonb(new)) as new_field
    join jsonb_each(to_jsonb(old)) as old_field using (key)
    where new_field.value is distinct from old_field.value
      and new_field.key not in (
        'description',
        'notes',
        'created_at',
        'updated_at'
      );
  end if;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor,
    v_actor_discord_id,
    v_action_prefix || '.' || v_action_suffix,
    v_entity_type,
    v_entity_id,
    jsonb_build_object(
      'changed_fields', v_changed_fields,
      'settings_id', case
        when tg_table_name = 'platform_settings' then to_jsonb(new) ->> 'id'
        else null
      end
    )
  );

  return new;
end;
$$;

create or replace function private.audit_catalog_media_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_discord_id text;
  v_bucket_id text;
  v_path text;
  v_action text;
begin
  v_bucket_id := case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end;
  if v_bucket_id <> 'catalog-media' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if v_actor is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select profile.discord_user_id
  into v_actor_discord_id
  from public.admin_profiles as profile
  where profile.auth_user_id = v_actor
    and profile.is_active;

  if not found then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  v_path := case when tg_op = 'DELETE' then old.name else new.name end;
  v_action := case tg_op
    when 'INSERT' then 'media.upload'
    when 'DELETE' then 'media.delete'
    else 'media.update'
  end;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor,
    v_actor_discord_id,
    v_action,
    'catalog_media',
    null,
    jsonb_build_object('bucket_id', v_bucket_id, 'path', v_path)
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists admin_profiles_set_updated_at on public.admin_profiles;
create trigger admin_profiles_set_updated_at
before update on public.admin_profiles
for each row execute function private.set_updated_at();

drop trigger if exists platform_settings_set_updated_at on public.platform_settings;
create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function private.set_updated_at();

drop trigger if exists platform_settings_audit_mutation on public.platform_settings;
create trigger platform_settings_audit_mutation
after insert or update on public.platform_settings
for each row execute function private.audit_admin_mutation();

drop trigger if exists whitelist_entries_set_updated_at on public.whitelist_entries;
create trigger whitelist_entries_set_updated_at
before update on public.whitelist_entries
for each row execute function private.set_updated_at();

drop trigger if exists whitelist_entries_audit_mutation on public.whitelist_entries;
create trigger whitelist_entries_audit_mutation
after insert or update on public.whitelist_entries
for each row execute function private.audit_admin_mutation();

drop trigger if exists games_set_updated_at on public.games;
create trigger games_set_updated_at
before update on public.games
for each row execute function private.set_updated_at();

drop trigger if exists games_audit_mutation on public.games;
create trigger games_audit_mutation
after insert or update on public.games
for each row execute function private.audit_admin_mutation();

drop trigger if exists substores_set_updated_at on public.substores;
create trigger substores_set_updated_at
before update on public.substores
for each row execute function private.set_updated_at();

drop trigger if exists substores_audit_mutation on public.substores;
create trigger substores_audit_mutation
after insert or update on public.substores
for each row execute function private.audit_admin_mutation();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

drop trigger if exists products_audit_mutation on public.products;
create trigger products_audit_mutation
after insert or update on public.products
for each row execute function private.audit_admin_mutation();

drop trigger if exists inventory_batches_set_updated_at on public.inventory_batches;
create trigger inventory_batches_set_updated_at
before update on public.inventory_batches
for each row execute function private.set_updated_at();

drop trigger if exists inventory_units_set_updated_at on public.inventory_units;
create trigger inventory_units_set_updated_at
before update on public.inventory_units
for each row execute function private.set_updated_at();

drop trigger if exists guilds_set_updated_at on public.guilds;
create trigger guilds_set_updated_at
before update on public.guilds
for each row execute function private.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function private.set_updated_at();

drop trigger if exists payouts_set_updated_at on public.payouts;
create trigger payouts_set_updated_at
before update on public.payouts
for each row execute function private.set_updated_at();

drop trigger if exists audit_events_are_immutable on public.audit_events;
create trigger audit_events_are_immutable
before update or delete on public.audit_events
for each row execute function private.reject_immutable_mutation();

drop trigger if exists ledger_entries_are_immutable on public.ledger_entries;
create trigger ledger_entries_are_immutable
before update or delete on public.ledger_entries
for each row execute function private.reject_immutable_mutation();

drop trigger if exists whitelist_entries_no_hard_delete on public.whitelist_entries;
create trigger whitelist_entries_no_hard_delete
before delete on public.whitelist_entries
for each row execute function private.reject_immutable_mutation();

drop trigger if exists games_no_hard_delete on public.games;
create trigger games_no_hard_delete
before delete on public.games
for each row execute function private.reject_immutable_mutation();

drop trigger if exists substores_no_hard_delete on public.substores;
create trigger substores_no_hard_delete
before delete on public.substores
for each row execute function private.reject_immutable_mutation();

drop trigger if exists products_no_hard_delete on public.products;
create trigger products_no_hard_delete
before delete on public.products
for each row execute function private.reject_immutable_mutation();

drop trigger if exists inventory_batches_no_hard_delete on public.inventory_batches;
create trigger inventory_batches_no_hard_delete
before delete on public.inventory_batches
for each row execute function private.reject_immutable_mutation();

drop trigger if exists inventory_units_no_hard_delete on public.inventory_units;
create trigger inventory_units_no_hard_delete
before delete on public.inventory_units
for each row execute function private.reject_immutable_mutation();

-- Security-invoker views never bypass the underlying tables' RLS policies.
create or replace view public.effective_whitelist_commissions
with (security_invoker = true)
as
select
  entry.id as whitelist_entry_id,
  entry.discord_id,
  entry.commission_override_bps,
  settings.global_commission_bps,
  coalesce(entry.commission_override_bps, settings.global_commission_bps) as effective_commission_bps,
  case
    when entry.commission_override_bps is null then 'global'
    else 'override'
  end as commission_source
from public.whitelist_entries as entry
cross join public.platform_settings as settings
where settings.id = 1;

create or replace view public.product_stock_summary
with (security_invoker = true)
as
select
  product.id as product_id,
  product.name as product_name,
  product.substore_id,
  count(unit.id) filter (where unit.status = 'available')::bigint as available_count,
  count(unit.id) filter (where unit.status = 'reserved')::bigint as reserved_count,
  count(unit.id)::bigint as total_count,
  product.low_stock_threshold,
  (
    count(unit.id) filter (where unit.status = 'available')
    <= product.low_stock_threshold
  ) as is_low_stock,
  count(unit.id) filter (where unit.status = 'delivered')::bigint as delivered_count,
  count(unit.id) filter (where unit.status = 'quarantined')::bigint as quarantined_count,
  count(unit.id) filter (where unit.status = 'revoked')::bigint as revoked_count,
  product.status as product_status
from public.products as product
left join public.inventory_units as unit on unit.product_id = product.id
group by product.id;

create or replace view public.whitelist_balances
with (security_invoker = true)
as
select
  entry.id as whitelist_entry_id,
  entry.discord_id,
  coalesce(
    sum(ledger.amount_cents) filter (where ledger.status in ('pending', 'available')),
    0
  )::bigint as balance_cents,
  coalesce(
    sum(ledger.amount_cents) filter (where ledger.status = 'pending'),
    0
  )::bigint as pending_balance_cents,
  coalesce(
    sum(ledger.amount_cents) filter (where ledger.status = 'available'),
    0
  )::bigint as available_balance_cents,
  coalesce(
    sum(ledger.amount_cents) filter (
      where ledger.kind = 'sale_profit'
        and ledger.status <> 'reversed'
    ),
    0
  )::bigint as total_profit_cents,
  coalesce(
    sum(-ledger.amount_cents) filter (
      where ledger.kind in ('payout', 'payout_reversal')
        and ledger.status <> 'reversed'
    ),
    0
  )::bigint as total_paid_out_cents
from public.whitelist_entries as entry
left join public.ledger_entries as ledger on ledger.whitelist_entry_id = entry.id
group by entry.id;

create or replace view public.admin_dashboard_summary
with (security_invoker = true)
as
select
  (select count(*) from public.games where archived_at is null)::bigint as games_count,
  (select count(*) from public.substores where archived_at is null)::bigint as substores_count,
  (select count(*) from public.products where archived_at is null)::bigint as products_count,
  (select count(*) from public.inventory_units where status = 'available')::bigint as available_units_count,
  (
    select count(*)
    from public.product_stock_summary
    where is_low_stock and product_status <> 'archived'
  )::bigint as low_stock_products_count,
  (select count(*) from public.guilds where archived_at is null)::bigint as guilds_count,
  (select count(*) from public.orders)::bigint as orders_count,
  (select count(*) from public.orders where status = 'delivered')::bigint as delivered_orders_count,
  (
    select coalesce(sum(amount_cents), 0)
    from public.ledger_entries
  )::bigint as ledger_balance_cents,
  (
    select coalesce(sum(amount_cents), 0)
    from public.payouts
    where status in ('requested', 'approved', 'processing')
  )::bigint as pending_payouts_cents;

-- Atomic encrypted inventory import. Input values are base64 strings.
drop function if exists public.admin_import_inventory_units(uuid, text, jsonb);
drop function if exists public.admin_import_inventory_units(uuid, text, text, jsonb);
drop function if exists public.admin_import_inventory_units(uuid, text, text, jsonb, uuid);
create or replace function public.admin_import_inventory_units(
  p_product_id uuid,
  p_source text,
  p_import_method text,
  p_units jsonb,
  p_request_id uuid
)
returns table (batch_id uuid, imported_count integer, reused boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_discord_id text;
  v_batch_id uuid;
  v_count integer;
  v_index integer := 0;
  v_unit jsonb;
  v_payload bytea;
  v_iv bytea;
  v_auth_tag bytea;
  v_fingerprint bytea;
begin
  if v_actor is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  if p_source is null or btrim(p_source) = '' or char_length(p_source) > 255 then
    raise exception using errcode = '22023', message = 'Origem de importação inválida.';
  end if;

  if p_import_method is null or p_import_method not in ('manual', 'txt', 'csv') then
    raise exception using errcode = '22023', message = 'Método de importação inválido.';
  end if;

  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador idempotente da importação é obrigatório.';
  end if;

  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception using errcode = '22023', message = 'p_units deve ser um array JSON.';
  end if;

  v_count := jsonb_array_length(p_units);
  if v_count < 1 or v_count > 5000 then
    raise exception using errcode = '22023', message = 'Uma importação deve conter entre 1 e 5000 unidades.';
  end if;

  perform 1
  from public.products
  where id = p_product_id
    and archived_at is null
    and status <> 'archived';

  if not found then
    raise exception using errcode = 'P0002', message = 'Produto ativo não encontrado.';
  end if;

  select discord_user_id
  into v_actor_discord_id
  from public.admin_profiles
  where auth_user_id = v_actor;

  begin
    insert into public.inventory_batches (
      product_id,
      request_id,
      source,
      import_method,
      unit_count,
      created_by
    )
    values (
      p_product_id,
      p_request_id,
      btrim(p_source),
      p_import_method,
      v_count,
      v_actor
    )
    returning id into v_batch_id;
  exception
    when unique_violation then
      select batch.id, batch.unit_count
      into v_batch_id, v_index
      from public.inventory_batches as batch
      where batch.created_by = v_actor
        and batch.request_id = p_request_id;

      if not found then
        raise;
      end if;

      if not exists (
        select 1
        from public.inventory_batches as batch
        where batch.id = v_batch_id
          and batch.product_id = p_product_id
          and batch.source = btrim(p_source)
          and batch.import_method = p_import_method
          and batch.unit_count = v_count
      ) then
        raise exception using
          errcode = '22023',
          message = 'O identificador da importação já foi usado com outro conteúdo.';
      end if;

      return query select v_batch_id, v_index, true;
      return;
  end;

  begin
    for v_unit in
      select value from jsonb_array_elements(p_units)
    loop
      v_index := v_index + 1;

      if jsonb_typeof(v_unit) <> 'object'
        or jsonb_typeof(v_unit -> 'encrypted_payload') is distinct from 'string'
        or jsonb_typeof(v_unit -> 'iv') is distinct from 'string'
        or jsonb_typeof(v_unit -> 'auth_tag') is distinct from 'string'
        or jsonb_typeof(v_unit -> 'fingerprint') is distinct from 'string'
      then
        raise exception using
          errcode = '22023',
          message = format('Unidade %s possui formato inválido.', v_index);
      end if;

      begin
        v_payload := decode(v_unit ->> 'encrypted_payload', 'base64');
        v_iv := decode(v_unit ->> 'iv', 'base64');
        v_auth_tag := decode(v_unit ->> 'auth_tag', 'base64');
        v_fingerprint := decode(v_unit ->> 'fingerprint', 'base64');
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = format('Unidade %s contém base64 inválido.', v_index);
      end;

      if octet_length(v_payload) < 1
        or octet_length(v_iv) <> 12
        or octet_length(v_auth_tag) <> 16
        or octet_length(v_fingerprint) <> 32
      then
        raise exception using
          errcode = '22023',
          message = format('Unidade %s possui parâmetros criptográficos inválidos.', v_index);
      end if;

      insert into public.inventory_units (
        product_id,
        batch_id,
        encrypted_payload,
        iv,
        auth_tag,
        fingerprint,
        status,
        created_by
      )
      values (
        p_product_id,
        v_batch_id,
        v_payload,
        v_iv,
        v_auth_tag,
        v_fingerprint,
        'available',
        v_actor
      );
    end loop;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'Uma ou mais unidades já existem no estoque.';
  end;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  )
  values (
    v_actor,
    v_actor_discord_id,
    'inventory.import',
    'inventory_batch',
    v_batch_id,
    p_request_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'source', btrim(p_source),
      'import_method', p_import_method,
      'unit_count', v_count
    )
  );

  return query select v_batch_id, v_count, false;
end;
$$;

comment on function public.admin_import_inventory_units(uuid, text, text, jsonb, uuid) is
  'Idempotently imports base64-encoded AES-GCM fields and HMAC fingerprints; no plaintext is accepted.';

-- Returns ciphertext in base64 for server-side decryption and always records the reveal.
drop function if exists public.admin_get_inventory_secret(uuid);
create or replace function public.admin_get_inventory_secret(p_unit_id uuid)
returns table (
  product_id uuid,
  encrypted_payload text,
  iv text,
  auth_tag text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_discord_id text;
  v_product_id uuid;
  v_status public.inventory_unit_status;
  v_payload bytea;
  v_iv bytea;
  v_auth_tag bytea;
begin
  if v_actor is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  select
    unit.product_id,
    unit.status,
    unit.encrypted_payload,
    unit.iv,
    unit.auth_tag
  into
    v_product_id,
    v_status,
    v_payload,
    v_iv,
    v_auth_tag
  from public.inventory_units as unit
  where unit.id = p_unit_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Unidade de estoque não encontrada.';
  end if;

  select discord_user_id
  into v_actor_discord_id
  from public.admin_profiles
  where auth_user_id = v_actor;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor,
    v_actor_discord_id,
    'inventory.reveal',
    'inventory_unit',
    p_unit_id,
    jsonb_build_object(
      'product_id', v_product_id,
      'status', v_status::text
    )
  );

  return query
  select
    v_product_id,
    encode(v_payload, 'base64'),
    encode(v_iv, 'base64'),
    encode(v_auth_tag, 'base64');
end;
$$;

comment on function public.admin_get_inventory_secret(uuid) is
  'Returns only encrypted AES-GCM material as base64 and appends an audit event without secret data.';

-- Used by import previews to detect already-stored HMACs without exposing the table.
drop function if exists public.admin_check_inventory_fingerprints(text[]);
create or replace function public.admin_check_inventory_fingerprints(p_fingerprints text[])
returns table (fingerprint text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_value text;
  v_decoded bytea;
  v_count integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  v_count := coalesce(cardinality(p_fingerprints), 0);
  if v_count < 1 or v_count > 5000 then
    raise exception using errcode = '22023', message = 'Informe entre 1 e 5000 fingerprints.';
  end if;

  foreach v_value in array p_fingerprints
  loop
    if v_value is null then
      raise exception using errcode = '22023', message = 'Fingerprint inválido.';
    end if;

    begin
      v_decoded := decode(v_value, 'base64');
    exception
      when others then
        raise exception using errcode = '22023', message = 'Fingerprint inválido.';
    end;

    if octet_length(v_decoded) <> 32 then
      raise exception using errcode = '22023', message = 'Fingerprint inválido.';
    end if;
  end loop;

  return query
  select encode(unit.fingerprint, 'base64')
  from public.inventory_units as unit
  join (
    select distinct decode(candidate, 'base64') as decoded
    from unnest(p_fingerprints) as requested_input(candidate)
  ) as requested on requested.decoded = unit.fingerprint
  order by encode(unit.fingerprint, 'base64');
end;
$$;

comment on function public.admin_check_inventory_fingerprints(text[]) is
  'Returns only caller-supplied HMAC fingerprints that already exist, encoded as base64.';

-- Changes only safe inventory state fields. Encrypted columns are never accepted as input.
drop function if exists public.admin_change_inventory_status(uuid, text, text);
create or replace function public.admin_change_inventory_status(
  p_unit_id uuid,
  p_status text,
  p_reason text default null
)
returns table (
  id uuid,
  product_id uuid,
  batch_id uuid,
  status public.inventory_unit_status,
  reservation_expires_at timestamptz,
  delivered_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_discord_id text;
  v_product_id uuid;
  v_previous_status public.inventory_unit_status;
  v_target_status public.inventory_unit_status;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null or not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  if p_status is null or p_status not in ('available', 'quarantined', 'revoked') then
    raise exception using errcode = '22023', message = 'Estado administrativo de estoque inválido.';
  end if;

  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception using errcode = '22023', message = 'O motivo deve ter no máximo 1000 caracteres.';
  end if;

  v_target_status := p_status::public.inventory_unit_status;

  select unit.product_id, unit.status
  into v_product_id, v_previous_status
  from public.inventory_units as unit
  where unit.id = p_unit_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Unidade de estoque não encontrada.';
  end if;

  if v_previous_status not in ('available', 'quarantined', 'revoked') then
    raise exception using
      errcode = '22023',
      message = format(
        'A unidade em estado %s não pode ser alterada administrativamente.',
        v_previous_status
      );
  end if;

  if v_previous_status = 'revoked' and v_target_status <> 'revoked' then
    raise exception using
      errcode = '22023',
      message = 'Uma unidade revogada não pode voltar ao estoque disponível.';
  end if;

  if v_previous_status = v_target_status then
    return query
    select
      unit.id,
      unit.product_id,
      unit.batch_id,
      unit.status,
      unit.reservation_expires_at,
      unit.delivered_at,
      unit.revoked_at,
      unit.revocation_reason,
      unit.created_at,
      unit.updated_at
    from public.inventory_units as unit
    where unit.id = p_unit_id;
    return;
  end if;

  update public.inventory_units as unit
  set
    status = v_target_status,
    reservation_expires_at = null,
    revoked_at = case
      when v_target_status = 'revoked' then coalesce(unit.revoked_at, now())
      else null
    end,
    revocation_reason = case
      when v_target_status = 'revoked' then v_reason
      else null
    end
  where unit.id = p_unit_id;

  select discord_user_id
  into v_actor_discord_id
  from public.admin_profiles
  where auth_user_id = v_actor;

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor,
    v_actor_discord_id,
    'inventory.status_change',
    'inventory_unit',
    p_unit_id,
    jsonb_build_object(
      'product_id', v_product_id,
      'from_status', v_previous_status::text,
      'to_status', v_target_status::text,
      'reason_provided', v_reason is not null
    )
  );

  return query
  select
    unit.id,
    unit.product_id,
    unit.batch_id,
    unit.status,
    unit.reservation_expires_at,
    unit.delivered_at,
    unit.revoked_at,
    unit.revocation_reason,
    unit.created_at,
    unit.updated_at
  from public.inventory_units as unit
  where unit.id = p_unit_id;
end;
$$;

comment on function public.admin_change_inventory_status(uuid, text, text) is
  'Allows active admins to quarantine, release, or permanently revoke eligible units and audits the change.';

-- RLS is enabled and forced everywhere. No policy is granted to anon.
alter table public.admin_profiles enable row level security;
alter table public.admin_profiles force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;
alter table public.whitelist_entries enable row level security;
alter table public.whitelist_entries force row level security;
alter table public.games enable row level security;
alter table public.games force row level security;
alter table public.substores enable row level security;
alter table public.substores force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_batches force row level security;
alter table public.inventory_units enable row level security;
alter table public.inventory_units force row level security;
alter table public.guilds enable row level security;
alter table public.guilds force row level security;
alter table public.orders enable row level security;
alter table public.orders force row level security;
alter table public.payouts enable row level security;
alter table public.payouts force row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_entries force row level security;

drop policy if exists admin_profiles_admin_all on public.admin_profiles;
drop policy if exists admin_profiles_admin_select on public.admin_profiles;
create policy admin_profiles_admin_select
on public.admin_profiles
for select
to authenticated
using (private.is_admin());

drop policy if exists audit_events_admin_select on public.audit_events;
create policy audit_events_admin_select
on public.audit_events
for select
to authenticated
using (private.is_admin());

drop policy if exists audit_events_admin_insert on public.audit_events;

drop policy if exists platform_settings_admin_all on public.platform_settings;
create policy platform_settings_admin_all
on public.platform_settings
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists whitelist_entries_admin_all on public.whitelist_entries;
create policy whitelist_entries_admin_all
on public.whitelist_entries
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists games_admin_all on public.games;
create policy games_admin_all
on public.games
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists substores_admin_all on public.substores;
create policy substores_admin_all
on public.substores
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists products_admin_all on public.products;
create policy products_admin_all
on public.products
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists inventory_batches_admin_select on public.inventory_batches;
create policy inventory_batches_admin_select
on public.inventory_batches
for select
to authenticated
using (private.is_admin());

drop policy if exists inventory_units_admin_select on public.inventory_units;
create policy inventory_units_admin_select
on public.inventory_units
for select
to authenticated
using (private.is_admin());

-- Operational foundations are deliberately read-only to the dashboard in v1.
drop policy if exists guilds_admin_select on public.guilds;
create policy guilds_admin_select
on public.guilds
for select
to authenticated
using (private.is_admin());

drop policy if exists orders_admin_select on public.orders;
create policy orders_admin_select
on public.orders
for select
to authenticated
using (private.is_admin());

drop policy if exists payouts_admin_select on public.payouts;
create policy payouts_admin_select
on public.payouts
for select
to authenticated
using (private.is_admin());

drop policy if exists ledger_entries_admin_select on public.ledger_entries;
create policy ledger_entries_admin_select
on public.ledger_entries
for select
to authenticated
using (private.is_admin());

-- Remove broad defaults commonly present in hosted Supabase projects, then grant least privilege.
revoke all on table public.admin_profiles from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
revoke all on table public.platform_settings from anon, authenticated;
revoke all on table public.whitelist_entries from anon, authenticated;
revoke all on table public.games from anon, authenticated;
revoke all on table public.substores from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.inventory_batches from anon, authenticated;
revoke all on table public.inventory_units from anon, authenticated;
revoke all on table public.guilds from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.payouts from anon, authenticated;
revoke all on table public.ledger_entries from anon, authenticated;

grant select on table public.admin_profiles to authenticated;
grant select on table public.audit_events to authenticated;
grant select, insert, update on table public.platform_settings to authenticated;
grant select, insert, update on table public.whitelist_entries to authenticated;
grant select, insert, update on table public.games to authenticated;
grant select, insert, update on table public.substores to authenticated;
grant select, insert, update on table public.products to authenticated;
grant select on table public.inventory_batches to authenticated;
grant select (
  id,
  product_id,
  batch_id,
  status,
  reservation_expires_at,
  delivered_at,
  revoked_at,
  revocation_reason,
  created_by,
  created_at,
  updated_at
) on public.inventory_units to authenticated;
grant select on table public.guilds to authenticated;
grant select on table public.orders to authenticated;
grant select on table public.payouts to authenticated;
grant select on table public.ledger_entries to authenticated;

revoke all on table public.effective_whitelist_commissions from anon, authenticated;
revoke all on table public.product_stock_summary from anon, authenticated;
revoke all on table public.whitelist_balances from anon, authenticated;
revoke all on table public.admin_dashboard_summary from anon, authenticated;
grant select on table public.effective_whitelist_commissions to authenticated;
grant select on table public.product_stock_summary to authenticated;
grant select on table public.whitelist_balances to authenticated;
grant select on table public.admin_dashboard_summary to authenticated;

revoke all on function public.admin_import_inventory_units(uuid, text, text, jsonb, uuid) from public;
revoke all on function public.admin_get_inventory_secret(uuid) from public;
revoke all on function public.admin_check_inventory_fingerprints(text[]) from public;
revoke all on function public.admin_change_inventory_status(uuid, text, text) from public;
grant execute on function public.admin_import_inventory_units(uuid, text, text, jsonb, uuid) to authenticated;
grant execute on function public.admin_get_inventory_secret(uuid) to authenticated;
grant execute on function public.admin_check_inventory_fingerprints(text[]) to authenticated;
grant execute on function public.admin_change_inventory_status(uuid, text, text) to authenticated;

-- Public catalog images, with admin-only mutation.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'catalog-media',
  'catalog-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists godawpstore_catalog_media_public_read on storage.objects;
create policy godawpstore_catalog_media_public_read
on storage.objects
for select
to public
using (bucket_id = 'catalog-media');

drop policy if exists godawpstore_catalog_media_admin_insert on storage.objects;
create policy godawpstore_catalog_media_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'catalog-media'
  and private.is_admin()
);

drop policy if exists godawpstore_catalog_media_admin_update on storage.objects;
create policy godawpstore_catalog_media_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'catalog-media'
  and private.is_admin()
)
with check (
  bucket_id = 'catalog-media'
  and private.is_admin()
);

drop policy if exists godawpstore_catalog_media_admin_delete on storage.objects;
create policy godawpstore_catalog_media_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'catalog-media'
  and private.is_admin()
);

drop trigger if exists godawpstore_catalog_media_audit on storage.objects;
create trigger godawpstore_catalog_media_audit
after insert or update or delete on storage.objects
for each row execute function private.audit_catalog_media_mutation();
