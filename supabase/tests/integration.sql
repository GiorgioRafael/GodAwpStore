-- Transactional integration checks for a local Supabase database.
-- Run after migrations. Every fixture is rolled back at the end.

begin;

set local client_min_messages = warning;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'admin-schema-test@example.invalid',
    '',
    now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"12345678901234567"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'unauthorized-schema-test@example.invalid',
    '',
    now(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    '{"sub":"22345678901234567"}'::jsonb,
    now(),
    now()
  );

insert into public.admin_profiles (
  auth_user_id,
  discord_user_id,
  display_name,
  is_active,
  authorization_expires_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  '12345678901234567',
  'Integration Admin',
  true,
  now() + interval '10 minutes'
);

insert into public.whitelist_entries (
  id,
  discord_id,
  label,
  commission_override_bps,
  created_by
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '32345678901234567',
    'Global commission',
    null,
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '42345678901234567',
    'Commission override',
    1250,
    '10000000-0000-4000-8000-000000000001'
  );

update public.platform_settings
set global_commission_bps = 3000
where id = 1;

insert into public.games (
  id,
  name,
  slug,
  description,
  status,
  created_by
)
values (
  '30000000-0000-4000-8000-000000000001',
  'Integration Game',
  'integration-game',
  'Fixture rolled back by this test.',
  'active',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.substores (
  id,
  game_id,
  name,
  slug,
  title,
  description,
  status,
  created_by
)
values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Integration Substore',
  'integration-substore',
  'Integration Substore',
  'Fixture rolled back by this test.',
  'active',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.products (
  id,
  substore_id,
  name,
  slug,
  description,
  minimum_price_cents,
  stock_quantity,
  status,
  low_stock_threshold,
  created_by
)
values (
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'Integration Product',
  'integration-product',
  null,
  1000,
  2,
  'active',
  1,
  '10000000-0000-4000-8000-000000000001'
);

-- anon has neither table privileges nor a permissive RLS policy.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
begin
  begin
    perform count(*) from public.games;
    raise exception 'anon unexpectedly read an administrative table';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

-- An authenticated user without an active admin profile sees no RLS rows and cannot call RPCs.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
begin
  begin
    insert into public.audit_events (
      actor_auth_user_id,
      actor_discord_user_id,
      action,
      entity_type
    )
    values (
      auth.uid(),
      '12345678901234567',
      'forged.event',
      'test'
    );
    raise exception 'authenticated role forged an audit event directly';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
declare
  visible_games integer;
  updated_settings integer;
begin
  select count(*) into visible_games from public.games;
  if visible_games <> 0 then
    raise exception 'unauthorized authenticated user saw % game rows', visible_games;
  end if;

  update public.platform_settings
  set bot_message_config = '{"version":1,"storefront":{"title":"forged"}}'::jsonb
  where id = 1;
  get diagnostics updated_settings = row_count;
  if updated_settings <> 0 then
    raise exception 'unauthorized authenticated user updated bot message configuration';
  end if;

  update public.platform_settings
  set ticket_notification_discord_user_ids = array['223456789012345678']::text[]
  where id = 1;
  get diagnostics updated_settings = row_count;
  if updated_settings <> 0 then
    raise exception 'unauthorized authenticated user updated ticket notification IDs';
  end if;

  update public.platform_settings
  set ticket_close_admin_discord_user_ids = array['223456789012345678']::text[]
  where id = 1;
  get diagnostics updated_settings = row_count;
  if updated_settings <> 0 then
    raise exception 'unauthorized authenticated user updated ticket close administrator IDs';
  end if;

  begin
    perform *
    from public.admin_check_inventory_fingerprints(
      array[encode(decode(repeat('01', 32), 'hex'), 'base64')]
    );
    raise exception 'unauthorized authenticated user called an admin RPC';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;

-- Continue as the active test administrator.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  global_rate integer;
  override_rate integer;
  settings_audits integer;
  notification_audits integer;
  close_admin_audits integer;
begin
  select effective_commission_bps
  into global_rate
  from public.effective_whitelist_commissions
  where whitelist_entry_id = '20000000-0000-4000-8000-000000000001';

  select effective_commission_bps
  into override_rate
  from public.effective_whitelist_commissions
  where whitelist_entry_id = '20000000-0000-4000-8000-000000000002';

  if global_rate <> 3000 or override_rate <> 1250 then
    raise exception 'effective commission precedence failed: global %, override %', global_rate, override_rate;
  end if;

  update public.platform_settings
  set bot_message_config = jsonb_build_object(
    'version', 1,
    'storefront', jsonb_build_object('title', 'Integration storefront')
  )
  where id = 1;

  if (
    select bot_message_config #>> '{storefront,title}'
    from public.platform_settings
    where id = 1
  ) <> 'Integration storefront' then
    raise exception 'active admin did not update bot message configuration';
  end if;

  select count(*)
  into settings_audits
  from public.audit_events
  where action = 'settings.update'
    and actor_auth_user_id = '10000000-0000-4000-8000-000000000001'
    and metadata -> 'changed_fields' ? 'bot_message_config';

  if settings_audits <> 1 then
    raise exception 'bot message configuration update was not audited exactly once';
  end if;

  if (
    select ticket_notification_discord_user_ids
    from public.platform_settings
    where id = 1
  ) is distinct from array['385924725332901909']::text[] then
    raise exception 'default ticket notification Discord user ID is invalid';
  end if;

  update public.platform_settings
  set ticket_notification_discord_user_ids = array[
    '385924725332901909',
    '911402638975844354'
  ]::text[]
  where id = 1;

  if (
    select ticket_notification_discord_user_ids
    from public.platform_settings
    where id = 1
  ) is distinct from array[
    '385924725332901909',
    '911402638975844354'
  ]::text[] then
    raise exception 'active admin did not update ticket notification Discord user IDs';
  end if;

  select count(*)
  into notification_audits
  from public.audit_events
  where action = 'settings.update'
    and actor_auth_user_id = '10000000-0000-4000-8000-000000000001'
    and metadata -> 'changed_fields' ? 'ticket_notification_discord_user_ids';

  if notification_audits <> 1 then
    raise exception 'ticket notification ID update was not audited exactly once';
  end if;

  begin
    update public.platform_settings
    set ticket_notification_discord_user_ids = array['not-a-discord-id']::text[]
    where id = 1;
    raise exception 'malformed ticket notification Discord user ID was accepted';
  exception
    when check_violation then null;
  end;

  begin
    update public.platform_settings
    set ticket_notification_discord_user_ids = array[
      '385924725332901909',
      '385924725332901909'
    ]::text[]
    where id = 1;
    raise exception 'duplicate ticket notification Discord user ID was accepted';
  exception
    when check_violation then null;
  end;

  begin
    update public.platform_settings
    set ticket_notification_discord_user_ids = array[
      '385924725332901909',
      null
    ]::text[]
    where id = 1;
    raise exception 'null ticket notification Discord user ID was accepted';
  exception
    when check_violation then null;
  end;

  begin
    update public.platform_settings
    set ticket_notification_discord_user_ids = array[
      ['385924725332901909', '911402638975844354'],
      ['385924725332901910', '911402638975844355']
    ]::text[]
    where id = 1;
    raise exception 'multidimensional ticket notification Discord user IDs were accepted';
  exception
    when check_violation then null;
  end;

  begin
    update public.platform_settings
    set ticket_notification_discord_user_ids = array(
      select (800000000000000000::bigint + sequence_number)::text
      from generate_series(1, 26) as sequence_number
    )
    where id = 1;
    raise exception 'more than 25 ticket notification Discord user IDs were accepted';
  exception
    when check_violation then null;
  end;

  update public.platform_settings
  set ticket_notification_discord_user_ids = array[]::text[]
  where id = 1;

  if cardinality((
    select ticket_notification_discord_user_ids
    from public.platform_settings
    where id = 1
  )) <> 0 then
    raise exception 'empty ticket notification Discord user ID list was rejected';
  end if;

  if (
    select ticket_close_admin_discord_user_ids
    from public.platform_settings
    where id = 1
  ) is distinct from array[
    '234486394414825472',
    '385924725332901909',
    '911402638975844354'
  ]::text[] then
    raise exception 'default ticket close administrator Discord user IDs are invalid';
  end if;

  update public.platform_settings
  set ticket_close_admin_discord_user_ids = array[
    '234486394414825472',
    '385924725332901909'
  ]::text[]
  where id = 1;

  select count(*)
  into close_admin_audits
  from public.audit_events
  where action = 'settings.update'
    and actor_auth_user_id = '10000000-0000-4000-8000-000000000001'
    and metadata -> 'changed_fields' ? 'ticket_close_admin_discord_user_ids';

  if close_admin_audits <> 1 then
    raise exception 'ticket close administrator update was not audited exactly once';
  end if;

  begin
    update public.platform_settings
    set bot_message_config = '{"version":2}'::jsonb
    where id = 1;
    raise exception 'unsupported bot message configuration version was accepted';
  exception
    when check_violation then null;
  end;

  begin
    update public.platform_settings
    set bot_message_config = jsonb_build_object('version', 1, 'oversized', repeat('x', 65537))
    where id = 1;
    raise exception 'oversized bot message configuration was accepted';
  exception
    when check_violation then null;
  end;
end
$$;

insert into storage.objects (bucket_id, name)
values ('catalog-media', 'integration/transactional-audit.png');

-- Supabase Storage deliberately blocks raw SQL deletes unless the same
-- transaction flag used by its Storage API is enabled. This keeps the test
-- aligned with the production deletion path while still exercising our
-- transactional audit trigger.
select set_config('storage.allow_delete_query', 'true', true);

delete from storage.objects
where bucket_id = 'catalog-media'
  and name = 'integration/transactional-audit.png';

select set_config('storage.allow_delete_query', 'false', true);

do $$
declare
  upload_audits integer;
  delete_audits integer;
begin
  select count(*)
  into upload_audits
  from public.audit_events
  where action = 'media.upload'
    and metadata ->> 'path' = 'integration/transactional-audit.png';

  select count(*)
  into delete_audits
  from public.audit_events
  where action = 'media.delete'
    and metadata ->> 'path' = 'integration/transactional-audit.png';

  if upload_audits <> 1 or delete_audits <> 1 then
    raise exception 'catalog media mutations were not audited transactionally';
  end if;
end
$$;

select *
from public.admin_import_inventory_units(
  '50000000-0000-4000-8000-000000000001',
  'integration.txt',
  'txt',
  jsonb_build_array(
    jsonb_build_object(
      'encrypted_payload', 'Y2lwaGVydGV4dC0x',
      'iv', 'AAAAAAAAAAAAAAAA',
      'auth_tag', 'AAAAAAAAAAAAAAAAAAAAAA==',
      'fingerprint', encode(decode(repeat('01', 32), 'hex'), 'base64')
    ),
    jsonb_build_object(
      'encrypted_payload', 'Y2lwaGVydGV4dC0y',
      'iv', 'AQEBAQEBAQEBAQEB',
      'auth_tag', 'AQEBAQEBAQEBAQEBAQEBAQ==',
      'fingerprint', encode(decode(repeat('02', 32), 'hex'), 'base64')
    )
  ),
  '60000000-0000-4000-8000-000000000001'
);

do $$
declare
  was_reused boolean;
  batch_count integer;
  unit_count integer;
begin
  select reused
  into was_reused
  from public.admin_import_inventory_units(
    '50000000-0000-4000-8000-000000000001',
    'integration.txt',
    'txt',
    jsonb_build_array(
      jsonb_build_object(
        'encrypted_payload', 'Y2lwaGVydGV4dC0x',
        'iv', 'AAAAAAAAAAAAAAAA',
        'auth_tag', 'AAAAAAAAAAAAAAAAAAAAAA==',
        'fingerprint', encode(decode(repeat('01', 32), 'hex'), 'base64')
      ),
      jsonb_build_object(
        'encrypted_payload', 'Y2lwaGVydGV4dC0y',
        'iv', 'AQEBAQEBAQEBAQEB',
        'auth_tag', 'AQEBAQEBAQEBAQEBAQEBAQ==',
        'fingerprint', encode(decode(repeat('02', 32), 'hex'), 'base64')
      )
    ),
    '60000000-0000-4000-8000-000000000001'
  );

  select count(*)
  into batch_count
  from public.inventory_batches
  where product_id = '50000000-0000-4000-8000-000000000001';

  select count(*)
  into unit_count
  from public.inventory_units
  where product_id = '50000000-0000-4000-8000-000000000001';
  if not was_reused or batch_count <> 1 or unit_count <> 2 then
    raise exception 'idempotent inventory retry created duplicate state';
  end if;
end
$$;

do $$
declare
  first_unit_id uuid;
  batches_before integer;
  batches_after integer;
  available_units bigint;
  total_units bigint;
  archived_inventory integer;
  reveal_row record;
  reveal_audits integer;
  status_audits integer;
  archive_audits integer;
begin
  select id
  into first_unit_id
  from public.inventory_units
  where product_id = '50000000-0000-4000-8000-000000000001'
  order by id
  limit 1;

  perform *
  from public.admin_change_inventory_status(first_unit_id, 'quarantined', 'test reason');

  select available_count, total_count
  into available_units, total_units
  from public.product_stock_summary
  where product_id = '50000000-0000-4000-8000-000000000001';

  if available_units <> 2 or total_units <> 2 then
    raise exception 'stock summary mismatch: available %, total %', available_units, total_units;
  end if;

  select count(*) into batches_before from public.inventory_batches;

  begin
    perform *
    from public.admin_import_inventory_units(
      '50000000-0000-4000-8000-000000000001',
      'duplicate.txt',
      'txt',
      jsonb_build_array(
        jsonb_build_object(
          'encrypted_payload', 'ZHVwbGljYXRl',
          'iv', 'AgICAgICAgICAgIC',
          'auth_tag', 'AgICAgICAgICAgICAgICAg==',
          'fingerprint', encode(decode(repeat('01', 32), 'hex'), 'base64')
        )
      ),
      '60000000-0000-4000-8000-000000000002'
    );
    raise exception 'duplicate fingerprint was unexpectedly accepted';
  exception
    when unique_violation then null;
  end;

  select count(*) into batches_after from public.inventory_batches;
  if batches_after <> batches_before then
    raise exception 'failed duplicate import left a partial batch';
  end if;

  select *
  into reveal_row
  from public.admin_get_inventory_secret(first_unit_id);

  if reveal_row.product_id <> '50000000-0000-4000-8000-000000000001'::uuid
    or reveal_row.encrypted_payload is null
    or reveal_row.iv is null
    or reveal_row.auth_tag is null
  then
    raise exception 'reveal RPC did not return the required encrypted material';
  end if;

  select count(*)
  into reveal_audits
  from public.audit_events
  where action = 'inventory.reveal'
    and entity_id = first_unit_id
    and not (metadata ?| array[
      'secret',
      'plaintext',
      'ciphertext',
      'encrypted_payload',
      'iv',
      'auth_tag',
      'fingerprint'
    ]);

  select count(*)
  into status_audits
  from public.audit_events
  where action = 'inventory.status_change'
    and entity_id = first_unit_id
    and metadata ->> 'to_status' = 'quarantined'
    and not (metadata ? 'reason');

  if reveal_audits <> 1 or status_audits <> 1 then
    raise exception 'inventory reveal/status audit invariant failed';
  end if;

  perform *
  from public.admin_change_inventory_status(first_unit_id, 'revoked', 'permanent test revocation');

  begin
    perform *
    from public.admin_change_inventory_status(first_unit_id, 'available', null);
    raise exception 'a revoked unit was unexpectedly restored';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform encrypted_payload
    from public.inventory_units
    where id = first_unit_id;
    raise exception 'authenticated role read encrypted_payload directly';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.inventory_units
    set status = 'available'
    where id = first_unit_id;
    raise exception 'authenticated role updated inventory_units directly';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.admin_profiles
    set is_active = false
    where auth_user_id = auth.uid();
    raise exception 'authenticated role updated admin_profiles directly';
  exception
    when insufficient_privilege then null;
  end;

  update public.products
  set status = 'archived', archived_at = now()
  where id = '50000000-0000-4000-8000-000000000001';

  select count(*)
  into archived_inventory
  from public.inventory_units
  where product_id = '50000000-0000-4000-8000-000000000001';

  if archived_inventory <> 2 then
    raise exception 'archiving a product changed its inventory rows';
  end if;

  select count(*)
  into archive_audits
  from public.audit_events
  where action = 'product.archive'
    and entity_id = '50000000-0000-4000-8000-000000000001'
    and metadata -> 'changed_fields' ? 'status'
    and not (metadata -> 'changed_fields' ?| array['description', 'notes']);

  if archive_audits <> 1 then
    raise exception 'product archive was not audited transactionally';
  end if;
end
$$;

-- Exercise UUID defaults with enough rows to make a broken sequential/reused default obvious.
do $$
declare
  inserted_count integer;
  unique_count integer;
begin
  with inserted as (
    insert into public.games (name, slug)
    select
      format('UUID fixture %s', sequence_number),
      format('uuid-fixture-%s', sequence_number)
    from generate_series(1, 128) as sequence_number
    returning id
  )
  select count(*), count(distinct id)
  into inserted_count, unique_count
  from inserted;

  if inserted_count <> 128 or unique_count <> inserted_count then
    raise exception 'UUID defaults were not unique';
  end if;
end
$$;

reset role;

-- The bot's service-role client can read the global list without opening it to anon.
set local role service_role;

do $$
begin
  if (
    select count(*)
    from public.platform_settings
    where id = 1
      and cardinality(ticket_notification_discord_user_ids) = 0
  ) <> 1 then
    raise exception 'service_role could not read ticket notification Discord user IDs';
  end if;
end
$$;

reset role;

-- ADMIN_DISCORD_IDS is renewed by the trusted server as a short database lease.
-- Once that lease expires, a still-valid Supabase JWT cannot bypass revocation.
update public.admin_profiles
set authorization_expires_at = now() - interval '1 second'
where auth_user_id = '10000000-0000-4000-8000-000000000001';

set local role authenticated;

do $$
declare
  visible_games integer;
begin
  select count(*) into visible_games from public.games;
  if visible_games <> 0 then
    raise exception 'an expired administrative lease still had RLS access';
  end if;
end
$$;

reset role;

rollback;

select 'GodAwpStore transactional integration checks passed' as result;

\ir payment_workflow_verification.sql
\ir order_game_nickname_verification.sql
\ir order_cart_verification.sql
\ir ticket_notification_verification.sql
\ir ticket_close_verification.sql
\ir giveaway_verification.sql
\ir native_discord_invites_verification.sql
\ir discord_product_emoji_verification.sql
\ir product_order_verification.sql
\ir admin_order_analytics_verification.sql
