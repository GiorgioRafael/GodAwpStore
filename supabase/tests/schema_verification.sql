-- Run after migrations with a privileged local connection:
--   supabase test db supabase/tests/schema_verification.sql
-- This file only inspects schema invariants and does not create fixture data.

do $$
declare
  required_table text;
  required_view text;
  required_function text;
begin
  foreach required_table in array array[
    'admin_profiles',
    'audit_events',
    'platform_settings',
    'whitelist_entries',
    'games',
    'substores',
    'products',
    'inventory_batches',
    'inventory_units',
    'guilds',
    'orders',
    'order_items',
    'ledger_entries',
    'payouts'
  ]
  loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Missing required table: public.%', required_table;
    end if;

    if not exists (
      select 1
      from pg_class as relation
      join pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = required_table
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception 'RLS is not enabled and forced for public.%', required_table;
    end if;
  end loop;

  foreach required_view in array array[
    'effective_whitelist_commissions',
    'product_stock_summary',
    'whitelist_balances',
    'admin_dashboard_summary',
    'admin_paid_pix_metrics'
  ]
  loop
    if to_regclass('public.' || required_view) is null then
      raise exception 'Missing required view: public.%', required_view;
    end if;
  end loop;

  foreach required_function in array array[
    'public.admin_import_inventory_units(uuid,text,text,jsonb,uuid)',
    'public.admin_get_inventory_secret(uuid)',
    'public.admin_check_inventory_fingerprints(text[])',
    'public.admin_change_inventory_status(uuid,text,text)',
    'public.get_paid_order_summary(timestamp with time zone,timestamp with time zone)',
    'public.create_bot_cart_with_reservation(text,uuid,uuid,text,jsonb,integer,text,integer)',
    'public.submit_paid_order_game_nickname(uuid,text,text,text,text)',
    'public.claim_discord_ticket_close(uuid,text,text,text,uuid)',
    'public.complete_discord_ticket_close(uuid,text,uuid)',
    'public.complete_discord_ticket_close(uuid,text,uuid,text)',
    'public.renew_discord_ticket_close_claim(uuid,text,uuid)',
    'public.release_discord_ticket_close(uuid,uuid)',
    'public.reconcile_missing_discord_ticket(uuid,text)'
  ]
  loop
    if to_regprocedure(required_function) is null then
      raise exception 'Missing required function: %', required_function;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_units'
      and column_name = 'encrypted_payload'
      and data_type = 'bytea'
  ) then
    raise exception 'inventory_units.encrypted_payload must be bytea';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'stock_quantity'
      and data_type = 'bigint'
      and is_nullable = 'NO'
  ) then
    raise exception 'products.stock_quantity must be a non-null bigint';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_stock_quantity_range'
      and conrelid = 'public.products'::regclass
  ) then
    raise exception 'products.stock_quantity range constraint is missing';
  end if;

  if to_regprocedure(
    'public.create_bot_order_with_reservation(text,uuid,uuid,uuid,text,integer,bigint,integer)'
  ) is null then
    raise exception 'Aggregate stock reservation function is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_profiles'
      and column_name = 'authorization_expires_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'admin_profiles.authorization_expires_at is missing or invalid';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_paid_pix_metrics'
      and column_name in (
        'paid_orders_count',
        'gross_revenue_cents',
        'gross_revenue_today_cents',
        'gross_revenue_last_7_days_cents',
        'gross_revenue_last_30_days_cents',
        'average_order_cents',
        'last_paid_at'
      )
  ) <> 7 then
    raise exception 'admin_paid_pix_metrics is missing a required metric';
  end if;

  if to_regclass('public.orders_paid_livepix_paid_at_idx') is null then
    raise exception 'The paid LivePix metrics index is missing';
  end if;

  if to_regclass('public.orders_paid_created_at_idx') is null then
    raise exception 'The paid order period index is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'game_nickname'
      and data_type = 'text'
      and is_nullable = 'YES'
  ) then
    raise exception 'orders.game_nickname must be a nullable text column';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'game_nickname_submitted_at'
      and data_type = 'timestamp with time zone'
      and is_nullable = 'YES'
  ) then
    raise exception 'orders.game_nickname_submitted_at must be a nullable timestamptz column';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname in (
        'orders_game_nickname_trimmed',
        'orders_game_nickname_length',
        'orders_game_nickname_no_control_characters',
        'orders_game_nickname_submission_state'
      )
  ) <> 4 then
    raise exception 'orders game nickname constraints are missing';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and (
        (column_name = 'discord_ticket_close_claim_token' and data_type = 'uuid')
        or (
          column_name in (
            'discord_ticket_close_claimed_at',
            'discord_ticket_closed_at'
          )
          and data_type = 'timestamp with time zone'
        )
        or (
          column_name in (
            'discord_ticket_close_claimed_by_discord_user_id',
            'discord_ticket_closed_by_discord_user_id'
          )
          and data_type = 'text'
        )
      )
      and is_nullable = 'YES'
  ) <> 5 then
    raise exception 'orders Discord ticket close state columns are missing or invalid';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname in (
        'orders_discord_ticket_close_claimed_by_format',
        'orders_discord_ticket_closed_by_format',
        'orders_discord_ticket_close_claim_state',
        'orders_discord_ticket_closed_state'
      )
  ) <> 4 then
    raise exception 'orders Discord ticket close constraints are missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'orders'
      and indexname = 'orders_discord_ticket_close_reconciliation_idx'
  ) then
    raise exception 'Discord ticket close reconciliation index is missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_units'
      and column_name in ('secret', 'plaintext', 'content', 'raw_value')
  ) then
    raise exception 'A plaintext-like inventory column exists';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.inventory_units',
    'encrypted_payload',
    'SELECT'
  ) then
    raise exception 'authenticated must not have direct SELECT access to encrypted_payload';
  end if;

  if has_table_privilege('authenticated', 'public.admin_profiles', 'UPDATE') then
    raise exception 'authenticated must not update the admin authorization registry directly';
  end if;

  if has_table_privilege('authenticated', 'public.audit_events', 'INSERT') then
    raise exception 'authenticated must not forge audit events directly';
  end if;

  if not has_column_privilege(
    'authenticated',
    'public.inventory_units',
    'status',
    'SELECT'
  ) then
    raise exception 'authenticated must be able to read safe inventory metadata';
  end if;

  if exists (
    select 1
    from pg_policies as policy
    cross join lateral unnest(policy.roles) as granted_role
    where policy.schemaname = 'public'
      and granted_role::text in ('anon', 'public')
  ) then
    raise exception 'A public schema policy unexpectedly grants anon/public access';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'effective_whitelist_commissions',
        'product_stock_summary',
        'whitelist_balances',
        'admin_dashboard_summary',
        'admin_paid_pix_metrics'
      )
      and not ('security_invoker=true' = any(coalesce(relation.reloptions, array[]::text[])))
  ) then
    raise exception 'Every administrative view must use security_invoker=true';
  end if;

  if (
    select array_agg(enum_value.enumlabel order by enum_value.enumsortorder)
    from pg_enum as enum_value
    join pg_type as enum_type on enum_type.oid = enum_value.enumtypid
    join pg_namespace as namespace on namespace.oid = enum_type.typnamespace
    where namespace.nspname = 'public'
      and enum_type.typname = 'catalog_status'
  ) is distinct from array['active', 'inactive', 'archived']::name[] then
    raise exception 'catalog_status values do not match the domain contract';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.admin_import_inventory_units(uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.admin_import_inventory_units(uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Inventory import RPC execute privileges are invalid';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.get_paid_order_summary(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.get_paid_order_summary(timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'Paid order summary RPC execute privileges are invalid';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.submit_paid_order_game_nickname(uuid,text,text,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.submit_paid_order_game_nickname(uuid,text,text,text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.submit_paid_order_game_nickname(uuid,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Paid order game nickname RPC execute privileges are invalid';
  end if;

  if not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'submit_paid_order_game_nickname'
      and procedure.prosecdef
  ) then
    raise exception 'Paid order game nickname RPC must be SECURITY DEFINER';
  end if;

  if (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'claim_discord_ticket_close',
        'complete_discord_ticket_close',
        'renew_discord_ticket_close_claim',
        'release_discord_ticket_close',
        'reconcile_missing_discord_ticket'
      )
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=pg_catalog']::text[]
  ) <> 6 then
    raise exception 'Discord ticket close RPCs must be SECURITY DEFINER with a safe search_path';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges as privilege
    where privilege.routine_schema = 'public'
      and privilege.routine_name in (
        'claim_discord_ticket_close',
        'complete_discord_ticket_close',
        'renew_discord_ticket_close_claim',
        'release_discord_ticket_close',
        'reconcile_missing_discord_ticket'
      )
      and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege.privilege_type = 'EXECUTE'
  ) or (
    select count(distinct privilege.routine_name)
    from information_schema.routine_privileges as privilege
    where privilege.routine_schema = 'public'
      and privilege.routine_name in (
        'claim_discord_ticket_close',
        'complete_discord_ticket_close',
        'renew_discord_ticket_close_claim',
        'release_discord_ticket_close',
        'reconcile_missing_discord_ticket'
      )
      and privilege.grantee = 'service_role'
      and privilege.privilege_type = 'EXECUTE'
  ) <> 5 then
    raise exception 'Discord ticket close RPC execute privileges are invalid';
  end if;

  if exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'admin_import_inventory_units',
        'admin_get_inventory_secret',
        'admin_check_inventory_fingerprints',
        'admin_change_inventory_status'
      )
      and not procedure.prosecdef
  ) then
    raise exception 'Inventory RPCs must be SECURITY DEFINER';
  end if;

  if exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'admin_import_inventory_units',
        'admin_get_inventory_secret',
        'admin_check_inventory_fingerprints',
        'admin_change_inventory_status'
      )
      and has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'anon unexpectedly has EXECUTE on an inventory RPC';
  end if;

  if (
    select count(*)
    from pg_trigger as trigger
    join pg_class as relation on relation.oid = trigger.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and trigger.tgname in (
        'games_audit_mutation',
        'substores_audit_mutation',
        'products_audit_mutation',
        'whitelist_entries_audit_mutation',
        'platform_settings_audit_mutation'
      )
      and not trigger.tgisinternal
  ) <> 5 then
    raise exception 'One or more transactional catalog audit triggers are missing';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger
    join pg_class as relation on relation.oid = trigger.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and trigger.tgname = 'godawpstore_catalog_media_audit'
      and not trigger.tgisinternal
  ) then
    raise exception 'Transactional catalog media audit trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger
    join pg_class as relation on relation.oid = trigger.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'orders'
      and trigger.tgname = 'orders_prevent_closed_discord_ticket_mutation'
      and not trigger.tgisinternal
  ) then
    raise exception 'Closed Discord ticket terminal-state trigger is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whitelist_balances'
      and column_name = 'pending_balance_cents'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whitelist_balances'
      and column_name = 'available_balance_cents'
  ) then
    raise exception 'whitelist_balances is missing pending/available balances';
  end if;

  if (
    select count(*)
    from public.platform_settings
    where id = 1 and currency_code = 'BRL'
  ) <> 1 then
    raise exception 'platform_settings singleton is missing or invalid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_settings'
      and column_name = 'bot_message_config'
      and data_type = 'jsonb'
      and is_nullable = 'NO'
  ) then
    raise exception 'platform_settings.bot_message_config must be a non-null jsonb column';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.platform_settings'::regclass
      and conname in (
        'platform_settings_bot_message_config_object',
        'platform_settings_bot_message_config_version',
        'platform_settings_bot_message_config_size'
      )
  ) <> 3 then
    raise exception 'platform_settings bot message configuration constraints are missing';
  end if;

  if not (
    select bot_message_config @> '{"version":1}'::jsonb
    from public.platform_settings
    where id = 1
  ) then
    raise exception 'platform_settings bot message configuration version is invalid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_settings'
      and column_name = 'ticket_notification_discord_user_ids'
      and data_type = 'ARRAY'
      and udt_name = '_text'
      and is_nullable = 'NO'
      and column_default like '%385924725332901909%'
  ) then
    raise exception 'platform_settings ticket notification IDs column is missing or invalid';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.platform_settings'::regclass
      and conname in (
        'platform_settings_ticket_notification_ids_cardinality',
        'platform_settings_ticket_notification_ids_valid'
      )
  ) <> 2 then
    raise exception 'platform_settings ticket notification ID constraints are missing';
  end if;

  if to_regprocedure('private.valid_unique_discord_user_ids(text[])') is null then
    raise exception 'Discord notification ID validation helper is missing';
  end if;

  if not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'valid_unique_discord_user_ids'
      and procedure.provolatile = 'i'
      and procedure.proisstrict
      and not procedure.prosecdef
  ) then
    raise exception 'Discord notification ID validation helper must be immutable, strict, and invoker-secured';
  end if;

  if has_function_privilege(
    'anon',
    'private.valid_unique_discord_user_ids(text[])',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'private.valid_unique_discord_user_ids(text[])',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'private.valid_unique_discord_user_ids(text[])',
    'EXECUTE'
  ) then
    raise exception 'Discord notification ID validation helper execute privileges are invalid';
  end if;

  if not has_schema_privilege('service_role', 'private', 'USAGE')
    or has_table_privilege('anon', 'public.platform_settings', 'SELECT')
    or not has_table_privilege('service_role', 'public.platform_settings', 'SELECT') then
    raise exception 'Ticket notification settings privileges are invalid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_settings'
      and column_name = 'ticket_close_admin_discord_user_ids'
      and data_type = 'ARRAY'
      and udt_name = '_text'
      and is_nullable = 'NO'
      and column_default like '%234486394414825472%'
      and column_default like '%385924725332901909%'
      and column_default like '%911402638975844354%'
  ) then
    raise exception 'platform_settings ticket close administrator IDs column is missing or invalid';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.platform_settings'::regclass
      and conname in (
        'platform_settings_ticket_close_admin_ids_cardinality',
        'platform_settings_ticket_close_admin_ids_valid'
      )
  ) <> 2 then
    raise exception 'platform_settings ticket close administrator constraints are missing';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'catalog-media'
      and public
      and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'catalog-media bucket is missing or invalid';
  end if;
end
$$;

select 'GodAwpStore schema verification passed' as result;
