-- Transactional verification for paid-ticket Discord notification settings.
-- Safe to run against a linked project: every data mutation is rolled back.

begin;

set local client_min_messages = warning;

do $$
declare
  configured_ids text[];
begin
  select ticket_notification_discord_user_ids
  into configured_ids
  from public.platform_settings
  where id = 1;

  if configured_ids is distinct from array['385924725332901909']::text[] then
    raise exception 'the required initial ticket notification user is missing';
  end if;

  if not private.valid_unique_discord_user_ids(array[]::text[])
    or not private.valid_unique_discord_user_ids(array[
      '385924725332901909',
      '911402638975844354'
    ]::text[])
    or private.valid_unique_discord_user_ids(array['invalid']::text[])
    or private.valid_unique_discord_user_ids(array[
      '385924725332901909',
      '385924725332901909'
    ]::text[])
    or private.valid_unique_discord_user_ids(array[
      '385924725332901909',
      null
    ]::text[])
    or private.valid_unique_discord_user_ids(array[
      ['385924725332901909', '911402638975844354'],
      ['385924725332901910', '911402638975844355']
    ]::text[]) then
    raise exception 'Discord notification helper accepted an invalid list';
  end if;

  begin
    update public.platform_settings
    set ticket_notification_discord_user_ids = array['invalid']::text[]
    where id = 1;
    raise exception 'malformed Discord notification user ID was accepted';
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
    raise exception 'duplicate Discord notification user ID was accepted';
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
    raise exception 'more than 25 Discord notification user IDs were accepted';
  exception
    when check_violation then null;
  end;

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
    raise exception 'valid Discord notification user IDs were not preserved in order';
  end if;

  update public.platform_settings
  set ticket_notification_discord_user_ids = array[]::text[]
  where id = 1;

  if cardinality((
    select ticket_notification_discord_user_ids
    from public.platform_settings
    where id = 1
  )) <> 0 then
    raise exception 'an explicitly empty Discord notification list was rejected';
  end if;

  if has_table_privilege('anon', 'public.platform_settings', 'SELECT')
    or has_function_privilege(
      'anon',
      'private.valid_unique_discord_user_ids(text[])',
      'EXECUTE'
    )
    or not has_table_privilege('service_role', 'public.platform_settings', 'SELECT')
    or not has_function_privilege(
      'authenticated',
      'private.valid_unique_discord_user_ids(text[])',
      'EXECUTE'
    ) then
    raise exception 'Discord notification setting privileges are invalid';
  end if;
end
$$;

rollback;

select 'Paid-ticket Discord notification checks passed' as result;
